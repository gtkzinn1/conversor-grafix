/**
 * Modelos de IA do "Remover fundo" (BiRefNet, licença MIT, versões ONNX da `onnx-community`).
 * Cada arquivo tem revisão fixa (commit do Hugging Face) e SHA-256 conferido depois do download
 * e a cada carregamento. Os valores vêm do registro LFS do próprio Hugging Face e foram
 * conferidos baixando cada arquivo (ver docs/ESPECIFICACAO.md, seção 11).
 */

export type ModelBackend = 'webgpu' | 'wasm';

export interface ModelVariant {
  readonly id: string;
  /** Nome mostrado ao usuário. */
  readonly label: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Lado da imagem de entrada do modelo, em pixels. */
  readonly inputSize: number;
  /** Onde o modelo roda: com WebGPU, ou só no processador (WASM). */
  readonly backend: ModelBackend;
  /** Modelo em meia precisão: a placa precisa do recurso `shader-f16` do WebGPU. */
  readonly needsShaderF16: boolean;
}

const hf = (repo: string, revision: string, file: string) =>
  `https://huggingface.co/onnx-community/${repo}/resolve/${revision}/onnx/${file}`;

export const MODEL_VARIANTS: readonly ModelVariant[] = [
  {
    id: 'birefnet-fp16',
    label: 'BiRefNet (qualidade máxima)',
    url: hf('BiRefNet-ONNX', '534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67', 'model_fp16.onnx'),
    bytes: 489_666_272,
    sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09',
    inputSize: 1024,
    backend: 'webgpu',
    needsShaderF16: true,
  },
  {
    id: 'birefnet-fp32',
    label: 'BiRefNet (qualidade máxima, placa sem fp16)',
    url: hf('BiRefNet-ONNX', '534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67', 'model.onnx'),
    bytes: 972_666_916,
    sha256: '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c',
    inputSize: 1024,
    backend: 'webgpu',
    needsShaderF16: false,
  },
  {
    id: 'birefnet-lite-fp16',
    label: 'BiRefNet lite (mais leve)',
    url: hf('BiRefNet_lite-ONNX', 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1', 'model_fp16.onnx'),
    bytes: 114_538_221,
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    inputSize: 1024,
    backend: 'webgpu',
    needsShaderF16: true,
  },
  {
    id: 'birefnet-lite-fp32',
    label: 'BiRefNet lite (mais leve, placa sem fp16)',
    url: hf('BiRefNet_lite-ONNX', 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1', 'model.onnx'),
    bytes: 224_005_088,
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    inputSize: 1024,
    backend: 'webgpu',
    needsShaderF16: false,
  },
  {
    // Sem WebGPU, os modelos de 1024 px não cabem nos 4 GB de memória do WASM (testado).
    id: 'birefnet-512-fp32',
    label: 'BiRefNet 512 (sem placa de vídeo)',
    url: hf('BiRefNet_512x512-ONNX', 'b0b30aff33d009f6bcd7dacdc3cdcf2f8f42175b', 'model.onnx'),
    bytes: 940_413_603,
    sha256: '617a11ca04cb13a2817bfad605969b4a9a040fceedbaaa46348a3957f0f6c254',
    inputSize: 512,
    backend: 'wasm',
    needsShaderF16: false,
  },
];

/** Recursos do computador que decidem quais modelos podem rodar. */
export interface DeviceSupport {
  readonly webGpu: boolean;
  readonly shaderF16: boolean;
}

export function modelsFor(device: DeviceSupport): ModelVariant[] {
  return MODEL_VARIANTS.filter(
    (variant) =>
      variant.backend === 'wasm' ||
      (device.webGpu && (!variant.needsShaderF16 || device.shaderF16)),
  );
}

/** Modelo padrão: o de maior qualidade que o computador roda. */
export function defaultModelFor(device: DeviceSupport): ModelVariant {
  const id = !device.webGpu
    ? 'birefnet-512-fp32'
    : device.shaderF16
      ? 'birefnet-fp16'
      : 'birefnet-fp32';
  const model = findModel(id);
  if (!model) throw new Error(`Modelo padrão ausente: ${id}`);
  return model;
}

export function findModel(id: string): ModelVariant | undefined {
  return MODEL_VARIANTS.find((variant) => variant.id === id);
}
