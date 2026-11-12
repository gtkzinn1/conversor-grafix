import { useRef, useState } from 'preact/hooks';
import { downloadBlob } from '../lib/download';
import { toAppError } from '../lib/shared/errors';
import { deriveOutputName } from '../lib/shared/file-name';
import type { CropRect } from '../lib/shared/tasks/pdf-edit';
import { editPdf } from '../lib/tasks';
import { usePdfPreview, type PreviewPage } from '../tools/pdf-edit/use-pdf-preview';
import { Icon } from './icon';
import { FeedbackLine, PreviewStatus, SinglePdfPicker, type Feedback } from './pdf-common';

const MM_PER_PT = 25.4 / 72;
/** Menor lado da área, em pontos (~1 mm), igual ao limite do worker. */
const MIN_SIZE = 3;

type Handle = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { readonly kind: 'draw'; readonly startX: number; readonly startY: number }
  | { readonly kind: 'move'; readonly offsetX: number; readonly offsetY: number }
  | { readonly kind: 'resize'; readonly handle: Handle };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Mantém a área dentro da página e com tamanho mínimo. */
function fitRect(rect: CropRect, page: PreviewPage): CropRect {
  const width = clamp(rect.width, MIN_SIZE, page.widthPt);
  const height = clamp(rect.height, MIN_SIZE, page.heightPt);
  return {
    x: clamp(rect.x, 0, page.widthPt - width),
    y: clamp(rect.y, 0, page.heightPt - height),
    width,
    height,
  };
}

function fromCorners(x0: number, y0: number, x1: number, y1: number): CropRect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** Campo numérico em milímetros. */
function MmField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (pt: number) => void;
}) {
  return (
    <label class="crop-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        value={(value * MM_PER_PT).toFixed(1)}
        onChange={(event) => {
          const mm = Number.parseFloat(event.currentTarget.value.replace(',', '.'));
          if (Number.isFinite(mm)) onChange(mm / MM_PER_PT);
        }}
      />
    </label>
  );
}

/** Cortar: a página grande, a área desenhada com o mouse e ajuste fino em mm (layout C). */
export function PdfCropEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState<string>();
  const [current, setCurrent] = useState(1);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const drag = useRef<Drag | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const thumbs = usePdfPreview({ file, password, pages: null, widthPx: 120 });
  const big = usePdfPreview({
    file: thumbs.status === 'ready' ? file : null,
    password,
    pages: [current],
    widthPx: 1200,
  });
  const ready = thumbs.status === 'ready' ? thumbs : null;
  const page = big.status === 'ready' ? big.pages[0] : undefined;

  const chooseFile = (next: File | null) => {
    setFile(next);
    setPassword(undefined);
    setCurrent(1);
    setRect(null);
    setFeedback(null);
  };

  /** Posição do ponteiro em pontos da página. */
  const toPoints = (event: PointerEvent) => {
    const box = overlay.current?.getBoundingClientRect();
    if (!box || !page) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - box.left) / box.width) * page.widthPt, 0, page.widthPt),
      y: clamp(((event.clientY - box.top) / box.height) * page.heightPt, 0, page.heightPt),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!page || event.button !== 0) return;
    event.preventDefault();
    overlay.current?.setPointerCapture(event.pointerId);
    const point = toPoints(event);
    const handle = (event.target as HTMLElement).dataset['handle'] as Handle | undefined;
    if (rect && handle) {
      drag.current = { kind: 'resize', handle };
    } else if (
      rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      drag.current = { kind: 'move', offsetX: point.x - rect.x, offsetY: point.y - rect.y };
    } else {
      drag.current = { kind: 'draw', startX: point.x, startY: point.y };
      setRect(null);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const action = drag.current;
    if (!action || !page) return;
    const point = toPoints(event);
    if (action.kind === 'draw') {
      setRect(fromCorners(action.startX, action.startY, point.x, point.y));
    } else if (action.kind === 'move' && rect) {
      setRect(fitRect({ ...rect, x: point.x - action.offsetX, y: point.y - action.offsetY }, page));
    } else if (action.kind === 'resize' && rect) {
      const left = action.handle.endsWith('w') ? point.x : rect.x;
      const right = action.handle.endsWith('e') ? point.x : rect.x + rect.width;
      const top = action.handle.startsWith('n') ? point.y : rect.y;
      const bottom = action.handle.startsWith('s') ? point.y : rect.y + rect.height;
      setRect(fromCorners(left, top, right, bottom));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    if (rect && page && (rect.width < MIN_SIZE || rect.height < MIN_SIZE)) setRect(null);
  };

  const run = async () => {
    if (file === null || !rect) {
      setFeedback({ kind: 'error', text: 'Desenhe a área de corte sobre a página.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { result } = await editPdf({
        sources: [{ file, name: file.name }],
        ...(password === undefined ? {} : { password }),
        operation: { kind: 'crop', rect, pages: scope === 'all' ? 'all' : [current] },
      });
      const name = deriveOutputName(file.name, { suffix: ' (cortado)', extension: 'pdf' });
      downloadBlob(result, name);
      setFeedback({ kind: 'ok', text: `Baixado: ${name}` });
    } catch (caught) {
      setFeedback({ kind: 'error', text: toAppError(caught).message });
    } finally {
      setBusy(false);
    }
  };

  const percent = (value: number, total: number) => `${String((value / total) * 100)}%`;

  return (
    <>
      <SinglePdfPicker file={file} pageCount={ready?.pageCount} onFile={chooseFile} />
      <PreviewStatus preview={ready ? big : thumbs} onPassword={setPassword} />

      {ready && (
        <div class="crop-layout">
          {ready.pages.length > 1 && (
            <ul class="crop-strip" aria-label="Páginas">
              {ready.pages.map((thumb) => (
                <li key={thumb.number}>
                  <button
                    type="button"
                    class="page-thumb"
                    aria-pressed={thumb.number === current}
                    aria-label={`Página ${String(thumb.number)}`}
                    onClick={() => {
                      setCurrent(thumb.number);
                    }}
                  >
                    <span class="page-thumb__frame">
                      <img src={thumb.url} alt="" draggable={false} />
                    </span>
                    <span class="page-thumb__label">{thumb.number}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div class="crop-stage">
            {page && (
              <div
                class="crop-page"
                style={{
                  aspectRatio: `${String(page.widthPt)} / ${String(page.heightPt)}`,
                  // Cabe inteira na altura da tela: a largura segue a proporção da página.
                  width: `min(100%, calc(70dvh * ${String(page.widthPt / page.heightPt)}))`,
                }}
              >
                <img src={page.url} alt={`Página ${String(page.number)}`} draggable={false} />
                <div
                  ref={overlay}
                  class="crop-overlay"
                  data-testid="crop-overlay"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {rect && (
                    <div
                      class="crop-rect"
                      style={{
                        left: percent(rect.x, page.widthPt),
                        top: percent(rect.y, page.heightPt),
                        width: percent(rect.width, page.widthPt),
                        height: percent(rect.height, page.heightPt),
                      }}
                    >
                      {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                        <span
                          key={handle}
                          class={`crop-handle crop-handle--${handle}`}
                          data-handle={handle}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div class="crop-panel">
            <p class="crop-panel__title">Área (mm)</p>
            {rect && page ? (
              <>
                <MmField
                  label="X"
                  value={rect.x}
                  onChange={(x) => {
                    setRect(fitRect({ ...rect, x }, page));
                  }}
                />
                <MmField
                  label="Y"
                  value={rect.y}
                  onChange={(y) => {
                    setRect(fitRect({ ...rect, y }, page));
                  }}
                />
                <MmField
                  label="Largura"
                  value={rect.width}
                  onChange={(width) => {
                    setRect(fitRect({ ...rect, width }, page));
                  }}
                />
                <MmField
                  label="Altura"
                  value={rect.height}
                  onChange={(height) => {
                    setRect(fitRect({ ...rect, height }, page));
                  }}
                />
              </>
            ) : (
              <p class="crop-panel__hint">Desenhe a área com o mouse sobre a página.</p>
            )}

            <fieldset class="crop-scope">
              <legend class="visually-hidden">Onde cortar</legend>
              <label>
                <input
                  type="radio"
                  name="crop-scope"
                  checked={scope === 'one'}
                  onChange={() => {
                    setScope('one');
                  }}
                />
                Só nesta página
              </label>
              <label>
                <input
                  type="radio"
                  name="crop-scope"
                  checked={scope === 'all'}
                  onChange={() => {
                    setScope('all');
                  }}
                />
                Todas as páginas
              </label>
            </fieldset>

            <button
              type="button"
              class="button button--primary"
              disabled={busy}
              onClick={() => {
                void run();
              }}
            >
              <Icon name="crop" size={18} />
              {busy ? 'Gravando…' : 'Cortar e baixar'}
            </button>
            <p class="crop-panel__hint">
              O que fica fora da área é escondido, não apagado: continua dentro do arquivo.
            </p>
          </div>
        </div>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );
}
