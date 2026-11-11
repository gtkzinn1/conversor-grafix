import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { toAppError, type AppError } from '../lib/shared/errors';
import type { FileKind } from '../lib/shared/file-type';
import { inspectFile } from '../lib/tasks';
import { assertAccepted } from './accept-file';

/** Máximo de arquivos na lista de uma ferramenta, para não travar a interface. */
export const MAX_QUEUE_SIZE = 100;

export type QueueItem =
  | { readonly id: string; readonly file: File; readonly status: 'checking' }
  | { readonly id: string; readonly file: File; readonly status: 'ready'; readonly kind: FileKind }
  | {
      readonly id: string;
      readonly file: File;
      readonly status: 'rejected';
      readonly error: AppError;
    };

export interface FileQueue {
  readonly items: readonly QueueItem[];
  /** Quantos arquivos ficaram de fora por passar do limite da lista. */
  readonly overflow: number;
  readonly add: (files: readonly File[]) => void;
  readonly remove: (id: string) => void;
}

/**
 * Lista de arquivos de uma ferramenta. Cada arquivo é conferido num worker
 * (tipo pelo conteúdo + limites). Remover um item, ou sair da ferramenta, cancela a conferência.
 */
export function useFileQueue(accepts: readonly FileKind[]): FileQueue {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [overflow, setOverflow] = useState(0);
  const controllers = useRef(new Map<string, AbortController>());
  const countRef = useRef(0);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  const update = useCallback((id: string, next: QueueItem) => {
    setItems((current) => current.map((item) => (item.id === id ? next : item)));
  }, []);

  const add = useCallback(
    (files: readonly File[]) => {
      const room = Math.max(0, MAX_QUEUE_SIZE - countRef.current);
      const accepted = files.slice(0, room);
      setOverflow(files.length - accepted.length);
      if (accepted.length === 0) return;

      const added: QueueItem[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: 'checking',
      }));
      countRef.current += added.length;
      setItems((current) => [...current, ...added]);

      for (const item of added) {
        const controller = new AbortController();
        controllers.current.set(item.id, controller);
        inspectFile(item.file, { signal: controller.signal })
          .then((info) => {
            const kind = assertAccepted(accepts, info);
            update(item.id, { id: item.id, file: item.file, status: 'ready', kind });
          })
          .catch((caught: unknown) => {
            const error = toAppError(caught);
            if (error.code === 'cancelled') return;
            update(item.id, { id: item.id, file: item.file, status: 'rejected', error });
          })
          .finally(() => {
            controllers.current.delete(item.id);
          });
      }
    },
    [accepts, update],
  );

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      countRef.current = next.length;
      return next;
    });
    setOverflow(0);
  }, []);

  return { items, overflow, add, remove };
}
