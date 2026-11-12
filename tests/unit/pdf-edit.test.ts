import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../src/lib/shared/errors';
import { listPages, type PageInfo } from '../../src/tools/pdf-corel/pages';
import { loadQpdf, type Qpdf } from '../../src/tools/pdf-corel/qpdf';
import { isQpdfJson, PdfJsonDocument } from '../../src/tools/pdf-corel/qpdf-json';
import { displayRectToBox, displaySize, visibleBox } from '../../src/tools/pdf-edit/crop';
import {
  compressPdf,
  cropPages,
  extractPages,
  mergePdfs,
  rotatePages,
  splitPdf,
  toPageRange,
} from '../../src/tools/pdf-edit/operations';

/** Integração com o MESMO qpdf WebAssembly do app, sobre tests/samples/. */

let qpdf: Qpdf;
beforeAll(async () => {
  qpdf = await loadQpdf();
});

const sample = (name: string) => ({ data: new Uint8Array(readFileSync(`tests/samples/${name}`)) });
const appError = (code: ErrorCode): unknown => expect.objectContaining({ name: 'AppError', code });

/** Páginas do PDF gerado, com caixas e texto do conteúdo. */
function inspect(pdf: Uint8Array): { pages: PageInfo[]; doc: PdfJsonDocument; text: string } {
  qpdf.writeFile('/teste.pdf', pdf);
  expect(qpdf.run(['--check', '/teste.pdf']).code).toBe(0);
  const run = qpdf.run([
    '/teste.pdf',
    '--json-output',
    '--json-stream-data=inline',
    '--decode-level=generalized',
    '/teste.json',
  ]);
  expect(run.code, run.stderr).toBe(0);
  const parsed: unknown = JSON.parse(qpdf.readText('/teste.json'));
  if (!isQpdfJson(parsed)) throw new Error('JSON inválido');
  const doc = new PdfJsonDocument(parsed);
  return { pages: listPages(doc), doc, text: new TextDecoder('latin1').decode(pdf) };
}

/** Textos "Pagina N" na ordem das páginas. */
function pageLabels(pdf: Uint8Array): string[] {
  const { pages, doc } = inspect(pdf);
  return pages.map((page) => {
    const ref = doc.dict(page.key)?.['/Contents'];
    const entry = typeof ref === 'string' ? doc.entry(`obj:${ref}`) : undefined;
    const data = entry && 'stream' in entry ? atob(entry.stream.data ?? '') : '';
    return /\(([^)]*)\) Tj/.exec(data)?.[1] ?? '?';
  });
}

describe('toPageRange', () => {
  it('agrupa páginas seguidas', () => {
    expect(toPageRange([5, 1, 2, 3, 9, 8, 3])).toBe('1-3,5,8-9');
    expect(toPageRange([4])).toBe('4');
  });
});

describe('geometria do corte', () => {
  const page = (rotate: number, cropBox?: number[]): PageInfo => ({
    key: 'obj:1 0 R',
    mediaBox: [0, 0, 200, 100],
    rotate,
    ...(cropBox ? { cropBox } : {}),
  });

  it('considera a CropBox e a rotação no tamanho mostrado', () => {
    expect(visibleBox(page(0, [10, 10, 190, 90]))).toEqual([10, 10, 190, 90]);
    expect(displaySize(page(90))).toEqual({ width: 100, height: 200 });
  });

  it('converte o canto superior esquerdo da tela em cada rotação', () => {
    const rect = { x: 0, y: 0, width: 20, height: 10 };
    expect(displayRectToBox(page(0), rect)).toEqual([0, 90, 20, 100]);
    expect(displayRectToBox(page(90), rect)).toEqual([0, 0, 10, 20]);
    expect(displayRectToBox(page(180), rect)).toEqual([180, 0, 200, 10]);
    expect(displayRectToBox(page(270), rect)).toEqual([190, 80, 200, 100]);
  });

  it('limita à página e recusa área fora dela', () => {
    expect(displayRectToBox(page(0), { x: 150, y: 50, width: 500, height: 500 })).toEqual([
      150, 0, 200, 50,
    ]);
    expect(displayRectToBox(page(0), { x: 300, y: 0, width: 10, height: 10 })).toBeUndefined();
  });
});

describe('operações', () => {
  it('junta na ordem escolhida', () => {
    const pdf = mergePdfs(qpdf, [
      { ...sample('paginas.pdf'), name: 'a.pdf' },
      { ...sample('object-streams-1.7.pdf'), name: 'b.pdf' },
    ]);
    expect(inspect(pdf).pages).toHaveLength(5);
    expect(pageLabels(pdf).slice(0, 3)).toEqual(['Pagina 1', 'Pagina 2', 'Pagina 3']);
  });

  it('junta PDF protegido sem senha de abertura e recusa o que pede senha', () => {
    expect(
      inspect(
        mergePdfs(qpdf, [
          { ...sample('paginas.pdf'), name: 'a.pdf' },
          { ...sample('protegido-sem-senha.pdf'), name: 'b.pdf' },
        ]),
      ).pages,
    ).toHaveLength(4);
    expect(() =>
      mergePdfs(qpdf, [
        { ...sample('paginas.pdf'), name: 'a.pdf' },
        { ...sample('senha-grafix.pdf'), name: 'b.pdf' },
      ]),
    ).toThrow(appError('password-required'));
  });

  it('separa uma página por arquivo', () => {
    const parts = splitPdf(qpdf, sample('paginas.pdf'));
    expect(parts.map((part) => pageLabels(part))).toEqual([
      ['Pagina 1'],
      ['Pagina 2'],
      ['Pagina 3'],
    ]);
    // Giro e caixas de cada página continuam.
    expect(inspect(parts[1] ?? new Uint8Array()).pages[0]?.rotate).toBe(90);
  });

  it('extrai as páginas escolhidas e confere os números', () => {
    expect(pageLabels(extractPages(qpdf, sample('paginas.pdf'), [3, 1]))).toEqual([
      'Pagina 1',
      'Pagina 3',
    ]);
    expect(() => extractPages(qpdf, sample('paginas.pdf'), [4])).toThrow(
      appError('invalid-options'),
    );
    expect(() => extractPages(qpdf, sample('paginas.pdf'), [])).toThrow(
      appError('invalid-options'),
    );
  });

  it('gira somando ao giro atual', () => {
    const pdf = rotatePages(
      qpdf,
      sample('paginas.pdf'),
      new Map([
        [1, 90],
        [2, 270],
      ]),
    );
    expect(inspect(pdf).pages.map((page) => page.rotate % 360)).toEqual([90, 0, 0]);
  });

  it('abre PDF com senha quando ela é dada', () => {
    const source = { ...sample('senha-grafix.pdf') };
    expect(() => extractPages(qpdf, source, [1])).toThrow(appError('password-required'));
    expect(() => extractPages(qpdf, { ...source, password: 'errada' }, [1])).toThrow(
      appError('wrong-password'),
    );
    expect(inspect(extractPages(qpdf, { ...source, password: 'grafix' }, [1])).pages).toHaveLength(
      1,
    );
  });

  it('corta redefinindo as caixas, sem mexer no conteúdo', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const one = inspect(cropPages(qpdf, sample('paginas.pdf'), rect, [1]));
    expect(one.pages[0]?.mediaBox).toEqual([10, 772, 110, 822]);
    expect(one.pages[0]?.cropBox).toEqual([10, 772, 110, 822]);
    expect(one.pages[1]?.mediaBox).toEqual([0, 0, 595, 842]);

    const all = inspect(cropPages(qpdf, sample('paginas.pdf'), rect, 'all'));
    // Página 2 deitada (/Rotate 90) e página 3 com CropBox [10 20 390 280].
    expect(all.pages[1]?.mediaBox).toEqual([20, 10, 70, 110]);
    expect(all.pages[2]?.cropBox).toEqual([20, 210, 120, 260]);
    expect(pageLabels(cropPages(qpdf, sample('paginas.pdf'), rect, 'all'))).toEqual([
      'Pagina 1',
      'Pagina 2',
      'Pagina 3',
    ]);
  });

  it('recusa corte fora da página', () => {
    expect(() =>
      cropPages(qpdf, sample('paginas.pdf'), { x: 900, y: 900, width: 10, height: 10 }, [1]),
    ).toThrow(appError('invalid-options'));
  });

  it('comprime imagens em JPEG e reduz o tamanho', () => {
    const original = sample('imagem-pesada.pdf');
    const lossless = compressPdf(qpdf, original, 'lossless');
    const images = compressPdf(qpdf, original, 'images', 70);
    expect(inspect(lossless).pages).toHaveLength(1);
    expect(images.length).toBeLessThan(original.data.length / 2);
    expect(inspect(images).text).toContain('/DCTDecode');
  });

  it('recusa arquivo que não é PDF', () => {
    expect(() => splitPdf(qpdf, { data: new TextEncoder().encode('não é pdf') })).toThrow(
      appError('invalid-pdf'),
    );
  });
});
