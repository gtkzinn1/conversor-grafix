import { isSerializedError, type SerializedError } from './errors';

/**
 * Protocolo de mensagens entre a página e os workers.
 * Cada worker executa UMA tarefa e é encerrado em seguida (memória liberada, isolamento por arquivo).
 */

export interface StartMessage<Input> {
  readonly type: 'start';
  readonly input: Input;
}

export interface ProgressMessage {
  readonly type: 'progress';
  /** Fração concluída entre 0 e 1, ou `null` quando não dá para estimar. */
  readonly fraction: number | null;
  readonly label?: string;
}

export interface DoneMessage<Output> {
  readonly type: 'done';
  readonly output: Output;
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly error: SerializedError;
}

export type WorkerMessage<Output> = ProgressMessage | DoneMessage<Output> | ErrorMessage;

/** Confere a forma da mensagem recebida do worker antes de usá-la. */
export function isWorkerMessage(value: unknown): value is WorkerMessage<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  switch (record['type']) {
    case 'progress': {
      const fraction = record['fraction'];
      const label = record['label'];
      return (
        (fraction === null || (typeof fraction === 'number' && fraction >= 0 && fraction <= 1)) &&
        (label === undefined || typeof label === 'string')
      );
    }
    case 'done':
      return 'output' in record;
    case 'error':
      return isSerializedError(record['error']);
    default:
      return false;
  }
}

export function isStartMessage(value: unknown): value is StartMessage<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['type'] === 'start' &&
    'input' in value
  );
}
