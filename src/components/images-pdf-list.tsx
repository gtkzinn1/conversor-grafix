import { useEffect, useRef, useState } from 'preact/hooks';
import { downloadBlob } from '../lib/download';
import { toAppError, type AppError } from '../lib/shared/errors';
import { deriveOutputName } from '../lib/shared/file-name';
import { MAX_PDF_IMAGES, type PdfPageSize } from '../lib/shared/tasks/convert-image';
import { inspectFile, runImageTask } from '../lib/tasks';
import { acceptAttribute, assertAccepted, describeKinds } from '../tools/accept-file';
import { Dropzone } from './dropzone';
import { Icon } from './icon';
import { FeedbackLine, type Feedback } from './pdf-common';
import { Segmented } from './segmented';

const KINDS = ['png', 'jpeg', 'webp'] as const;

interface Entry {
  readonly id: string;
  readonly file: File;
  readonly status: 'checking' | 'ok' | 'rejected';
  /** Endereço `blob:` da miniatura. */
  readonly thumbnail?: string;
  readonly error?: AppError;
}

/**
 * Imagens para PDF: miniaturas na ordem das páginas (arrastar ou setas para mudar),
 * tamanho da página, margem e "Gerar PDF".
 */
export function ImagesPdfList() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [page, setPage] = useState<PdfPageSize>('image');
  const [margin, setMargin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  // Miniaturas uma de cada vez: cada uma decodifica a imagem inteira.
  const thumbnails = useRef<Promise<unknown>>(Promise.resolve());
  const urls = useRef(new Set<string>());

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const update = (id: string, change: Partial<Entry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  };

  const add = (files: readonly File[]) => {
    setFeedback(null);
    const room = Math.max(0, MAX_PDF_IMAGES - entries.length);
    if (files.length > room) {
      setFeedback({
        kind: 'error',
        text: `O PDF aceita até ${String(MAX_PDF_IMAGES)} imagens; ${String(files.length - room)} ficaram de fora.`,
      });
    }
    const added = files
      .slice(0, room)
      .map((file): Entry => ({ id: crypto.randomUUID(), file, status: 'checking' }));
    setEntries((list) => [...list, ...added]);
    for (const entry of added) {
      thumbnails.current = thumbnails.current.then(async () => {
        try {
          assertAccepted(KINDS, await inspectFile(entry.file));
          const { image } = await runImageTask({ kind: 'thumbnail', file: entry.file });
          const url = URL.createObjectURL(image);
          urls.current.add(url);
          update(entry.id, { status: 'ok', thumbnail: url });
        } catch (caught) {
          update(entry.id, { status: 'rejected', error: toAppError(caught) });
        }
      });
    }
  };

  const remove = (entry: Entry) => {
    if (entry.thumbnail !== undefined) {
      URL.revokeObjectURL(entry.thumbnail);
      urls.current.delete(entry.thumbnail);
    }
    setEntries((list) => list.filter((item) => item.id !== entry.id));
  };

  const moveTo = (id: string, target: number) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0 || target < 0 || target >= entries.length || target === index) return;
    const next = [...entries];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setEntries(next);
  };

  const valid = entries.filter((entry) => entry.status === 'ok');
  const checking = entries.some((entry) => entry.status === 'checking');

  const run = async () => {
    const first = valid[0];
    if (first === undefined) {
      setFeedback({ kind: 'error', text: 'Adicione pelo menos uma imagem.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { pdf } = await runImageTask(
        { kind: 'to-pdf', files: valid.map((entry) => entry.file), page, marginMm: margin },
        {
          onProgress: ({ label }) => {
            setProgress(label ?? '');
          },
        },
      );
      const name = deriveOutputName(first.file.name, { extension: 'pdf' });
      downloadBlob(pdf, name);
      setFeedback({ kind: 'ok', text: `Baixado: ${name}` });
    } catch (caught) {
      setFeedback({ kind: 'error', text: toAppError(caught).message });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <>
      <div class="settings">
        <Segmented
          legend="Página"
          name="pdf-pagina"
          value={page}
          options={[
            ['image', 'Tamanho da imagem'],
            ['a4', 'A4'],
            ['a3', 'A3'],
          ]}
          onChange={setPage}
        />
        <Segmented
          legend="Margem"
          name="pdf-margem"
          value={margin}
          options={[
            [0, 'Sem margem'],
            [5, '5 mm'],
            [10, '10 mm'],
          ]}
          onChange={setMargin}
        />
      </div>

      <Dropzone
        label="Solte as imagens aqui"
        acceptsText={describeKinds(KINDS)}
        accept={acceptAttribute(KINDS)}
        onFiles={add}
      />

      {entries.length > 0 && (
        <ol class="image-grid" aria-label="Ordem das imagens">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              class={`image-card image-card--${entry.status}${dragged === entry.id ? ' image-card--dragged' : ''}`}
              data-testid="image-card"
              draggable
              onDragStart={(event) => {
                setDragged(entry.id);
                event.dataTransfer?.setData('text/plain', entry.id);
              }}
              onDragEnd={() => {
                setDragged(null);
              }}
              onDragOver={(event) => {
                if (dragged !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null) moveTo(dragged, index);
                setDragged(null);
              }}
            >
              <span class="image-card__frame">
                {entry.thumbnail !== undefined ? (
                  <img src={entry.thumbnail} alt="" draggable={false} />
                ) : (
                  <span class="image-card__placeholder">
                    {entry.status === 'checking' ? 'Conferindo…' : <Icon name="alert" size={20} />}
                  </span>
                )}
              </span>
              <span class="image-card__name" title={entry.file.name}>
                {`${String(index + 1)}. ${entry.file.name}`}
              </span>
              {entry.status === 'rejected' && (
                <span class="image-card__error">{entry.error?.message}</span>
              )}
              <span class="image-card__actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Mover ${entry.file.name} para antes`}
                  disabled={index === 0}
                  onClick={() => {
                    moveTo(entry.id, index - 1);
                  }}
                >
                  <Icon name="arrow-left" size={16} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Mover ${entry.file.name} para depois`}
                  disabled={index === entries.length - 1}
                  onClick={() => {
                    moveTo(entry.id, index + 1);
                  }}
                >
                  <Icon name="arrow-right" size={16} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remover ${entry.file.name}`}
                  onClick={() => {
                    remove(entry);
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {entries.length > 0 && (
        <div class="pdf-actions">
          <span class="pdf-actions__info">
            {busy
              ? progress
              : valid.length === 0
                ? 'Nenhuma imagem pronta.'
                : `${valid.length === 1 ? '1 imagem' : `${String(valid.length)} imagens`}, nesta ordem. Arraste para mudar.`}
          </span>
          <button
            type="button"
            class="button button--primary"
            disabled={busy || checking}
            onClick={() => {
              void run();
            }}
          >
            <Icon name="download" size={18} />
            {busy ? 'Gerando…' : 'Gerar PDF'}
          </button>
        </div>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );
}
