import { useState } from 'preact/hooks';
import { downloadBlob } from '../lib/download';
import { toAppError, type AppError } from '../lib/shared/errors';
import { deriveOutputName } from '../lib/shared/file-name';
import { editPdf, inspectFile } from '../lib/tasks';
import { assertAccepted } from '../tools/accept-file';
import { MAX_QUEUE_SIZE } from '../tools/use-file-queue';
import { Dropzone } from './dropzone';
import { Icon } from './icon';
import { FeedbackLine, type Feedback } from './pdf-common';

interface Entry {
  readonly id: string;
  readonly file: File;
  readonly status: 'checking' | 'ok' | 'rejected';
  readonly error?: AppError;
}

/** Juntar: lista de PDFs na ordem em que vão ficar, com setas para mudar a ordem. */
export function PdfMergeList() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const update = (id: string, change: Partial<Entry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  };

  const add = (files: readonly File[]) => {
    setFeedback(null);
    const room = Math.max(0, MAX_QUEUE_SIZE - entries.length);
    const added = files
      .slice(0, room)
      .map((file): Entry => ({ id: crypto.randomUUID(), file, status: 'checking' }));
    setEntries((list) => [...list, ...added]);
    for (const entry of added) {
      inspectFile(entry.file)
        .then((info) => {
          assertAccepted(['pdf'], info);
          update(entry.id, { status: 'ok' });
        })
        .catch((caught: unknown) => {
          update(entry.id, { status: 'rejected', error: toAppError(caught) });
        });
    }
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setEntries(next);
  };

  const valid = entries.filter((entry) => entry.status === 'ok');

  const run = async () => {
    const first = valid[0];
    if (valid.length < 2 || first === undefined) {
      setFeedback({ kind: 'error', text: 'Adicione pelo menos dois PDFs.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { result } = await editPdf({
        sources: valid.map((entry) => ({ file: entry.file, name: entry.file.name })),
        operation: { kind: 'merge' },
      });
      const name = deriveOutputName(first.file.name, { suffix: ' (juntado)', extension: 'pdf' });
      downloadBlob(result, name);
      setFeedback({ kind: 'ok', text: `Baixado: ${name}` });
    } catch (caught) {
      setFeedback({ kind: 'error', text: toAppError(caught).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        label="Solte os PDFs aqui"
        acceptsText="PDF"
        accept=".pdf,application/pdf"
        onFiles={add}
      />

      {entries.length > 0 && (
        <ol class="file-list" aria-label="Ordem dos PDFs">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              class={`file-row file-row--${entry.status === 'ok' ? 'ready' : entry.status}`}
              data-testid="file-row"
            >
              <span class="file-row__icon">{index + 1}</span>
              <span class="file-row__body">
                <span class="file-row__name" title={entry.file.name}>
                  {entry.file.name}
                </span>
                {entry.status === 'checking' && <span class="file-row__meta">Conferindo…</span>}
                {entry.status === 'rejected' && (
                  <span class="file-row__meta file-row__error">{entry.error?.message}</span>
                )}
              </span>
              <span class="file-row__actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Subir ${entry.file.name}`}
                  disabled={index === 0}
                  onClick={() => {
                    move(index, -1);
                  }}
                >
                  <Icon name="arrow-up" size={18} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Descer ${entry.file.name}`}
                  disabled={index === entries.length - 1}
                  onClick={() => {
                    move(index, 1);
                  }}
                >
                  <Icon name="arrow-down" size={18} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remover ${entry.file.name}`}
                  onClick={() => {
                    setEntries((list) => list.filter((item) => item.id !== entry.id));
                  }}
                >
                  <Icon name="x" size={18} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {entries.length > 0 && (
        <div class="pdf-actions">
          <span class="pdf-actions__info">
            {valid.length < 2
              ? 'Adicione pelo menos dois PDFs.'
              : `${String(valid.length)} PDFs, nesta ordem.`}
          </span>
          <button
            type="button"
            class="button button--primary"
            disabled={busy}
            onClick={() => {
              void run();
            }}
          >
            <Icon name="download" size={18} />
            {busy ? 'Juntando…' : 'Juntar e baixar'}
          </button>
        </div>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );
}
