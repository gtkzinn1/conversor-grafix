import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { EditorEngine, type BrushTool } from '../tools/remove-bg/editor-engine';
import { Icon } from './icon';

type Tool = BrushTool | 'pan';
type Backdrop = 'checker' | 'white' | 'black';

interface View {
  zoom: number;
  x: number;
  y: number;
}

interface BgEditorProps {
  readonly original: File;
  readonly result: Blob;
  readonly fileName: string;
  /** Fecha sem salvar. */
  readonly onClose: () => void;
  /** Salva o novo PNG; com `download`, também baixa. */
  readonly onSave: (png: Blob, download: boolean) => void;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

function checkerPattern(context: CanvasRenderingContext2D) {
  const tile = document.createElement('canvas');
  tile.width = 16;
  tile.height = 16;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return null;
  tileContext.fillStyle = '#cfcfd4';
  tileContext.fillRect(0, 0, 16, 16);
  tileContext.fillStyle = '#ffffff';
  tileContext.fillRect(0, 0, 8, 8);
  tileContext.fillRect(8, 8, 8, 8);
  return context.createPattern(tile, 'repeat');
}

/** Editor de ajuste do recorte (direção A: abre no lugar da lista). */
export function BgEditor({ original, result, fileName, onClose, onSave }: BgEditorProps) {
  const [engine, setEngine] = useState<EditorEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('erase');
  const [size, setSize] = useState(40);
  const [softness, setSoftness] = useState(50);
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const [zoomLabel, setZoomLabel] = useState(100);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, x: 0, y: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ mode: 'paint' | 'pan'; x: number; y: number } | null>(null);
  const spaceHeld = useRef(false);
  const frame = useRef(0);
  const settings = useRef({ tool, size, softness, backdrop });
  settings.current = { tool, size, softness, backdrop };

  // Abre o original e o recorte.
  useEffect(() => {
    let current: EditorEngine | null = null;
    let cancelled = false;
    EditorEngine.create(original, result)
      .then((created) => {
        if (cancelled) created.dispose();
        else {
          current = created;
          setEngine(created);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível abrir a imagem no editor.');
      });
    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [original, result]);

  const render = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !engine) return;
    const ratio = window.devicePixelRatio || 1;
    const { zoom, x, y } = view.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * x, ratio * y);

    const { backdrop: kind, tool: active, size: diameter } = settings.current;
    if (kind === 'checker') {
      const pattern = checkerPattern(context);
      pattern?.setTransform(new DOMMatrix().scale(1 / zoom));
      context.fillStyle = pattern ?? '#cfcfd4';
    } else context.fillStyle = kind === 'white' ? '#ffffff' : '#000000';
    context.fillRect(0, 0, engine.width, engine.height);
    context.imageSmoothingEnabled = zoom < 1;
    context.imageSmoothingQuality = 'high';
    engine.drawTo(context);

    // Contorno do pincel.
    const at = pointer.current;
    if (at && active !== 'pan') {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 1;
      for (const [color, width] of [
        ['rgb(0 0 0 / 70%)', 3],
        ['rgb(255 255 255 / 90%)', 1],
      ] as const) {
        context.strokeStyle = color;
        context.lineWidth = width;
        context.beginPath();
        context.arc(at.x, at.y, diameter / 2, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }, [engine]);

  const requestRender = useCallback(() => {
    if (frame.current === 0) frame.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(requestRender, [requestRender, backdrop, tool, size]);

  const setZoom = useCallback(
    (zoom: number, anchorX?: number, anchorY?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      const ax = anchorX ?? canvas.clientWidth / 2;
      const ay = anchorY ?? canvas.clientHeight / 2;
      const current = view.current;
      // Mantém parado o ponto da imagem sob o cursor.
      current.x = ax - ((ax - current.x) * next) / current.zoom;
      current.y = ay - ((ay - current.y) * next) / current.zoom;
      current.zoom = next;
      setZoomLabel(Math.round(next * 100));
      requestRender();
    },
    [requestRender],
  );

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(canvas.clientWidth / engine.width, canvas.clientHeight / engine.height) * 0.95,
      ),
    );
    view.current = {
      zoom,
      x: (canvas.clientWidth - engine.width * zoom) / 2,
      y: (canvas.clientHeight - engine.height * zoom) / 2,
    };
    setZoomLabel(Math.round(zoom * 100));
    requestRender();
  }, [engine, requestRender]);

  // Tamanho do canvas acompanha a área disponível.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      if (first) {
        first = false;
        fit();
      } else requestRender();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [engine, fit, requestRender]);

  const syncHistory = useCallback(() => {
    if (engine) setHistory({ undo: engine.canUndo, redo: engine.canRedo });
  }, [engine]);

  const undo = useCallback(() => {
    engine?.undo();
    syncHistory();
    requestRender();
  }, [engine, syncHistory, requestRender]);

  const redo = useCallback(() => {
    engine?.redo();
    syncHistory();
    requestRender();
  }, [engine, syncHistory, requestRender]);

  // Atalhos: Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, espaço para arrastar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        redo();
      } else if (key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        spaceHeld.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo]);

  // Roda do mouse: zoom no ponto do cursor (precisa de `passive: false`).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setZoom(view.current.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [setZoom, engine]);

  const toImage = (screenX: number, screenY: number) => ({
    x: (screenX - view.current.x) / view.current.zoom,
    y: (screenY - view.current.y) / view.current.zoom,
  });

  /**
   * Posição do ponteiro no canvas. Os eventos agrupados (`getCoalescedEvents`) não têm
   * `currentTarget`, por isso o retângulo vem do evento original.
   */
  const local = (event: PointerEvent, rect = canvasRect(event)) => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  const canvasRect = (event: PointerEvent) =>
    (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();

  const onPointerDown = (event: PointerEvent) => {
    if (!engine || drag.current) return;
    const at = local(event);
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    const active = settings.current.tool;
    if (event.button === 1 || spaceHeld.current || active === 'pan') {
      drag.current = { mode: 'pan', x: at.x, y: at.y };
      return;
    }
    if (event.button !== 0) return;
    drag.current = { mode: 'paint', x: at.x, y: at.y };
    const point = toImage(at.x, at.y);
    engine.beginStroke(
      {
        tool: active,
        radius: Math.max(0.5, settings.current.size / 2 / view.current.zoom),
        hardness: 1 - settings.current.softness / 100,
      },
      point.x,
      point.y,
    );
    requestRender();
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvasRect(event);
    const at = local(event, rect);
    pointer.current = at;
    const current = drag.current;
    if (current?.mode === 'pan') {
      view.current.x += at.x - current.x;
      view.current.y += at.y - current.y;
      current.x = at.x;
      current.y = at.y;
    } else if (current?.mode === 'paint' && engine) {
      const coalesced = event.getCoalescedEvents();
      for (const sample of coalesced.length > 0 ? coalesced : [event]) {
        const point = local(sample, rect);
        const image = toImage(point.x, point.y);
        engine.extendStroke(image.x, image.y);
      }
    }
    requestRender();
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.mode === 'paint' && engine) {
      void engine.endStroke().then(syncHistory);
    }
  };

  const save = (download: boolean) => {
    if (!engine || saving) return;
    setSaving(true);
    engine
      .toPng()
      .then((png) => {
        onSave(png, download);
      })
      .catch(() => {
        setSaving(false);
        setError('Não foi possível gerar o PNG. A imagem pode ser grande demais para a memória.');
      });
  };

  const close = () => {
    if (engine?.dirty && !window.confirm('Descartar os ajustes feitos nesta imagem?')) return;
    onClose();
  };

  const toolButton = (id: Tool, label: string, icon: 'eraser' | 'brush' | 'hand') => (
    <button
      type="button"
      class={`button${tool === id ? ' button--selected' : ''}`}
      aria-pressed={tool === id}
      onClick={() => {
        setTool(id);
      }}
    >
      <Icon name={icon} size={18} />
      {label}
    </button>
  );

  return (
    <section class="editor" aria-label={`Ajustar ${fileName}`}>
      <header class="editor__bar">
        <button type="button" class="link-button editor__back" onClick={close}>
          <Icon name="arrow-left" size={18} />
          <span class="editor__name" title={fileName}>
            {fileName}
          </span>
          {engine && (
            <span class="editor__meta">
              {engine.width} × {engine.height}
            </span>
          )}
        </button>
        <span class="editor__actions">
          <button
            type="button"
            class="button"
            disabled={!engine || saving}
            onClick={() => {
              save(false);
            }}
          >
            Concluir
          </button>
          <button
            type="button"
            class="button button--primary"
            disabled={!engine || saving}
            onClick={() => {
              save(true);
            }}
          >
            <Icon name="download" size={18} />
            {saving ? 'Gerando…' : 'Baixar PNG'}
          </button>
        </span>
      </header>

      <div class="editor__tools" role="toolbar" aria-label="Ferramentas">
        {toolButton('erase', 'Apagar', 'eraser')}
        {toolButton('restore', 'Restaurar', 'brush')}
        {toolButton('pan', 'Mover', 'hand')}
        <label class="editor__slider">
          Tamanho
          <input
            type="range"
            min={2}
            max={300}
            step={1}
            value={size}
            onInput={(event) => {
              setSize(Number(event.currentTarget.value));
            }}
          />
        </label>
        <label class="editor__slider">
          Suavidade
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={softness}
            onInput={(event) => {
              setSoftness(Number(event.currentTarget.value));
            }}
          />
        </label>
        <span class="editor__group">
          <button
            type="button"
            class="icon-button"
            aria-label="Desfazer (Ctrl+Z)"
            title="Desfazer (Ctrl+Z)"
            disabled={!history.undo}
            onClick={undo}
          >
            <Icon name="undo" size={18} />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="Refazer (Ctrl+Y)"
            title="Refazer (Ctrl+Y)"
            disabled={!history.redo}
            onClick={redo}
          >
            <Icon name="redo" size={18} />
          </button>
        </span>
        <label class="editor__select">
          <span class="visually-hidden">Fundo para conferir</span>
          <select
            value={backdrop}
            onChange={(event) => {
              setBackdrop(event.currentTarget.value as Backdrop);
            }}
          >
            <option value="checker">Xadrez</option>
            <option value="white">Branco</option>
            <option value="black">Preto</option>
          </select>
        </label>
        <span class="editor__group">
          <button
            type="button"
            class="icon-button"
            aria-label="Diminuir zoom"
            onClick={() => {
              setZoom(view.current.zoom / 1.25);
            }}
          >
            <Icon name="minus" size={18} />
          </button>
          <span class="editor__zoom">{zoomLabel}%</span>
          <button
            type="button"
            class="icon-button"
            aria-label="Aumentar zoom"
            onClick={() => {
              setZoom(view.current.zoom * 1.25);
            }}
          >
            <Icon name="plus" size={18} />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="Ajustar à tela"
            title="Ajustar à tela"
            onClick={fit}
          >
            <Icon name="maximize" size={18} />
          </button>
        </span>
      </div>

      {error && (
        <p class="notice notice--warning" role="alert">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}

      <div class="editor__stage">
        {engine ? (
          <canvas
            ref={canvasRef}
            class={`editor__canvas editor__canvas--${tool}`}
            data-testid="editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              pointer.current = null;
              requestRender();
            }}
          />
        ) : (
          !error && <p class="editor__loading">Abrindo a imagem…</p>
        )}
      </div>
    </section>
  );
}
