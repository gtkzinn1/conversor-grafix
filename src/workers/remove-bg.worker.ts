import * as ort from 'onnxruntime-web/jspi';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jspi.wasm?url';
import ortGlueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jspi.mjs?url';
import { AppError } from '../lib/shared/errors';
import { assertMegapixels, DEFAULT_LIMITS } from '../lib/shared/limits';
import {
  isRemoveBgInput,
  type RemoveBgInput,
  type RemoveBgOutput,
} from '../lib/shared/tasks/remove-bg';
import {
  logitsToMask,
  refineForeground,
  toInputTensor,
  upscaleMask,
} from '../tools/remove-bg/mask';
import { loadCachedModel } from '../tools/remove-bg/model-cache';
import { limitNodeBuffers } from '../tools/remove-bg/onnx-patch';
import { findModel } from '../tools/remove-bg/models';
import { defineWorkerTask } from './runtime';

// Os arquivos do ONNX Runtime vêm do próprio app (nunca de CDN).
ort.env.wasm.wasmPaths = {
  mjs: new URL(ortGlueUrl, self.location.href).href,
  wasm: new URL(ortWasmUrl, self.location.href).href,
};
ort.env.logLevel = 'error';

function readPixels(source: ImageBitmap, width: number, height: number): ImageData {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new AppError('unexpected', undefined, 'Canvas 2D indisponível no worker.');
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
}

/**
 * Com WebGPU, nós com entradas/saídas demais são divididos para caber no limite da placa
 * (ver onnx-patch.ts). O limite vem do próprio adaptador.
 */
async function prepareModel(model: ArrayBuffer, backend: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(model);
  if (backend !== 'webgpu') return bytes;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new AppError('unexpected', undefined, 'WebGPU sem adaptador.');
  return limitNodeBuffers(bytes, adapter.limits.maxStorageBuffersPerShaderStage).model;
}

/** Roda o modelo e devolve os logits da máscara (`size × size`). */
async function inferMask(model: Uint8Array, pixels: ImageData, size: number, backend: string) {
  const session = await ort.InferenceSession.create(model, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
    // Só erros: avisos internos do ONNX Runtime não interessam ao usuário.
    logSeverityLevel: 3,
  });
  try {
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (inputName === undefined || outputName === undefined) {
      throw new AppError('unexpected', undefined, 'Modelo sem entrada ou saída.');
    }
    const input = new ort.Tensor('float32', toInputTensor(pixels.data, size), [1, 3, size, size]);
    const running = session.run({ [inputName]: input });
    // Se o Windows reiniciar a placa (TDR), o dispositivo é perdido e o `run` pode nunca terminar.
    const results =
      backend === 'webgpu'
        ? await Promise.race([running, deviceLost(await ort.env.webgpu.device)])
        : await running;
    const output = results[outputName];
    if (output?.type !== 'float32' || output.data.length !== size * size) {
      throw new AppError('unexpected', undefined, 'Saída do modelo em formato inesperado.');
    }
    return output.data as Float32Array;
  } finally {
    await session.release();
  }
}

function deviceLost(device: GPUDevice): Promise<never> {
  return device.lost.then((info) => {
    throw new AppError('gpu-failed', undefined, `Dispositivo WebGPU perdido: ${info.message}`);
  });
}

/** Com WebGPU, qualquer falha do motor vira `gpu-failed`: a página passa a usar o processador. */
async function inferOnBackend(
  model: ArrayBuffer,
  pixels: ImageData,
  size: number,
  backend: string,
) {
  try {
    return await inferMask(await prepareModel(model, backend), pixels, size, backend);
  } catch (caught) {
    if (backend !== 'webgpu' || (caught instanceof AppError && caught.code === 'gpu-failed')) {
      throw caught;
    }
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new AppError('gpu-failed', undefined, detail);
  }
}

/** "Remover fundo": máscara pela IA, refinamento da borda e PNG na resolução original. */
defineWorkerTask<RemoveBgInput, RemoveBgOutput>(isRemoveBgInput, async (input, context) => {
  const model = findModel(input.modelId);
  if (!model) throw new AppError('unexpected', undefined, `Modelo desconhecido: ${input.modelId}`);

  context.progress(null, 'Lendo a imagem');
  const bitmap = await createImageBitmap(input.file, {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
  });
  try {
    const { width, height } = bitmap;
    assertMegapixels(width, height, { ...DEFAULT_LIMITS, maxMegapixels: input.maxMegapixels });

    const size = model.inputSize;
    const small = await createImageBitmap(bitmap, {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'high',
    });
    const smallPixels = readPixels(small, size, size);
    small.close();

    context.progress(null, 'Carregando o modelo de IA');
    const modelData = await loadCachedModel(model);
    context.progress(null, 'Recortando');
    const logits = await inferOnBackend(modelData, smallPixels, size, model.backend);

    context.progress(null, 'Ajustando a borda');
    const mask = upscaleMask(logitsToMask(logits), size, width, height);
    const pixels = readPixels(bitmap, width, height);
    refineForeground(pixels.data, mask, width, height);

    context.progress(null, 'Gerando o PNG');
    const canvas = new OffscreenCanvas(width, height);
    const output = canvas.getContext('2d');
    if (!output) throw new AppError('unexpected', undefined, 'Canvas 2D indisponível no worker.');
    output.putImageData(pixels, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    context.progress(1, 'Pronto');
    return { output: { png, width, height, backend: model.backend } };
  } finally {
    bitmap.close();
  }
});
