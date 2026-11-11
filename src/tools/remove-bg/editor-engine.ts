/**
 * Motor do editor de recorte: pincéis Apagar e Restaurar sobre a imagem em resolução original,
 * com desfazer/refazer por trechos (só a área tocada por cada pincelada é guardada).
 * Tudo em canvas 2D, que usa a placa de vídeo quando há uma: rápido mesmo com imagens grandes.
 */

export type BrushTool = 'erase' | 'restore';

export interface BrushSettings {
  readonly tool: BrushTool;
  /** Raio em pixels da imagem. */
  readonly radius: number;
  /** 0 = borda bem suave, 1 = borda dura. */
  readonly hardness: number;
}

interface Patch {
  readonly x: number;
  readonly y: number;
  readonly before: ImageBitmap;
  readonly after: ImageBitmap;
}

interface Stroke {
  readonly brush: BrushSettings;
  last: { x: number; y: number };
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Limites do histórico de desfazer (passos e pixels guardados). */
const MAX_HISTORY_STEPS = 40;
const MAX_HISTORY_PIXELS = 150_000_000;

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível.');
  return context;
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const patchPixels = (patch: Patch) => patch.before.width * patch.before.height;

export class EditorEngine {
  readonly width: number;
  readonly height: number;
  private readonly original: ImageBitmap;
  private readonly work: HTMLCanvasElement;
  private readonly workContext: CanvasRenderingContext2D;
  /** Cópia da imagem no começo da pincelada (para guardar o "antes"). */
  private readonly snapshot: HTMLCanvasElement;
  private readonly dab: HTMLCanvasElement;
  private readonly dabContext: CanvasRenderingContext2D;
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private stroke: Stroke | null = null;
  /** Há alterações desde a abertura (para avisar antes de descartar). */
  dirty = false;

  private constructor(original: ImageBitmap, result: ImageBitmap) {
    this.width = original.width;
    this.height = original.height;
    this.original = original;
    this.work = canvasOf(this.width, this.height);
    this.workContext = context2d(this.work);
    this.workContext.drawImage(result, 0, 0);
    this.snapshot = canvasOf(this.width, this.height);
    this.dab = canvasOf(1, 1);
    this.dabContext = context2d(this.dab);
  }

  /** Abre o original e o recorte; os dois precisam ter o mesmo tamanho. */
  static async create(original: Blob, result: Blob): Promise<EditorEngine> {
    const options: ImageBitmapOptions = {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
    };
    const [source, cutout] = await Promise.all([
      createImageBitmap(original, options),
      createImageBitmap(result, options),
    ]);
    try {
      if (source.width !== cutout.width || source.height !== cutout.height) {
        throw new Error('O recorte não tem o mesmo tamanho do original.');
      }
      return new EditorEngine(source, cutout);
    } catch (error) {
      source.close();
      throw error;
    } finally {
      cutout.close();
    }
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Desenha a imagem atual (o chamador já aplicou zoom e posição). */
  drawTo(context: CanvasRenderingContext2D) {
    context.drawImage(this.work, 0, 0);
  }

  beginStroke(brush: BrushSettings, x: number, y: number) {
    const snapshotContext = context2d(this.snapshot);
    snapshotContext.clearRect(0, 0, this.width, this.height);
    snapshotContext.drawImage(this.work, 0, 0);
    this.stroke = { brush, last: { x, y }, left: x, top: y, right: x, bottom: y };
    this.stamp(x, y);
  }

  /** Continua a pincelada até (x, y), com marcas próximas para o traço sair contínuo. */
  extendStroke(x: number, y: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    const { last } = stroke;
    const distance = Math.hypot(x - last.x, y - last.y);
    const spacing = Math.max(1, stroke.brush.radius * 0.2);
    if (distance < spacing) return;
    const steps = Math.floor(distance / spacing);
    for (let step = 1; step <= steps; step++) {
      const t = (step * spacing) / distance;
      this.stamp(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
    }
    const t = (steps * spacing) / distance;
    stroke.last = { x: last.x + (x - last.x) * t, y: last.y + (y - last.y) * t };
  }

  /** Fecha a pincelada e guarda o trecho alterado no histórico. */
  async endStroke() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    const pad = stroke.brush.radius + 2;
    const x = Math.max(0, Math.floor(stroke.left - pad));
    const y = Math.max(0, Math.floor(stroke.top - pad));
    const right = Math.min(this.width, Math.ceil(stroke.right + pad));
    const bottom = Math.min(this.height, Math.ceil(stroke.bottom + pad));
    if (right <= x || bottom <= y) return;
    // As duas cópias são tiradas agora, antes de qualquer outra pincelada.
    const [before, after] = await Promise.all([
      createImageBitmap(this.snapshot, x, y, right - x, bottom - y),
      createImageBitmap(this.work, x, y, right - x, bottom - y),
    ]);
    this.dirty = true;
    for (const patch of this.redoStack) this.closePatch(patch);
    this.redoStack = [];
    this.undoStack.push({ x, y, before, after });
    this.trimHistory();
  }

  undo() {
    const patch = this.undoStack.pop();
    if (!patch) return;
    this.apply(patch.x, patch.y, patch.before);
    this.redoStack.push(patch);
    this.dirty = true;
  }

  redo() {
    const patch = this.redoStack.pop();
    if (!patch) return;
    this.apply(patch.x, patch.y, patch.after);
    this.undoStack.push(patch);
    this.dirty = true;
  }

  toPng(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.work.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Não foi possível gerar o PNG.'));
      }, 'image/png');
    });
  }

  /** Libera a memória (imagens grandes ocupam centenas de MB). */
  dispose() {
    for (const patch of [...this.undoStack, ...this.redoStack]) this.closePatch(patch);
    this.undoStack = [];
    this.redoStack = [];
    this.original.close();
    for (const canvas of [this.work, this.snapshot, this.dab]) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  private apply(x: number, y: number, bitmap: ImageBitmap) {
    this.workContext.clearRect(x, y, bitmap.width, bitmap.height);
    this.workContext.drawImage(bitmap, x, y);
  }

  private closePatch(patch: Patch) {
    patch.before.close();
    patch.after.close();
  }

  private trimHistory() {
    let pixels = this.undoStack.reduce((sum, patch) => sum + patchPixels(patch), 0);
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > MAX_HISTORY_STEPS || pixels > MAX_HISTORY_PIXELS)
    ) {
      const oldest = this.undoStack.shift();
      if (!oldest) break;
      pixels -= patchPixels(oldest);
      this.closePatch(oldest);
    }
  }

  /** Uma marca redonda do pincel em (x, y). */
  private stamp(x: number, y: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    const { radius, hardness, tool } = stroke.brush;
    stroke.left = Math.min(stroke.left, x);
    stroke.top = Math.min(stroke.top, y);
    stroke.right = Math.max(stroke.right, x);
    stroke.bottom = Math.max(stroke.bottom, y);

    const inner = radius * Math.min(0.98, Math.max(0, hardness));
    if (tool === 'erase') {
      const context = this.workContext;
      const gradient = context.createRadialGradient(x, y, inner, x, y, radius);
      gradient.addColorStop(0, 'rgb(0 0 0 / 100%)');
      gradient.addColorStop(1, 'rgb(0 0 0 / 0%)');
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = 'source-over';
      return;
    }

    // Restaurar: o original passa pela máscara do pincel e é pintado por cima.
    const left = Math.floor(x - radius) - 1;
    const top = Math.floor(y - radius) - 1;
    const size = Math.ceil(radius * 2) + 3;
    if (this.dab.width < size || this.dab.height < size) {
      this.dab.width = size;
      this.dab.height = size;
    }
    const dab = this.dabContext;
    dab.globalCompositeOperation = 'source-over';
    dab.clearRect(0, 0, size, size);
    const cx = x - left;
    const cy = y - top;
    const gradient = dab.createRadialGradient(cx, cy, inner, cx, cy, radius);
    gradient.addColorStop(0, 'rgb(0 0 0 / 100%)');
    gradient.addColorStop(1, 'rgb(0 0 0 / 0%)');
    dab.fillStyle = gradient;
    dab.beginPath();
    dab.arc(cx, cy, radius, 0, Math.PI * 2);
    dab.fill();
    dab.globalCompositeOperation = 'source-in';
    dab.drawImage(this.original, left, top, size, size, 0, 0, size, size);
    dab.globalCompositeOperation = 'source-over';
    this.workContext.drawImage(this.dab, 0, 0, size, size, left, top, size, size);
  }
}
