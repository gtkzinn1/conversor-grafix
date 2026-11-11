import { AppError } from '../lib/shared/errors';
import { FILE_KIND_LABELS, type FileKind } from '../lib/shared/file-type';
import { assertFileSize, DEFAULT_LIMITS, type Limits } from '../lib/shared/limits';

/** "PDF", "PNG, JPEG ou WebP"… */
export function describeKinds(kinds: readonly FileKind[]): string {
  const labels = [...new Set(kinds.map((kind) => FILE_KIND_LABELS[kind]))];
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} ou ${labels.at(-1) ?? ''}`;
}

/** Valor do atributo `accept` do seletor de arquivos (só filtra a janela; a validação real é pelo conteúdo). */
export function acceptAttribute(kinds: readonly FileKind[]): string {
  const extensions: Record<FileKind, string[]> = {
    pdf: ['.pdf'],
    png: ['.png'],
    jpeg: ['.jpg', '.jpeg'],
    webp: ['.webp'],
    psd: ['.psd'],
    psb: ['.psb'],
  };
  return [...new Set(kinds.flatMap((kind) => extensions[kind]))].join(',');
}

/**
 * Decide se o arquivo serve para a ferramenta, a partir do tipo detectado pelo conteúdo.
 * Lança AppError com a explicação em português quando não serve.
 */
export function assertAccepted(
  accepts: readonly FileKind[],
  detected: { kind: FileKind | null; size: number },
  limits: Limits = DEFAULT_LIMITS,
): FileKind {
  const { kind, size } = detected;
  if (size === 0) throw new AppError('empty-file');
  if (kind === null || !accepts.includes(kind)) {
    const found = kind === null ? 'um tipo não reconhecido' : FILE_KIND_LABELS[kind];
    throw new AppError(
      'unsupported-type',
      `Esta ferramenta aceita ${describeKinds(accepts)}, e o conteúdo deste arquivo é ${found}.`,
    );
  }
  assertFileSize(kind, size, limits);
  return kind;
}
