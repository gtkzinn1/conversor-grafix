import * as pdfjs from 'pdfjs-dist';
// O pdf.js roda num worker próprio, aninhado neste (canal de mensagens separado do app).
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

/** Ambiente do pdf.js dentro dos nossos workers (sem DOM, sem fontes do sistema, sem eval). */

export interface CanvasAndContext {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
}

/** Fábrica de canvas para workers (o pdf.js usa `document` por padrão). */
export class OffscreenCanvasFactory {
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
export function openDocument(data: Uint8Array, password: string | undefined) {
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

export type RenderParameters = Parameters<pdfjs.PDFPageProxy['render']>[0];

/** Liga o worker do pdf.js, roda `task` e desliga tudo ao final. */
export async function withPdfjs<T>(task: () => Promise<T>): Promise<T> {
  const port = new PdfjsWorker();
  pdfjs.GlobalWorkerOptions.workerPort = port;
  try {
    return await task();
  } finally {
    pdfjs.GlobalWorkerOptions.workerPort = null;
    port.terminate();
  }
}
