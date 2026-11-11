import { describe, expect, it } from 'vitest';
import { detectFileKind } from '../../src/lib/shared/file-type';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : part,
    ),
  );

describe('detectFileKind', () => {
  it('reconhece PDF', () => {
    expect(detectFileKind(bytes('%PDF-1.7\n'))).toBe('pdf');
  });

  it('reconhece PDF com lixo antes do cabeçalho (dentro do 1º KiB)', () => {
    expect(detectFileKind(bytes('x'.repeat(500), '%PDF-1.4'))).toBe('pdf');
    expect(detectFileKind(bytes('x'.repeat(1100), '%PDF-1.4'))).toBeNull();
  });

  it('reconhece PNG, JPEG e WebP', () => {
    expect(detectFileKind(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(detectFileKind(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectFileKind(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('webp');
  });

  it('diferencia PSD e PSB pela versão', () => {
    expect(detectFileKind(bytes('8BPS', [0, 1]))).toBe('psd');
    expect(detectFileKind(bytes('8BPS', [0, 2]))).toBe('psb');
    expect(detectFileKind(bytes('8BPS', [0, 9]))).toBeNull();
  });

  it('não confia na extensão: texto qualquer não é reconhecido', () => {
    expect(detectFileKind(bytes('isto não é um PDF'))).toBeNull();
    expect(detectFileKind(new Uint8Array())).toBeNull();
  });

  it('RIFF que não é WebP (ex.: WAV) não é reconhecido', () => {
    expect(detectFileKind(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toBeNull();
  });
});
