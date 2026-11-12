import { useState } from 'preact/hooks';
import { downloadBlob } from '../lib/download';
import { toAppError } from '../lib/shared/errors';
import { deriveOutputName } from '../lib/shared/file-name';
import { editPdf } from '../lib/tasks';
import { usePdfPreview } from '../tools/pdf-edit/use-pdf-preview';
import { Icon } from './icon';
import {
  describePages,
  FeedbackLine,
  PreviewStatus,
  SinglePdfPicker,
  type Feedback,
} from './pdf-common';

type Mode = 'extrair' | 'girar';

/** Extrair e girar: miniaturas das páginas; clicar escolhe (layout A). */
export function PdfPagesEditor({ mode }: { mode: Mode }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState<string>();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [rotations, setRotations] = useState<ReadonlyMap<number, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const preview = usePdfPreview({ file, password, pages: null, widthPx: 200 });
  const ready = preview.status === 'ready' ? preview : null;

  const chooseFile = (next: File | null) => {
    setFile(next);
    setPassword(undefined);
    setSelected(new Set());
    setRotations(new Map());
    setFeedback(null);
  };

  const toggle = (page: number) => {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    setSelected(next);
  };

  const rotate = (delta: number) => {
    if (!ready) return;
    const targets = selected.size > 0 ? [...selected] : ready.pages.map((page) => page.number);
    const next = new Map(rotations);
    for (const page of targets) next.set(page, ((next.get(page) ?? 0) + delta + 360) % 360);
    setRotations(next);
  };

  const run = async () => {
    if (file === null || !ready) return;
    const changed = [...rotations].filter(
      (pair): pair is [number, 90 | 180 | 270] => pair[1] !== 0,
    );
    if (mode === 'extrair' && selected.size === 0) {
      setFeedback({ kind: 'error', text: 'Clique nas páginas que quer extrair.' });
      return;
    }
    if (mode === 'girar' && changed.length === 0) {
      setFeedback({ kind: 'error', text: 'Gire pelo menos uma página antes de salvar.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { result } = await editPdf({
        sources: [{ file, name: file.name }],
        ...(password === undefined ? {} : { password }),
        operation:
          mode === 'extrair'
            ? { kind: 'extract', pages: [...selected] }
            : { kind: 'rotate', rotations: changed },
      });
      const name = deriveOutputName(file.name, {
        suffix: mode === 'extrair' ? ' (páginas)' : ' (girado)',
        extension: 'pdf',
      });
      downloadBlob(result, name);
      setFeedback({ kind: 'ok', text: `Baixado: ${name}` });
    } catch (caught) {
      setFeedback({ kind: 'error', text: toAppError(caught).message });
    } finally {
      setBusy(false);
    }
  };

  const allSelected = ready !== null && selected.size === ready.pages.length;

  return (
    <>
      <SinglePdfPicker file={file} pageCount={ready?.pageCount} onFile={chooseFile} />
      <PreviewStatus preview={preview} onPassword={setPassword} />

      {ready && (
        <>
          <div class="pdf-toolbar">
            <button
              type="button"
              class="link-button"
              onClick={() => {
                setSelected(
                  allSelected ? new Set() : new Set(ready.pages.map((page) => page.number)),
                );
              }}
            >
              {allSelected ? 'Limpar seleção' : 'Selecionar todas'}
            </button>
            {mode === 'girar' && (
              <>
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    rotate(-90);
                  }}
                >
                  <Icon name="rotate-ccw" size={18} />
                  Girar à esquerda
                </button>
                <button
                  type="button"
                  class="button"
                  onClick={() => {
                    rotate(90);
                  }}
                >
                  <Icon name="rotate-cw" size={18} />
                  Girar à direita
                </button>
              </>
            )}
          </div>

          <ul class="page-grid" aria-label="Páginas">
            {ready.pages.map((page) => {
              const angle = rotations.get(page.number) ?? 0;
              return (
                <li key={page.number}>
                  <button
                    type="button"
                    class="page-thumb"
                    aria-pressed={selected.has(page.number)}
                    aria-label={`Página ${String(page.number)}`}
                    onClick={() => {
                      toggle(page.number);
                    }}
                  >
                    <span class="page-thumb__frame">
                      <img
                        src={page.url}
                        alt=""
                        draggable={false}
                        style={
                          angle === 0 ? undefined : { transform: `rotate(${String(angle)}deg)` }
                        }
                      />
                    </span>
                    <span class="page-thumb__label">
                      {page.number}
                      {angle !== 0 && ` · ${String(angle)}°`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div class="pdf-actions">
            <span class="pdf-actions__info">
              {mode === 'extrair'
                ? selected.size === 0
                  ? 'Clique nas páginas que quer extrair.'
                  : `Extrair ${describePages([...selected])}.`
                : selected.size === 0
                  ? 'Sem seleção, o giro vale para todas as páginas.'
                  : `Girar ${describePages([...selected])}.`}
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
              {busy ? 'Gravando…' : mode === 'extrair' ? 'Extrair e baixar' : 'Salvar e baixar'}
            </button>
          </div>
        </>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );
}
