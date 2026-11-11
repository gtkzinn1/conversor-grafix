import { toAppError } from '../lib/shared/errors';
import {
  isStartMessage,
  type DoneMessage,
  type ErrorMessage,
  type ProgressMessage,
} from '../lib/shared/worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

export interface TaskContext {
  /** Informa o progresso (0 a 1, ou `null` se indeterminado). Chamadas são limitadas a ~20 por segundo. */
  progress(fraction: number | null, label?: string): void;
}

export interface TaskResult<Output> {
  readonly output: Output;
  /** Buffers transferidos (sem cópia) para a página. */
  readonly transfer?: Transferable[];
}

const PROGRESS_INTERVAL_MS = 50;

/**
 * Registra a tarefa deste worker. O worker aceita uma única mensagem "start";
 * a página encerra o worker ao receber o resultado, um erro, ou ao cancelar.
 */
export function defineWorkerTask<Input, Output>(
  validateInput: (input: unknown) => input is Input,
  run: (input: Input, context: TaskContext) => Promise<TaskResult<Output>> | TaskResult<Output>,
): void {
  let started = false;
  let lastProgressAt = 0;

  const context: TaskContext = {
    progress(fraction, label) {
      const now = performance.now();
      const isFinal = fraction === 1;
      if (!isFinal && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      const clamped = fraction === null ? null : Math.min(1, Math.max(0, fraction));
      const message: ProgressMessage =
        label === undefined
          ? { type: 'progress', fraction: clamped }
          : { type: 'progress', fraction: clamped, label };
      self.postMessage(message);
    },
  };

  self.addEventListener('message', (event: MessageEvent<unknown>) => {
    void (async () => {
      try {
        if (started) throw new Error('O worker já recebeu uma tarefa.');
        started = true;
        if (!isStartMessage(event.data)) throw new Error('Mensagem inválida recebida pelo worker.');
        if (!validateInput(event.data.input)) throw new Error('Entrada inválida para esta tarefa.');

        const result = await run(event.data.input, context);
        const message: DoneMessage<Output> = { type: 'done', output: result.output };
        self.postMessage(message, result.transfer ?? []);
      } catch (error) {
        const message: ErrorMessage = { type: 'error', error: toAppError(error).toJSON() };
        self.postMessage(message);
      }
    })();
  });
}
