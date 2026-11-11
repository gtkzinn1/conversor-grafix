import { deriveOutputName } from '../lib/shared/file-name';
import type { PdfCorelReport } from '../lib/shared/tasks/pdf-corel';
import type { TaskProgress } from '../lib/run-worker-task';
import { fixPdfForCorel } from '../lib/tasks';

/** Resultado pronto para baixar. */
export interface ProcessResult {
  readonly blob: Blob;
  readonly fileName: string;
  /** Frases curtas sobre o que foi feito, para a lista de arquivos. */
  readonly summary: readonly string[];
  /** Avisos importantes (ex.: degradê mantido). */
  readonly warnings: readonly string[];
}

export interface ProcessContext {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: TaskProgress) => void;
  readonly password?: string;
}

export type Processor = (file: File, context: ProcessContext) => Promise<ProcessResult>;

/** Resumo em português do que a correção fez. */
export function summarizeCorelReport(report: PdfCorelReport): string[] {
  const lines: string[] = [];
  lines.push(
    report.pages === 1 ? '1 página' : `${report.pages} páginas`,
    report.originalVersion === '1.4' ? 'PDF 1.4' : `PDF ${report.originalVersion} → 1.4`,
  );
  if (report.structureRemoved) lines.push('marcações de acessibilidade removidas');
  if (report.wasEncrypted) lines.push('proteção removida');
  if (report.shadingsReplaced > 0) {
    lines.push(
      report.shadingsReplaced === 1
        ? '1 degradê trocado por cor sólida'
        : `${report.shadingsReplaced} degradês trocados por cor sólida`,
    );
  }
  if (report.swatchPages > 0) {
    const where =
      report.swatchPages === 1
        ? 'numa página extra no fim'
        : `em ${String(report.swatchPages)} páginas extras no fim`;
    lines.push(
      report.swatches === 1
        ? `degradê original ${where}`
        : `${String(report.swatches)} degradês originais ${where}`,
    );
  }
  const active =
    (report.javascriptRemoved ? 1 : 0) +
    report.automaticActionsRemoved +
    report.dangerousActionsRemoved +
    (report.embeddedFilesRemoved ? 1 : 0) +
    report.mediaAnnotationsRemoved;
  if (active > 0) lines.push('conteúdo ativo removido');
  return lines;
}

/** Processadores por ferramenta e opção. Ferramentas sem processador só conferem os arquivos. */
export function processorFor(toolId: string, option: string): Processor | undefined {
  if (toolId !== 'corrigir-pdf') return undefined;
  const fixShadings = option === 'degrades';
  return async (file, { signal, onProgress, password }) => {
    const { pdf, report } = await fixPdfForCorel(
      password === undefined ? { file, fixShadings } : { file, fixShadings, password },
      { signal, onProgress },
    );
    return {
      blob: new Blob([pdf], { type: 'application/pdf' }),
      fileName: deriveOutputName(file.name, { suffix: ' (corel)', extension: 'pdf' }),
      summary: summarizeCorelReport(report),
      warnings: report.warnings,
    };
  };
}
