import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../src/lib/shared/errors';
import { listPages } from '../../src/tools/pdf-corel/pages';
import { fixPdfForCorel, type PipelineOptions } from '../../src/tools/pdf-corel/pipeline';
import { loadQpdf, type Qpdf } from '../../src/tools/pdf-corel/qpdf';
import { isQpdfJson, isStream, PdfJsonDocument } from '../../src/tools/pdf-corel/qpdf-json';

/**
 * Integração: roda a correção completa com o MESMO qpdf WebAssembly do app,
 * sobre os PDFs de tests/samples/ (gerados por scripts/samples/generate_samples.py).
 */

let qpdf: Qpdf;
beforeAll(async () => {
  qpdf = await loadQpdf();
});

const sample = (name: string) => new Uint8Array(readFileSync(`tests/samples/${name}`));
const appError = (code: ErrorCode): unknown => expect.objectContaining({ name: 'AppError', code });

function fix(name: string, options: Partial<PipelineOptions> = {}) {
  return fixPdfForCorel(qpdf, sample(name), { fixShadings: false, ...options });
}

/** Lê o PDF gerado de volta, com os streams decodificados, para conferir o resultado. */
function inspect(pdf: Uint8Array) {
  qpdf.writeFile('/teste.pdf', pdf);
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
  const check = qpdf.run(['--check', '/teste.pdf']);
  const text = (key: string) => {
    const entry = doc.entry(key);
    return isStream(entry) && entry.stream.data ? atob(entry.stream.data) : '';
  };
  const pageContents = () =>
    listPages(doc).map((page) => {
      const contents = doc.dict(page.key)?.['/Contents'];
      const refs = Array.isArray(contents) ? contents : [contents];
      return refs.map((ref) => (typeof ref === 'string' ? text(`obj:${ref}`) : '')).join('\n');
    });
  return { doc, check, header: new TextDecoder().decode(pdf.subarray(0, 8)), text, pageContents };
}

describe('correção básica', () => {
  it('PDF no estilo Canva: remove a árvore de estrutura e grava PDF 1.4', () => {
    const { pdf, report } = fix('canva-tags.pdf');
    expect(report.structureRemoved).toBe(true);
    expect(report.pages).toBe(1);
    const out = inspect(pdf);
    expect(out.header).toBe('%PDF-1.4');
    expect(out.check.code).toBe(0);
    const catalog = out.doc.dict(out.doc.rootKey) ?? {};
    expect(catalog).not.toHaveProperty('/StructTreeRoot');
    expect(catalog).not.toHaveProperty('/MarkInfo');
    expect(catalog).not.toHaveProperty('/Version');
    for (const key of out.doc.keys()) {
      const dict = out.doc.dict(key) ?? {};
      expect(dict, key).not.toHaveProperty('/StructParent');
      expect(dict, key).not.toHaveProperty('/StructParents');
    }
    // Desenho intacto: o conteúdo da página continua o mesmo.
    expect(out.pageContents()[0]).toContain('(Menu de teste) Tj');
    // Página deslocada e tamanho Carta preservados.
    expect(listPages(out.doc)[0]?.mediaBox).toEqual([0, 7.92, 612, 799.92]);
  });

  it('remove JavaScript, ações automáticas, Launch e anexos; mantém link comum', () => {
    const { pdf, report } = fix('conteudo-ativo.pdf');
    expect(report.javascriptRemoved).toBe(true);
    expect(report.embeddedFilesRemoved).toBe(true);
    expect(report.automaticActionsRemoved).toBeGreaterThanOrEqual(3);
    expect(report.dangerousActionsRemoved).toBe(1);
    expect(report.mediaAnnotationsRemoved).toBe(1);
    const out = inspect(pdf);
    const all = JSON.stringify(out.doc.keys().map((key) => out.doc.entry(key)));
    expect(all).not.toContain('/JavaScript');
    expect(all).not.toContain('/Launch');
    expect(all).not.toContain('/EmbeddedFile');
    expect(all).not.toContain('/OpenAction');
    expect(all).toContain('u:https://example.com');
  });

  it('PDF 1.7 com object streams vira 1.4 sem object streams, mesmas páginas', () => {
    const { pdf, report } = fix('object-streams-1.7.pdf');
    expect(report.originalVersion).toBe('1.7');
    expect(report.pages).toBe(2);
    const out = inspect(pdf);
    expect(out.header).toBe('%PDF-1.4');
    const types = out.doc.keys().map((key) => out.doc.dict(key)?.['/Type']);
    expect(types).not.toContain('/ObjStm');
    expect(types).not.toContain('/XRef');
    expect(listPages(out.doc).map((page) => page.mediaBox)).toEqual([
      [0, 0, 595, 842],
      [0, 0, 842, 595],
    ]);
  });

  it('remove a proteção de PDF protegido sem senha de abertura', () => {
    const { pdf, report } = fix('protegido-sem-senha.pdf');
    expect(report.wasEncrypted).toBe(true);
    expect(qpdf.run(['--requires-password', (qpdf.writeFile('/p.pdf', pdf), '/p.pdf')]).code).toBe(
      2,
    );
  });

  it('pede a senha de abertura, recusa a errada e aceita a certa', () => {
    expect(() => fix('senha-grafix.pdf')).toThrow(appError('password-required'));
    expect(() => fix('senha-grafix.pdf', { password: 'errada' })).toThrow(
      appError('wrong-password'),
    );
    const { pdf, report } = fix('senha-grafix.pdf', { password: 'grafix' });
    expect(report.wasEncrypted).toBe(true);
    expect(inspect(pdf).pageContents()[0]).toContain('(Com senha de abertura) Tj');
  });

  it('repara xref quebrada', () => {
    const { pdf } = fix('xref-quebrada.pdf');
    expect(inspect(pdf).check.code).toBe(0);
  });

  it('recusa arquivo que não é PDF de verdade', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\nisto não é um PDF\n%%EOF');
    expect(() => fixPdfForCorel(qpdf, bytes, { fixShadings: false })).toThrow(
      appError('invalid-pdf'),
    );
  });

  it('informa o progresso em ordem', () => {
    const steps: (number | null)[] = [];
    fix('canva-tags.pdf', { progress: (fraction) => steps.push(fraction) });
    expect(steps.at(-1)).toBe(1);
    const numeric = steps.filter((step): step is number => step !== null);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });
});

describe('troca de degradês', () => {
  it('troca TODOS os degradês por cor sólida; nenhum sobra no arquivo', () => {
    const { pdf, report } = fix('degrades.pdf', { fixShadings: true });
    // Sh1–Sh8, padrão P1 e o Form = 10.
    expect(report.shadingsReplaced).toBe(10);
    expect(report.warnings).toEqual([
      'Um degradê virou uma cor aproximada (degradê de malha, tipo 4); confira a cor no Corel.',
    ]);

    const out = inspect(pdf);
    const [content = ''] = out.pageContents();
    // Os dois streams viraram um só.
    expect(typeof out.doc.dict(listPages(out.doc)[0]?.key ?? '')?.['/Contents']).toBe('string');
    // Sh1: CMYK de costura (0→M100Y100, depois K0→K34) → média em k; caminho mantido e preenchido.
    expect(content).toContain('0 0.7488 0.7488 0.0854 k\n0 0 100 100 re\nf Q');
    // Padrão P1 (mesmo degradê) virou a mesma cor.
    expect(content).toContain('/Pattern cs 0 0.7488 0.7488 0.0854 k 50 350 100 100 re f');
    // Sh2 (W*): preenchimento par-ímpar f*.
    expect(content).toMatch(/rg\n200 650 m 300 650 l 300 750 l h\nf\*/);
    // Sh3: há desenho depois do sh → preenche isolado e mantém o recorte.
    expect(content).toContain('q\n0.5 g\n50 500 100 100 re\nf\nQ\n50 500 100 100 re\nW n');
    // Sh4: Separation convertida pelo espaço alternativo (CMYK).
    expect(content).toMatch(/0 0\.5 0\.4 0\.05 k\n200 500 100 100 re\nf/);
    // Sh5: função amostrada (vermelho → azul) = média roxa.
    expect(content).toMatch(/0\.5 0 0\.5 rg\n350 500 100 100 re\nf/);
    // Sh6 (tipo 1, baseado em função): média da grade 2D = cinza 50%.
    expect(content).toContain('q 0.5 g\n350 650 100 100 re\nf Q');
    // Sh7 sem recorte, dentro de "0.5 0 0 0.5 cm": vira a página inteira no espaço atual.
    expect(content).toContain(
      'q 0.5 0 0 0.5 0 0 cm q 1 0.5 0 rg 0 0 m 1190 0 l 1190 1684 l 0 1684 l h f Q Q',
    );
    // Sh8 (malha): usa a cor de fundo declarada.
    expect(content).toContain('q 0 0 1 rg\n50 200 50 50 re\nf Q');
    // Padrão de degradê via scn virou cor.
    expect(content).not.toContain('/P1 scn');
    // Texto e imagem embutida intactos (o leitor não confundiu "sh" dentro deles).
    expect(content).toContain('(texto \\(com par');
    // Imagem embutida (BI…EI) virou imagem normal: o Corel recusa imagens embutidas.
    expect(content).not.toContain(' BI ');
    expect(content).toMatch(/\/IIm\d+ Do/);
    // Nenhum operador sh sobrou, nem nas páginas nem no Form.
    expect(content).not.toMatch(/\/Sh\d+ sh\b/);
    const form = out.doc.keys().find((key) => out.doc.dict(key)?.['/Subtype'] === '/Form');
    expect(out.text(form ?? '')).toContain('rg\n0 0 80 80 re\nf');
    // Definições de degradê sem uso foram retiradas dos recursos da página.
    const resources = out.doc.dict(listPages(out.doc)[0]?.key ?? '')?.['/Resources'];
    const resourcesDict = out.doc.resolve(resources);
    expect(resourcesDict).not.toHaveProperty('/Shading');
    expect(resourcesDict).not.toHaveProperty('/Pattern');
    expect(out.check.code).toBe(0);
  });

  it('sem a opção, os degradês ficam como estão', () => {
    const { pdf, report } = fix('degrades.pdf', { fixShadings: false });
    expect(report.shadingsReplaced).toBe(0);
    expect(inspect(pdf).pageContents()[0]).toContain('/Sh1 sh');
  });
});
