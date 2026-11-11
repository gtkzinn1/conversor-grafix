import { runWorkerTask, type TaskProgress } from './run-worker-task';
import {
  isPdfCorelOutput,
  type PdfCorelInput,
  type PdfCorelOutput,
} from './shared/tasks/pdf-corel';
import {
  isInspectFileOutput,
  type InspectFileInput,
  type InspectFileOutput,
} from './shared/tasks/inspect-file';

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
