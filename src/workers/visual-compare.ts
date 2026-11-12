import type * as pdfjs from 'pdfjs-dist';
import { differingFraction } from '../tools/pdf-corel/pixel-diff';
import {
  OffscreenCanvasFactory,
  openDocument,
  withPdfjs,
  type RenderParameters,
} from './pdfjs-env';

/** Largura das renderizações de conferência, em pixels (rápido e suficiente para achar sumiços). */
const RENDER_WIDTH = 360;

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
  return withPdfjs(async () => {
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
    }
  });
}
