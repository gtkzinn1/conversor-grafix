/** Contrato da tarefa "Corrigir PDF para o Corel" (página ↔ worker). */

export interface PdfCorelInput {
  readonly file: Blob;
  /** Também troca degradês que o Corel descarta por cor sólida. */
  readonly fixShadings: boolean;
  /** Senha de abertura, quando o PDF tiver. */
  readonly password?: string;
}

export interface PdfCorelReport {
  readonly pages: number;
  readonly originalVersion: string;
  readonly structureRemoved: boolean;
  readonly javascriptRemoved: boolean;
  readonly automaticActionsRemoved: number;
  readonly dangerousActionsRemoved: number;
  readonly embeddedFilesRemoved: boolean;
  readonly mediaAnnotationsRemoved: number;
  readonly wasEncrypted: boolean;
  /** Degradês trocados por cor sólida (0 na correção básica). */
  readonly shadingsReplaced: number;
  /** Avisos para mostrar ao usuário (ex.: degradê mantido por não ser suportado). */
  readonly warnings: readonly string[];
}

export interface PdfCorelOutput {
  readonly pdf: ArrayBuffer;
  readonly report: PdfCorelReport;
}

export function isPdfCorelInput(value: unknown): value is PdfCorelInput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['file'] instanceof Blob &&
    typeof record['fixShadings'] === 'boolean' &&
    (record['password'] === undefined || typeof record['password'] === 'string')
  );
}

export function isPdfCorelOutput(value: unknown): value is PdfCorelOutput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const report = record['report'];
  if (!(record['pdf'] instanceof ArrayBuffer) || typeof report !== 'object' || report === null) {
    return false;
  }
  const r = report as Record<string, unknown>;
  return (
    typeof r['pages'] === 'number' &&
    typeof r['originalVersion'] === 'string' &&
    typeof r['structureRemoved'] === 'boolean' &&
    typeof r['javascriptRemoved'] === 'boolean' &&
    typeof r['automaticActionsRemoved'] === 'number' &&
    typeof r['dangerousActionsRemoved'] === 'number' &&
    typeof r['embeddedFilesRemoved'] === 'boolean' &&
    typeof r['mediaAnnotationsRemoved'] === 'number' &&
    typeof r['wasEncrypted'] === 'boolean' &&
    typeof r['shadingsReplaced'] === 'number' &&
    Array.isArray(r['warnings']) &&
    r['warnings'].every((warning) => typeof warning === 'string')
  );
}
