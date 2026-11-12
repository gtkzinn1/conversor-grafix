import { AppError } from './shared/errors';
import { runWorkerTask, type TaskProgress } from './run-worker-task';
import {
  isImageTaskOutput,
  type ImageTaskInput,
  type ImageTaskOutput,
} from './shared/tasks/convert-image';
import {
  isPdfCorelOutput,
  type PdfCorelInput,
  type PdfCorelOutput,
} from './shared/tasks/pdf-corel';
import { isPdfEditOutput, type PdfEditInput, type PdfEditOutput } from './shared/tasks/pdf-edit';
import {
  isPdfRenderOutput,
  type PdfRenderInput,
  type PdfRenderOutput,
} from './shared/tasks/pdf-render';
import {
  isInspectFileOutput,
  type InspectFileInput,
  type InspectFileOutput,
} from './shared/tasks/inspect-file';
import {
  isModelDownloadOutput,
  isRemoveBgOutput,
  type ModelDownloadInput,
  type ModelDownloadOutput,
  type RemoveBgInput,
  type RemoveBgOutput,
} from './shared/tasks/remove-bg';

/**
 * Pontos de entrada das tarefas pesadas. Cada função cria seu próprio worker.
 * O `new URL(..., import.meta.url)` precisa ficar literal para o Vite empacotar o worker.
 */

export interface TaskOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TaskProgress) => void;
}

export function inspectFile(file: Blob, options: TaskOptions = {}): Promise<InspectFileOutput> {
  return runWorkerTask<InspectFileInput, InspectFileOutput>(
    () =>
      new Worker(new URL('../workers/inspect-file.worker.ts', import.meta.url), {
        type: 'module',
        name: 'inspect-file',
      }),
    { file },
    { ...options, timeoutMs: 30_000, validateOutput: isInspectFileOutput },
  );
}

export function downloadAiModel(
  input: ModelDownloadInput,
  options: TaskOptions = {},
): Promise<ModelDownloadOutput> {
  return runWorkerTask<ModelDownloadInput, ModelDownloadOutput>(
    () =>
      new Worker(new URL('../workers/model-download.worker.ts', import.meta.url), {
        type: 'module',
        name: 'model-download',
      }),
    input,
    // Conexões lentas: até 1 hora para quase 1 GB.
    { ...options, timeoutMs: 60 * 60_000, validateOutput: isModelDownloadOutput },
  );
}

export function removeBackground(
  input: RemoveBgInput,
  options: TaskOptions = {},
): Promise<RemoveBgOutput> {
  return runWorkerTask<RemoveBgInput, RemoveBgOutput>(
    () =>
      new Worker(new URL('../workers/remove-bg.worker.ts', import.meta.url), {
        type: 'module',
        name: 'remove-bg',
      }),
    input,
    // Sem placa de vídeo, imagens grandes podem levar alguns minutos.
    { ...options, timeoutMs: 15 * 60_000, validateOutput: isRemoveBgOutput },
  );
}

export function fixPdfForCorel(
  input: PdfCorelInput,
  options: TaskOptions = {},
): Promise<PdfCorelOutput> {
  return runWorkerTask<PdfCorelInput, PdfCorelOutput>(
    () =>
      new Worker(new URL('../workers/pdf-corel.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pdf-corel',
      }),
    input,
    // PDFs grandes com muitas imagens podem levar alguns minutos.
    { ...options, timeoutMs: 10 * 60_000, validateOutput: isPdfCorelOutput },
  );
}

export function editPdf(input: PdfEditInput, options: TaskOptions = {}): Promise<PdfEditOutput> {
  return runWorkerTask<PdfEditInput, PdfEditOutput>(
    () =>
      new Worker(new URL('../workers/pdf-edit.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pdf-edit',
      }),
    input,
    { ...options, timeoutMs: 10 * 60_000, validateOutput: isPdfEditOutput },
  );
}

export function renderPdf(
  input: PdfRenderInput,
  options: TaskOptions = {},
): Promise<PdfRenderOutput> {
  return runWorkerTask<PdfRenderInput, PdfRenderOutput>(
    () =>
      new Worker(new URL('../workers/pdf-render.worker.ts', import.meta.url), {
        type: 'module',
        name: 'pdf-render',
      }),
    input,
    // Muitas páginas em alta resolução podem levar alguns minutos.
    { ...options, timeoutMs: 15 * 60_000, validateOutput: isPdfRenderOutput },
  );
}

/** Converter imagens; a saída tem o mesmo `kind` da entrada. */
export async function runImageTask<Input extends ImageTaskInput>(
  input: Input,
  options: TaskOptions = {},
): Promise<Extract<ImageTaskOutput, { kind: Input['kind'] }>> {
  const output = await runWorkerTask<ImageTaskInput, ImageTaskOutput>(
    () =>
      new Worker(new URL('../workers/convert-image.worker.ts', import.meta.url), {
        type: 'module',
        name: 'convert-image',
      }),
    input,
    { ...options, timeoutMs: 10 * 60_000, validateOutput: isImageTaskOutput },
  );
  if (output.kind !== input.kind)
    throw new AppError('unexpected', undefined, 'Resultado de outra tarefa.');
  return output as Extract<ImageTaskOutput, { kind: Input['kind'] }>;
}
