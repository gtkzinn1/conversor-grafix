import { describe, expect, it } from 'vitest';
import { ContentSyntaxError, parseContent } from '../../src/tools/pdf-corel/content-lexer';

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const parse = (text: string) => parseContent(bytes(text));
const ops = (text: string) => parse(text).map((instruction) => instruction.op);

describe('parseContent', () => {
  it('lê operandos e operadores com posições no stream original', () => {
    const source = 'q 1 0 0 1 50 50 cm 0 0 100 100 re W n /Sh1 sh Q';
    const result = parse(source);
    expect(result.map((i) => i.op)).toEqual(['q', 'cm', 're', 'W', 'n', 'sh', 'Q']);
    const sh = result[5];
    expect(sh?.operands).toEqual([{ kind: 'name', value: 'Sh1' }]);
    expect(source.slice(sh?.start, sh?.end)).toBe('/Sh1 sh');
    expect(result[1]?.operands).toEqual([1, 0, 0, 1, 50, 50]);
  });

  it('números em todos os formatos', () => {
    expect(parse('-.5 +3 4. 0.25 -0 d')[0]?.operands).toEqual([-0.5, 3, 4, 0.25, -0]);
  });

  it('nomes com #xx', () => {
    expect(parse('/A#20B /PANTONE#20186#20C cs')[0]?.operands).toEqual([
      { kind: 'name', value: 'A B' },
      { kind: 'name', value: 'PANTONE 186 C' },
    ]);
  });

  it('textos com parênteses aninhados, escapes e octal', () => {
    const [instruction] = parse('(a(b)c\\)d\\n\\101\\\r\nz) Tj');
    const text = instruction?.operands[0];
    expect(text).toMatchObject({ kind: 'string' });
    expect(new TextDecoder('latin1').decode((text as { bytes: Uint8Array }).bytes)).toBe(
      'a(b)c)d\nAz',
    );
  });

  it('textos hexadecimais (com espaços e dígito ímpar)', () => {
    const text = parse('<48 65 6c6c 6F7> Tj')[0]?.operands[0] as { bytes: Uint8Array };
    expect(Array.from(text.bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x70]);
  });

  it('arrays, dicionários e marcações (BDC)', () => {
    const result = parse('[(a) -120 (b)] TJ /P <</MCID 3 /Alt (x)>> BDC EMC');
    expect(result.map((i) => i.op)).toEqual(['TJ', 'BDC', 'EMC']);
    expect(result[1]?.operands[1]).toMatchObject({ kind: 'dict' });
  });

  it('comentários são ignorados', () => {
    expect(ops('% comentário com sh\nq % outro\nQ')).toEqual(['q', 'Q']);
  });

  it('"sh" dentro de texto ou imagem embutida não vira operador', () => {
    const source = '(texto sh) Tj BI /W 2 /H 1 /CS /G /BPC 8 ID \x00sh EI Q';
    expect(ops(source)).toEqual(['Tj', 'BI', 'Q']);
  });

  it('imagem embutida com /L usa o tamanho declarado mesmo com "EI" nos dados', () => {
    const source = 'BI /W 4 /H 1 /CS /G /BPC 8 /L 4 ID a EIb EI Q';
    const result = parse(source);
    expect(result.map((i) => i.op)).toEqual(['BI', 'Q']);
    expect(source.slice(result[0]?.start, result[0]?.end)).toBe(
      source.slice(0, source.indexOf(' Q')),
    );
  });

  it('booleanos e null', () => {
    expect(parse('true false null x')[0]?.operands).toEqual([true, false, null]);
  });

  it('sintaxe inválida gera ContentSyntaxError', () => {
    for (const bad of ['(sem fim', '[1 2', '<4G> Tj', '1 2 3', ') Tj', '>> x', 'BI /W 1 ID abc']) {
      expect(() => parse(bad), bad).toThrow(ContentSyntaxError);
    }
  });

  it('aninhamento excessivo é recusado', () => {
    expect(() => parse(`${'['.repeat(100)}${']'.repeat(100)} x`)).toThrow(ContentSyntaxError);
  });

  it('tokens gigantes são recusados sem estourar a pilha', () => {
    expect(() => parse(`${'a'.repeat(1_000_000)} x`)).toThrow(ContentSyntaxError);
    expect(() => parse(`/${'a'.repeat(1_000_000)} x`)).toThrow(ContentSyntaxError);
    expect(() => parse(`(${'a'.repeat(1_000_000)}) Tj`)).not.toThrow();
  });

  it('lixo aleatório nunca derruba o leitor com outro tipo de erro', () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 300; round++) {
      const data = Uint8Array.from({ length: 200 }, () => Math.floor(random() * 256));
      try {
        parseContent(data);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentSyntaxError);
      }
    }
  });
});
