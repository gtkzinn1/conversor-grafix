import { AppError } from './errors';
import type { FileKind } from './file-type';

/** Limites de entrada. Valores padrão; poderão ser ajustados em "Configurações". */
export interface Limits {
  /** Tamanho máximo do arquivo, em bytes, por tipo. */
  readonly maxBytes: Readonly<Record<FileKind, number>>;
  /** Resolução máxima de imagem, em megapixels. */
  readonly maxMegapixels: number;
  /** Número máximo de páginas de um PDF. */
  readonly maxPdfPages: number;
}

const MiB = 1024 * 1024;

export const DEFAULT_LIMITS: Limits = {
  maxBytes: {
    pdf: 500 * MiB,
    png: 200 * MiB,
    jpeg: 200 * MiB,
    webp: 200 * MiB,
    psd: 1024 * MiB,
    psb: 1024 * MiB,
  },
  maxMegapixels: 50,
  maxPdfPages: 2000,
};

/** "1,5 MB", "820 KB"… em português. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: digits })} ${units[unit]}`;
}

export function assertFileSize(kind: FileKind, size: number, limits: Limits = DEFAULT_LIMITS) {
  if (size <= 0) throw new AppError('empty-file');
  const max = limits.maxBytes[kind];
  if (size > max) {
    throw new AppError(
      'file-too-large',
      `O arquivo tem ${formatBytes(size)}; o limite para ${kind.toUpperCase()} é ${formatBytes(max)}.`,
    );
  }
}

export function assertMegapixels(width: number, height: number, limits: Limits = DEFAULT_LIMITS) {
  const megapixels = (width * height) / 1_000_000;
  if (!Number.isFinite(megapixels) || megapixels > limits.maxMegapixels) {
    throw new AppError(
      'too-many-megapixels',
      `A imagem tem ${width} × ${height} px (${megapixels.toFixed(1)} MP); o limite é ${limits.maxMegapixels} MP.`,
    );
  }
}

export function assertPageCount(pages: number, limits: Limits = DEFAULT_LIMITS) {
  if (pages > limits.maxPdfPages) {
    throw new AppError(
      'too-many-pages',
      `O PDF tem ${pages} páginas; o limite é ${limits.maxPdfPages}.`,
    );
  }
}
