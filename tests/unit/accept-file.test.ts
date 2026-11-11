import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../src/lib/shared/errors';
import { DEFAULT_LIMITS } from '../../src/lib/shared/limits';
import { acceptAttribute, assertAccepted, describeKinds } from '../../src/tools/accept-file';

const appError = (code: ErrorCode): unknown => expect.objectContaining({ name: 'AppError', code });

describe('describeKinds', () => {
  it('lista os tipos em português', () => {
    expect(describeKinds(['pdf'])).toBe('PDF');
    expect(describeKinds(['png', 'jpeg'])).toBe('PNG ou JPEG');
    expect(describeKinds(['png', 'jpeg', 'webp'])).toBe('PNG, JPEG ou WebP');
  });
});

describe('acceptAttribute', () => {
  it('gera as extensões do seletor de arquivos', () => {
    expect(acceptAttribute(['pdf'])).toBe('.pdf');
    expect(acceptAttribute(['jpeg', 'png'])).toBe('.jpg,.jpeg,.png');
    expect(acceptAttribute(['psd', 'psb'])).toBe('.psd,.psb');
  });
});

describe('assertAccepted', () => {
  it('aceita o tipo certo dentro do limite', () => {
    expect(assertAccepted(['pdf'], { kind: 'pdf', size: 10 })).toBe('pdf');
  });

  it('recusa tipo diferente explicando o que foi encontrado', () => {
    expect(() => assertAccepted(['pdf'], { kind: 'jpeg', size: 10 })).toThrow(
      'Esta ferramenta aceita PDF, e o conteúdo deste arquivo é JPEG.',
    );
    expect(() => assertAccepted(['pdf'], { kind: null, size: 10 })).toThrow(
      appError('unsupported-type'),
    );
  });

  it('recusa arquivo vazio e arquivo grande demais', () => {
    expect(() => assertAccepted(['pdf'], { kind: null, size: 0 })).toThrow(appError('empty-file'));
    const tooBig = DEFAULT_LIMITS.maxBytes.pdf + 1;
    expect(() => assertAccepted(['pdf'], { kind: 'pdf', size: tooBig })).toThrow(
      appError('file-too-large'),
    );
  });
});
