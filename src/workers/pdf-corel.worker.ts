import {
  isPdfCorelInput,
  type PdfCorelInput,
  type PdfCorelOutput,
} from '../lib/shared/tasks/pdf-corel';
import { fixPdfForCorel } from '../tools/pdf-corel/pipeline';
import { VISUAL_LIMITS } from '../tools/pdf-corel/pixel-diff';
import { loadQpdf } from '../tools/pdf-corel/qpdf';
import { defineWorkerTask } from './runtime';
import { compareVisually } from './visual-compare';

/** Parte do progresso usada pela correção; o resto é a conferência visual. */
const FIX_SHARE = 0.75;

/** "Corrigir PDF para o Corel": a sequência está em tools/pdf-corel/pipeline.ts. */
defineWorkerTask<PdfCorelInput, PdfCorelOutput>(isPdfCorelInput, async (input, context) => {
  context.progress(null, 'Carregando o motor de PDF');
  const qpdf = await loadQpdf();
  const original = new Uint8Array(await input.file.arrayBuffer());
  const { pdf, report } = fixPdfForCorel(qpdf, original, {
    fixShadings: input.fixShadings,
    ...(input.password === undefined ? {} : { password: input.password }),
    progress: (fraction, label) => {
      context.progress(fraction === null ? null : fraction * FIX_SHARE, label);
    },
  });

  // Conferência visual (seção 9.3): renderiza original e corrigido e compara.
  const warnings = [...report.warnings];
  context.progress(FIX_SHARE, 'Comparando a aparência');
  try {
    const differences = await compareVisually(original, pdf, input.password, (done, total) => {
      context.progress(FIX_SHARE + (1 - FIX_SHARE) * (done / total), 'Comparando a aparência');
    });
    const limit = input.fixShadings ? VISUAL_LIMITS.shadings : VISUAL_LIMITS.basic;
    const changed = differences.flatMap((fraction, index) => (fraction > limit ? [index + 1] : []));
    if (changed.length > 0) {
      warnings.push(
        `A conferência visual encontrou diferença na${changed.length > 1 ? 's páginas' : ' página'} ${changed.join(', ')}. Confira antes de usar.`,
      );
    }
  } catch {
    warnings.push(
      'Não foi possível fazer a conferência visual; o arquivo passou nas demais conferências.',
    );
  }

  const buffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  context.progress(1, 'Pronto');
  return { output: { pdf: buffer, report: { ...report, warnings } }, transfer: [buffer] };
});
