import { AppError } from './shared/errors';
import { isWorkerMessage, type StartMessage } from './shared/worker-protocol';

/** O mínimo de `Worker` que usamos (facilita testar sem navegador). */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface TaskProgress {
  /** Fração concluída entre 0 e 1, ou `null` quando indeterminado. */
  readonly fraction: number | null;
  readonly label?: string;
}

export interface RunWorkerTaskOptions<Output> {
  /** Cancela a tarefa: o worker é encerrado na hora. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TaskProgress) => void;
  /** Buffers da entrada transferidos (sem cópia) para o worker. */
  readonly transfer?: Transferable[];
  /** Tempo máximo; ao passar, o worker é encerrado. */
  readonly timeoutMs?: number;
  /** Valida a saída recebida do worker antes de entregar. */
  readonly validateOutput: (output: unknown) => output is Output;
}

/**
 * Executa uma tarefa num worker novo e o encerra ao final (sucesso, erro, cancelamento ou tempo esgotado).
 * Um worker por tarefa: isola cada arquivo e libera toda a memória ao terminar.
 */
// `Input` aparece uma vez só, mas obriga quem chama (ex.: src/lib/tasks.ts) a passar a entrada certa.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function runWorkerTask<Input, Output>(
  createWorker: () => WorkerLike,
  input: Input,
  options: RunWorkerTaskOptions<Output>,
): Promise<Output> {
  const { signal, onProgress, transfer = [], timeoutMs, validateOutput } = options;

  return new Promise<Output>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('cancelled'));
      return;
    }

    const worker = createWorker();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      action();
    };

    const onAbort = () => {
      finish(() => {
        reject(new AppError('cancelled'));
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        finish(() => {
          reject(new AppError('timeout'));
        });
      }, timeoutMs);
    }

    worker.onmessage = (event) => {
      const message: unknown = event.data;
      if (!isWorkerMessage(message)) {
        finish(() => {
          reject(new AppError('unexpected', undefined, 'Mensagem inválida recebida do worker.'));
        });
        return;
      }
      switch (message.type) {
        case 'progress':
          onProgress?.(
            message.label === undefined
              ? { fraction: message.fraction }
              : { fraction: message.fraction, label: message.label },
          );
          return;
        case 'done': {
          const output = message.output;
          finish(() => {
            if (validateOutput(output)) resolve(output);
            else reject(new AppError('unexpected', undefined, 'Resultado inválido do worker.'));
          });
          return;
        }
        case 'error':
          finish(() => {
            reject(AppError.fromJSON(message.error));
          });
          return;
      }
    };

    worker.onerror = (event) => {
      event.preventDefault();
      finish(() => {
        reject(new AppError('worker-crashed', undefined, event.message || undefined));
      });
    };

    worker.onmessageerror = () => {
      finish(() => {
        reject(new AppError('unexpected', undefined, 'Falha ao ler mensagem do worker.'));
      });
    };

    const start: StartMessage<Input> = { type: 'start', input };
    try {
      worker.postMessage(start, transfer);
    } catch (error) {
      finish(() => {
        reject(new AppError('unexpected', undefined, String(error)));
      });
    }
  });
}
