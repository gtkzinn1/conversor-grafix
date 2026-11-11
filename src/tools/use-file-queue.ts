import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TaskProgress } from '../lib/run-worker-task';
import { toAppError, type AppError } from '../lib/shared/errors';
import type { FileKind } from '../lib/shared/file-type';
import { inspectFile } from '../lib/tasks';
import { assertAccepted } from './accept-file';
import type { ProcessResult, Processor } from './processors';

/** Máximo de arquivos na lista de uma ferramenta, para não travar a interface. */
export const MAX_QUEUE_SIZE = 100;

interface Base {
  readonly id: string;
  readonly file: File;
}

export type QueueItem =
  | (Base & { readonly status: 'checking' })
  /** Conferido; a ferramenta ainda não processa (em construção). */
  | (Base & { readonly status: 'ready'; readonly kind: FileKind })
  | (Base & { readonly status: 'processing'; readonly progress: TaskProgress })
  /** O PDF tem senha de abertura; `error` aparece quando a senha digitada não confere. */
  | (Base & { readonly status: 'needs-password'; readonly error?: AppError })
  | (Base & { readonly status: 'done'; readonly result: ProcessResult })
  | (Base & { readonly status: 'rejected'; readonly error: AppError });

export interface FileQueue {
  readonly items: readonly QueueItem[];
  /** Quantos arquivos ficaram de fora por passar do limite da lista. */
  readonly overflow: number;
  /** Adiciona arquivos; com `processor`, cada arquivo aceito é processado em seguida. */
  readonly add: (files: readonly File[], processor?: Processor) => void;
  readonly remove: (id: string) => void;
  readonly submitPassword: (id: string, password: string) => void;
  /** Troca o resultado de um item já processado (ex.: depois de ajustar no editor). */
  readonly replaceResult: (id: string, result: ProcessResult) => void;
}

/**
 * Lista de arquivos de uma ferramenta. Cada arquivo é conferido num worker
 * (tipo pelo conteúdo + limites) e, se a ferramenta já funciona, processado em outro worker.
 * Remover um item, ou sair da ferramenta, cancela o que estiver em andamento.
 */
export function useFileQueue(accepts: readonly FileKind[]): FileQueue {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [overflow, setOverflow] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const processors = useRef(new Map<string, Processor>());
  const countRef = useRef(0);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  const update = useCallback((next: QueueItem) => {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
  }, []);

  /** Executa uma etapa cancelável do item (conferência ou processamento). */
  const track = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    return {
      signal: controller.signal,
      done: () => {
        if (controllers.current.get(id) === controller) controllers.current.delete(id);
      },
    };
  }, []);

  const runProcessor = useCallback(
    (base: Base, password?: string) => {
      const processor = processors.current.get(base.id);
      if (!processor) return;
      const { signal, done } = track(base.id);
      update({ ...base, status: 'processing', progress: { fraction: null } });
      const context = {
        signal,
        onProgress: (progress: TaskProgress) => {
          if (!signal.aborted) update({ ...base, status: 'processing', progress });
        },
      };
      processor(base.file, password === undefined ? context : { ...context, password })
        .then((result) => {
          update({ ...base, status: 'done', result });
        })
        .catch((caught: unknown) => {
          const error = toAppError(caught);
          if (error.code === 'cancelled') return;
          if (error.code === 'password-required') update({ ...base, status: 'needs-password' });
          else if (error.code === 'wrong-password') {
            update({ ...base, status: 'needs-password', error });
          } else update({ ...base, status: 'rejected', error });
        })
        .finally(done);
    },
    [track, update],
  );

  const add = useCallback(
    (files: readonly File[], processor?: Processor) => {
      const room = Math.max(0, MAX_QUEUE_SIZE - countRef.current);
      const accepted = files.slice(0, room);
      setOverflow(files.length - accepted.length);
      if (accepted.length === 0) return;

      const added: Base[] = accepted.map((file) => ({ id: crypto.randomUUID(), file }));
      countRef.current += added.length;
      setItems((current) => [
        ...current,
        ...added.map((base) => ({ ...base, status: 'checking' as const })),
      ]);

      for (const base of added) {
        if (processor) processors.current.set(base.id, processor);
        const { signal, done } = track(base.id);
        inspectFile(base.file, { signal })
          .then((info) => {
            const kind = assertAccepted(accepts, info);
            done();
            if (processor) runProcessor(base);
            else update({ ...base, status: 'ready', kind });
          })
          .catch((caught: unknown) => {
            done();
            const error = toAppError(caught);
            if (error.code !== 'cancelled') update({ ...base, status: 'rejected', error });
          });
      }
    },
    [accepts, runProcessor, track, update],
  );

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    processors.current.delete(id);
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      countRef.current = next.length;
      return next;
    });
    setOverflow(0);
  }, []);

  const submitPassword = useCallback(
    (id: string, password: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item?.status !== 'needs-password') return;
      runProcessor({ id: item.id, file: item.file }, password);
    },
    [items, runProcessor],
  );

  const replaceResult = useCallback((id: string, result: ProcessResult) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.status === 'done' ? { ...item, result } : item,
      ),
    );
  }, []);

  return { items, overflow, add, remove, submitPassword, replaceResult };
}
