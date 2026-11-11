import { describe, expect, it } from 'vitest';
import {
  deriveOutputName,
  MAX_FILE_NAME_LENGTH,
  sanitizeFileNamePart,
  stripExtension,
} from '../../src/lib/shared/file-name';

describe('sanitizeFileNamePart', () => {
  it('remove caracteres proibidos no Windows', () => {
    expect(sanitizeFileNamePart('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('remove caracteres de controle e de direção de texto', () => {
    expect(sanitizeFileNamePart('foto\u0000\u001f\u007f')).toBe('foto');
    // "foto\u202Egpj.exe" apareceria como "fotoexe.jpg" no Explorer.
    expect(sanitizeFileNamePart('foto\u202egpj.exe')).toBe('fotogpj.exe');
  });

  it('junta espaços e remove pontos/espaços no fim', () => {
    expect(sanitizeFileNamePart('  logo   final ...  ')).toBe('logo final');
  });

  it('normaliza acentos para NFC', () => {
    const decomposed = 'PA\u0303O'; // "PÃO" com til combinado
    expect(sanitizeFileNamePart(decomposed)).toBe('P\u00c3O');
  });
});

describe('stripExtension', () => {
  it('remove só a última extensão', () => {
    expect(stripExtension('a.b.pdf')).toBe('a.b');
    expect(stripExtension('semextensao')).toBe('semextensao');
    expect(stripExtension('.pdf')).toBe('.pdf');
  });
});

describe('deriveOutputName', () => {
  it('monta o nome com sufixo e extensão', () => {
    expect(
      deriveOutputName('PÃO DE QUEIJO MARIAS - LOGO.pdf', { suffix: ' (corel)', extension: 'pdf' }),
    ).toBe('PÃO DE QUEIJO MARIAS - LOGO (corel).pdf');
  });

  it('troca a extensão', () => {
    expect(deriveOutputName('foto.JPG', { extension: 'png' })).toBe('foto.png');
  });

  it('ignora caminhos no nome recebido', () => {
    expect(deriveOutputName('C:\\pasta\\arte.psd', { extension: 'pdf' })).toBe('arte.pdf');
    expect(deriveOutputName('../../etc/arte.psd', { extension: 'pdf' })).toBe('arte.pdf');
  });

  it('usa nome padrão quando sobra nada', () => {
    expect(deriveOutputName('???.pdf', { extension: 'pdf' })).toBe('arquivo.pdf');
    expect(deriveOutputName('', { extension: 'pdf' })).toBe('arquivo.pdf');
  });

  it('evita nomes reservados do Windows', () => {
    expect(deriveOutputName('CON.pdf', { extension: 'pdf' })).toBe('_CON.pdf');
    expect(deriveOutputName('lpt1.png', { extension: 'png' })).toBe('_lpt1.png');
  });

  it('limita o tamanho sem quebrar caracteres', () => {
    const name = deriveOutputName(`${'😀'.repeat(300)}.pdf`, {
      suffix: ' (corel)',
      extension: 'pdf',
    });
    expect(Array.from(name).length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
    expect(name.endsWith(' (corel).pdf')).toBe(true);
    expect(name).not.toMatch(/[\ud800-\udfff](?![\udc00-\udfff])/u);
  });

  it('rejeita extensão inválida', () => {
    expect(() => deriveOutputName('a.pdf', { extension: 'p/df' })).toThrow();
    expect(() => deriveOutputName('a.pdf', { extension: '' })).toThrow();
  });

  it('filtra caracteres perigosos também no sufixo', () => {
    expect(deriveOutputName('a.pdf', { suffix: ' (x:y)', extension: 'pdf' })).toBe('a (xy).pdf');
  });
});
