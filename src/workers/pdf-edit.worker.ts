import { AppError } from '../lib/shared/errors';
import { sanitizeFileNamePart } from '../lib/shared/file-name';
import {
  isPdfEditInput,
  type PdfEditInput,
  type PdfEditOutput,
} from '../lib/shared/tasks/pdf-edit';
import { createZip } from '../lib/shared/zip';
import { loadQpdf } from '../tools/pdf-corel/qpdf';
import {
  compressPdf,
  cropPages,
  extractPages,
  mergePdfs,
  rotatePages,
  splitPdf,
} from '../tools/pdf-edit/operations';
import { defineWorkerTask } from './runtime';

const pdfBlob = (data: Uint8Array) =>
  new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });

/** Ferramentas de PDF: a lógica está em tools/pdf-edit/operations.ts. */
defineWorkerTask<PdfEditInput, PdfEditOutput>(isPdfEditInput, async (input, context) => {
  context.progress(null, 'Carregando o motor de PDF');
  const qpdf = await loadQpdf();
  context.progress(null, 'Lendo o PDF');
  const sources = await Promise.all(
    input.sources.map(async (source) => ({
      name: source.name,
      data: new Uint8Array(await source.file.arrayBuffer()),
    })),
  );
  const first = sources[0];
  if (first === undefined) throw new AppError('invalid-options');
  const single = input.password === undefined ? first : { ...first, password: input.password };
  const op = input.operation;

  context.progress(null, 'Gravando o PDF');
  switch (op.kind) {
    case 'merge': {
      const pdf = mergePdfs(qpdf, sources);
      return { output: { result: pdfBlob(pdf) } };
    }
    case 'split': {
      const parts = splitPdf(qpdf, single, (done, total) => {
        context.progress(done / total, `Página ${String(done)} de ${String(total)}`);
      });
      const base = sanitizeFileNamePart(op.archiveBaseName) || 'pdf';
      const digits = String(parts.length).length;
      const zip = createZip(
        parts.map((data, index) => ({
          name: `${base} - página ${String(index + 1).padStart(digits, '0')}.pdf`,
          data,
        })),
      );
      return {
        output: {
          result: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
        },
      };
    }
    case 'extract':
      return {
        output: { result: pdfBlob(extractPages(qpdf, single, op.pages)) },
      };
    case 'rotate':
      return {
        output: { result: pdfBlob(rotatePages(qpdf, single, new Map(op.rotations))) },
      };
    case 'crop':
      return {
        output: { result: pdfBlob(cropPages(qpdf, single, op.rect, op.pages)) },
      };
    case 'compress':
      return {
        output: { result: pdfBlob(compressPdf(qpdf, single, op.mode, op.quality)) },
      };
  }
});
