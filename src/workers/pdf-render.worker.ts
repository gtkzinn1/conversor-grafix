import { AppError } from '../lib/shared/errors';
import { sanitizeFileNamePart } from '../lib/shared/file-name';
import { assertMegapixels, assertPageCount } from '../lib/shared/limits';
import {
  isPdfRenderInput,
  type PdfRenderInput,
  type PdfRenderOutput,
  type RenderedPage,
} from '../lib/shared/tasks/pdf-render';
import { createZip, type ZipEntry } from '../lib/shared/zip';
import {
  OffscreenCanvasFactory,
  openDocument,
  withPdfjs,
  type RenderParameters,
} from './pdfjs-env';
import { defineWorkerTask } from './runtime';

/** "PasswordException" do pdf.js: código 1 = precisa de senha, 2 = senha errada. */
function passwordError(caught: unknown): AppError | undefined {
  if (typeof caught !== 'object' || caught === null) return undefined;
  const { name, code } = caught as { name?: unknown; code?: unknown };
  if (name !== 'PasswordException') return undefined;
  return new AppError(code === 2 ? 'wrong-password' : 'password-required');
}

/** Renderiza páginas com o pdf.js (miniaturas, prévia do corte e PDF → imagem). */
defineWorkerTask<PdfRenderInput, PdfRenderOutput>(isPdfRenderInput, (input, context) =>
  withPdfjs(async () => {
    context.progress(null, 'Abrindo o PDF');
    const data = new Uint8Array(await input.file.arrayBuffer());
    const task = openDocument(data, input.password);
    try {
      const document = await task.promise.catch((caught: unknown) => {
        throw passwordError(caught) ?? new AppError('invalid-pdf', undefined, String(caught));
      });
      assertPageCount(document.numPages);
      const numbers = input.pages ?? Array.from({ length: document.numPages }, (_, i) => i + 1);
      if (numbers.some((number) => number > document.numPages)) {
        throw new AppError('invalid-options', `O PDF tem ${String(document.numPages)} páginas.`);
      }

      const mime = input.format === 'png' ? 'image/png' : 'image/jpeg';
      const extension = input.format === 'png' ? 'png' : 'jpg';
      const baseName =
        input.archiveBaseName === undefined
          ? undefined
          : sanitizeFileNamePart(input.archiveBaseName) || 'pdf';
      const pages: RenderedPage[] = [];
      const entries: ZipEntry[] = [];
      const factory = new OffscreenCanvasFactory();

      for (const [index, number] of numbers.entries()) {
        context.progress(
          index / numbers.length,
          `Página ${String(number)} de ${String(document.numPages)}`,
        );
        const page = await document.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const scale =
          input.scale.kind === 'dpi'
            ? input.scale.dpi / 72
            : Math.min(input.scale.px / Math.max(1, base.width), 8);
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        assertMegapixels(width, height);

        const target = factory.create(width, height);
        // Fundo branco: o PDF não tem fundo e o JPEG não tem transparência.
        target.context.fillStyle = '#ffffff';
        target.context.fillRect(0, 0, width, height);
        const parameters = {
          canvas: target.canvas,
          canvasContext: target.context,
          viewport,
          intent: 'print',
        } as unknown as RenderParameters;
        await page.render(parameters).promise;
        const image = await target.canvas.convertToBlob(
          input.format === 'jpeg' ? { type: mime, quality: input.quality ?? 0.9 } : { type: mime },
        );
        factory.destroy(target);
        page.cleanup();

        const info = { number, widthPt: base.width, heightPt: base.height };
        // Com uma página só, a imagem vai direto (sem ZIP).
        if (baseName === undefined || numbers.length === 1) {
          pages.push({ ...info, image });
        } else {
          pages.push(info);
          const digits = String(document.numPages).length;
          entries.push({
            name: `${baseName} - página ${String(number).padStart(digits, '0')}.${extension}`,
            data: new Uint8Array(await image.arrayBuffer()),
          });
        }
      }

      context.progress(1, 'Pronto');
      const output: PdfRenderOutput =
        entries.length === 0
          ? { pageCount: document.numPages, pages }
          : {
              pageCount: document.numPages,
              pages,
              archive: new Blob([createZip(entries) as Uint8Array<ArrayBuffer>], {
                type: 'application/zip',
              }),
            };
      return { output };
    } finally {
      await task.destroy();
    }
  }),
);
