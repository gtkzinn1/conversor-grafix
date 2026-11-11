import { describe, expect, it, vi } from 'vitest';
import { runWorkerTask, type WorkerLike } from '../../src/lib/run-worker-task';
import { AppError } from '../../src/lib/shared/errors';

/** Worker falso: o teste decide o que ele "responde". */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => undefined } as ErrorEvent);
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number';

function start(options: Partial<Parameters<typeof runWorkerTask<string, number>>[2]> = {}) {
  const worker = new FakeWorker();
  const promise = runWorkerTask<string, number>(() => worker, 'entrada', {
    validateOutput: isNumber,
    ...options,
  });
  return { worker, promise };
}

const rejectionCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-app-error';
  }
};

describe('runWorkerTask', () => {
  it('envia a entrada, entrega o resultado e encerra o worker', async () => {
    const { worker, promise } = start();
    expect(worker.posted).toEqual([{ type: 'start', input: 'entrada' }]);
    worker.reply({ type: 'done', output: 42 });
    await expect(promise).resolves.toBe(42);
    expect(worker.terminated).toBe(true);
  });

  it('repassa o progresso', async () => {
    const onProgress = vi.fn();
    const { worker, promise } = start({ onProgress });
    worker.reply({ type: 'progress', fraction: 0.5, label: 'Lendo' });
    worker.reply({ type: 'progress', fraction: null });
    worker.reply({ type: 'done', output: 1 });
    await promise;
    expect(onProgress).toHaveBeenNthCalledWith(1, { fraction: 0.5, label: 'Lendo' });
    expect(onProgress).toHaveBeenNthCalledWith(2, { fraction: null });
  });

  it('transforma erro do worker em AppError', async () => {
    const { worker, promise } = start();
    worker.reply({
      type: 'error',
      error: { code: 'empty-file', message: 'O arquivo está vazio.' },
    });
    expect(await rejectionCode(promise)).toBe('empty-file');
    expect(worker.terminated).toBe(true);
  });

  it('cancela pelo AbortSignal e encerra o worker', async () => {
    const controller = new AbortController();
    const { worker, promise } = start({ signal: controller.signal });
    controller.abort();
    expect(await rejectionCode(promise)).toBe('cancelled');
    expect(worker.terminated).toBe(true);
  });

  it('não cria worker se já estiver cancelado', async () => {
    const controller = new AbortController();
    controller.abort();
    const create = vi.fn(() => new FakeWorker());
    const promise = runWorkerTask(create, 'x', {
      signal: controller.signal,
      validateOutput: isNumber,
    });
    expect(await rejectionCode(promise)).toBe('cancelled');
    expect(create).not.toHaveBeenCalled();
  });

  it('encerra por tempo esgotado', async () => {
    vi.useFakeTimers();
    try {
      const { worker, promise } = start({ timeoutMs: 1000 });
      const code = rejectionCode(promise);
      vi.advanceTimersByTime(1000);
      expect(await code).toBe('timeout');
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('trata queda do worker', async () => {
    const { worker, promise } = start();
    worker.crash('Out of memory');
    expect(await rejectionCode(promise)).toBe('worker-crashed');
  });

  it('rejeita mensagens e resultados inválidos', async () => {
    const a = start();
    a.worker.reply({ type: 'progress', fraction: 7 });
    expect(await rejectionCode(a.promise)).toBe('unexpected');

    const b = start();
    b.worker.reply({ type: 'done', output: 'não é número' });
    expect(await rejectionCode(b.promise)).toBe('unexpected');
  });

  it('ignora mensagens depois de terminar', async () => {
    const { worker, promise } = start();
    worker.reply({ type: 'done', output: 1 });
    worker.reply({ type: 'error', error: { code: 'unexpected', message: 'x' } });
    await expect(promise).resolves.toBe(1);
  });
});
