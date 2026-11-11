import * as pdfjs from 'pdfjs-dist';
// O pdf.js roda num worker próprio, aninhado neste (canal de mensagens separado do app).
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import { differingFraction } from '../tools/pdf-corel/pixel-diff';

/** Largura das renderizações de conferência, em pixels (rápido e suficiente para achar sumiços). */
const RENDER_WIDTH = 360;

interface CanvasAndContext {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
}

/** Fábrica de canvas para workers (o pdf.js usa `document` por padrão). */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D indisponível no worker.');
    return { canvas, context };
  }
  reset(target: CanvasAndContext, width: number, height: number): void {
    target.canvas.width = Math.max(1, width);
    target.canvas.height = Math.max(1, height);
  }
  destroy(target: CanvasAndContext): void {
    target.canvas.width = 0;
    target.canvas.height = 0;
  }
}

/** Filtros SVG não existem em workers; sem eles o pdf.js desenha sem o efeito (igual nos dois lados). */
class NoFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  destroy() {
    // nada a liberar
  }
}

/** Abre o PDF; quem chama deve destruir a tarefa (`task.destroy()`) ao terminar. */
function openDocument(data: Uint8Array, password: string | undefined) {
  return pdfjs.getDocument({
    // Cópia: o pdf.js transfere/consome o buffer recebido.
    data: data.slice(),
    ...(password === undefined ? {} : { password }),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
}

type RenderParameters = Parameters<pdfjs.PDFPageProxy['render']>[0];

async function renderPage(
  document: pdfjs.PDFDocumentProxy,
  pageNumber: number,
): Promise<Uint8ClampedArray> {
  const page = await document.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_WIDTH / Math.max(1, base.width) });
  const factory = new OffscreenCanvasFactory();
  const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  target.context.fillStyle = '#ffffff';
  target.context.fillRect(0, 0, target.canvas.width, target.canvas.height);
  // Os tipos do pdf.js descrevem canvas do DOM; no worker o equivalente é o OffscreenCanvas.
  const parameters = {
    canvas: target.canvas,
    canvasContext: target.context,
    viewport,
    intent: 'print',
  } as unknown as RenderParameters;
  await page.render(parameters).promise;
  const pixels = target.context.getImageData(0, 0, target.canvas.width, target.canvas.height).data;
  factory.destroy(target);
  page.cleanup();
  return pixels;
}

/**
 * Renderiza original e corrigido e devolve, por página, a fração de pixels que mudou.
 * Páginas além de `maxPages` não são comparadas (PDFs enormes).
 */
export async function compareVisually(
  original: Uint8Array,
  fixed: Uint8Array,
  password: string | undefined,
  onPage: (done: number, total: number) => void,
  maxPages = 50,
): Promise<number[]> {
  const port = new PdfjsWorker();
  pdfjs.GlobalWorkerOptions.workerPort = port;
  const tasks = [openDocument(original, password), openDocument(fixed, undefined)] as const;
  try {
    const [before, after] = await Promise.all([tasks[0].promise, tasks[1].promise]);
    const total = Math.min(before.numPages, after.numPages, maxPages);
    const result: number[] = [];
    for (let page = 1; page <= total; page++) {
      const [a, b] = await Promise.all([renderPage(before, page), renderPage(after, page)]);
      result.push(differingFraction(a, b));
      onPage(page, total);
    }
    return result;
  } finally {
    await Promise.all(tasks.map((task) => task.destroy()));
    pdfjs.GlobalWorkerOptions.workerPort = null;
    port.terminate();
  }
}
