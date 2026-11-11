import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../src/lib/shared/errors';
import {
  assertFileSize,
  assertMegapixels,
  assertPageCount,
  DEFAULT_LIMITS,
  formatBytes,
} from '../../src/lib/shared/limits';

const appError = (code: ErrorCode): unknown => expect.objectContaining({ name: 'AppError', code });

describe('formatBytes', () => {
  it('formata em português', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('limites', () => {
  it('arquivo vazio', () => {
    expect(() => assertFileSize('pdf', 0)).toThrow(appError('empty-file'));
  });

  it('arquivo dentro e acima do limite', () => {
    const max = DEFAULT_LIMITS.maxBytes.pdf;
    expect(() => assertFileSize('pdf', max)).not.toThrow();
    expect(() => assertFileSize('pdf', max + 1)).toThrow(appError('file-too-large'));
  });

  it('megapixels (limite padrão: 50 MP)', () => {
    expect(() => assertMegapixels(5000, 10000)).not.toThrow();
    expect(() => assertMegapixels(5001, 10000)).toThrow(appError('too-many-megapixels'));
    expect(() => assertMegapixels(Number.NaN, 1)).toThrow(appError('too-many-megapixels'));
  });

  it('páginas', () => {
    const max = DEFAULT_LIMITS.maxPdfPages;
    expect(() => assertPageCount(max)).not.toThrow();
    expect(() => assertPageCount(max + 1)).toThrow(appError('too-many-pages'));
  });

  it('aceita limites personalizados', () => {
    const limits = { ...DEFAULT_LIMITS, maxMegapixels: 1 };
    expect(() => assertMegapixels(2000, 1000, limits)).toThrow(appError('too-many-megapixels'));
  });
});
