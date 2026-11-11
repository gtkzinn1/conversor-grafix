import { deriveOutputName } from '../lib/shared/file-name';
import type { PdfCorelReport } from '../lib/shared/tasks/pdf-corel';
import type { TaskProgress } from '../lib/run-worker-task';
import { AppError } from '../lib/shared/errors';
import { DEFAULT_LIMITS } from '../lib/shared/limits';
import { markGpuFailed } from '../lib/storage';
import { fixPdfForCorel, removeBackground } from '../lib/tasks';
import { findModel } from './remove-bg/models';

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

/**
 * Fila de uma tarefa por vez: cada recorte carrega o modelo inteiro (até ~1 GB) na memória
 * e na placa de vídeo; várias imagens ao mesmo tempo travariam o computador.
 */
let serialTail: Promise<unknown> = Promise.resolve();

function runSerially<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const run = serialTail.then(() => {
    if (signal.aborted) throw new AppError('cancelled');
    return task();
  });
  serialTail = run.catch(() => undefined);
  return run;
}

/**
 * Falhas que, com o modelo na placa de vídeo, indicam a placa (e não o arquivo): o motor
 * avisou que o dispositivo caiu, o worker morreu ou travou até o limite de tempo.
 */
function isGpuFailure(caught: unknown): boolean {
  return (
    caught instanceof AppError &&
    (caught.code === 'gpu-failed' || caught.code === 'worker-crashed' || caught.code === 'timeout')
  );
}

/** "Remover fundo": `modelId` é o modelo de IA escolhido para este computador. */
function backgroundRemover(modelId: string): Processor {
  return (file, { signal, onProgress }) => {
    onProgress({ fraction: null, label: 'Na fila' });
    return runSerially(signal, async () => {
      const result = await removeBackground(
        { file, modelId, maxMegapixels: DEFAULT_LIMITS.maxMegapixels },
        { signal, onProgress },
      ).catch((caught: unknown) => {
        if (findModel(modelId)?.backend === 'webgpu' && isGpuFailure(caught)) markGpuFailed();
        throw caught;
      });
      return {
        blob: result.png,
        fileName: deriveOutputName(file.name, { suffix: ' (sem fundo)', extension: 'png' }),
        summary: [
          `${String(result.width)} × ${String(result.height)} px`,
          result.backend === 'webgpu' ? 'IA na placa de vídeo' : 'IA no processador',
        ],
        warnings: [],
      };
    });
  };
}

/** Processadores por ferramenta e opção. Ferramentas sem processador só conferem os arquivos. */
export function processorFor(toolId: string, option: string): Processor | undefined {
  if (toolId === 'remover-fundo') return backgroundRemover(option);
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
