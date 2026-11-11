import { describe, expect, it } from 'vitest';
import {
  averageOverDomain,
  compileFunction,
  UnsupportedFunctionError,
  type PdfSource,
} from '../../src/tools/pdf-corel/functions';
import type { PdfValue } from '../../src/tools/pdf-corel/qpdf-json';

/** Fonte de teste: "N 0 R" aponta para objects[N]; dados de stream em data[N]. */
function source(
  objects: Record<string, PdfValue> = {},
  data: Record<string, string> = {},
): PdfSource {
  const id = (value: PdfValue | undefined) =>
    typeof value === 'string' ? /^(\d+) 0 R$/.exec(value)?.[1] : undefined;
  return {
    resolve: (value) => {
      const n = id(value);
      return n === undefined ? value : objects[n];
    },
    streamData: (value) => {
      const n = id(value);
      const text = n === undefined ? undefined : data[n];
      return text === undefined ? undefined : Uint8Array.from(text, (char) => char.charCodeAt(0));
    },
  };
}

const exp = (c0: number[], c1: number[], n = 1) => ({
  '/FunctionType': 2,
  '/Domain': [0, 1],
  '/C0': c0,
  '/C1': c1,
  '/N': n,
});
const close = (values: number[], expected: number[]) =>
  values.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? NaN, 4));

describe('tipo 2 (exponencial)', () => {
  it('interpola linearmente e com expoente', () => {
    const linear = compileFunction(exp([0, 0, 0, 0], [0, 1, 1, 0]), source());
    close(linear([0.25]), [0, 0.25, 0.25, 0]);
    const squared = compileFunction(exp([0], [1], 2), source());
    close(squared([0.5]), [0.25]);
  });

  it('valores padrão C0=[0] e C1=[1], e entrada limitada ao Domain', () => {
    const fn = compileFunction({ '/FunctionType': 2, '/Domain': [0, 1], '/N': 1 }, source());
    close(fn([2]), [1]);
    close(fn([-1]), [0]);
  });
});

describe('tipo 3 (costura)', () => {
  it('escolhe a função pelo /Bounds e aplica /Encode', () => {
    const fn = compileFunction(
      {
        '/FunctionType': 3,
        '/Domain': [0, 1],
        '/Bounds': [0.5],
        '/Encode': [0, 1, 1, 0],
        '/Functions': [exp([0], [1]), exp([0], [1])],
      },
      source(),
    );
    close(fn([0.25]), [0.5]);
    close(fn([0.5]), [1]); // segunda função com Encode invertido: começa em 1
    close(fn([1]), [0]);
  });

  it('referências e tamanhos inconsistentes', () => {
    const objects = { '5': exp([1], [0]) };
    const fn = compileFunction(
      {
        '/FunctionType': 3,
        '/Domain': [0, 1],
        '/Bounds': [],
        '/Encode': [0, 1],
        '/Functions': ['5 0 R'],
      },
      source(objects),
    );
    close(fn([0]), [1]);
    expect(() =>
      compileFunction(
        {
          '/FunctionType': 3,
          '/Domain': [0, 1],
          '/Bounds': [0.5],
          '/Encode': [0, 1],
          '/Functions': ['5 0 R'],
        },
        source(objects),
      ),
    ).toThrow(UnsupportedFunctionError);
  });
});

describe('tipo 0 (amostrada)', () => {
  it('interpola amostras de 8 bits', () => {
    const fn = compileFunction(
      '9 0 R',
      source(
        {
          '9': {
            '/FunctionType': 0,
            '/Domain': [0, 1],
            '/Range': [0, 1, 0, 1, 0, 1],
            '/Size': [2],
            '/BitsPerSample': 8,
          },
        },
        { '9': '\xff\x00\x00\x00\x00\xff' },
      ),
    );
    close(fn([0]), [1, 0, 0]);
    close(fn([0.5]), [0.5, 0, 0.5]);
    close(fn([1]), [0, 0, 1]);
  });

  it('amostras de 4 bits e dados insuficientes', () => {
    const dict = {
      '/FunctionType': 0,
      '/Domain': [0, 1],
      '/Range': [0, 1],
      '/Size': [2],
      '/BitsPerSample': 4,
    };
    close(compileFunction('9 0 R', source({ '9': dict }, { '9': '\x0f' }))([1]), [1]);
    expect(() =>
      compileFunction('9 0 R', source({ '9': { ...dict, '/Size': [5] } }, { '9': '\x0f' })),
    ).toThrow(UnsupportedFunctionError);
  });
});

describe('tipo 4 (calculadora PostScript)', () => {
  const ps = (program: string, range = [0, 1]) =>
    compileFunction(
      '7 0 R',
      source({ '7': { '/FunctionType': 4, '/Domain': [0, 1], '/Range': range } }, { '7': program }),
    );

  it('aritmética e pilha', () => {
    close(ps('{ 0.5 mul 0.25 add }')([0.5]), [0.5]);
    close(ps('{ dup mul }')([0.5]), [0.25]);
    close(ps('{ 1 exch sub }')([0.25]), [0.75]);
    // [x 0.1 0.2] → roll(3, 1) → [0.2 x 0.1]; saem os 2 últimos.
    close(ps('{ 0.1 0.2 3 1 roll }', [0, 1, 0, 1])([0.3]), [0.3, 0.1]);
    close(ps('{ dup 2 copy add add add }')([0.2]), [0.8]);
    close(ps('{ 0.5 1 index add exch pop }')([0.2]), [0.7]);
  });

  it('if e ifelse', () => {
    const fn = ps('{ dup 0.5 gt { pop 1 } { pop 0 } ifelse }');
    close(fn([0.7]), [1]);
    close(fn([0.2]), [0]);
    close(ps('{ dup 0.5 lt { pop 0.1 } if }')([0.2]), [0.1]);
  });

  it('a saída respeita o /Range', () => {
    close(ps('{ 5 add }')([0]), [1]);
  });

  it('programas inválidos ou hostis são recusados', () => {
    expect(() => ps('{ 1 2 add')).toThrow(UnsupportedFunctionError);
    expect(() => ps('{ pop pop }')([0])).toThrow(UnsupportedFunctionError);
    expect(() => ps('{ desconhecido }')([0])).toThrow(UnsupportedFunctionError);
    // Pilha estourando (dup em sequência) é limitada.
    expect(() => ps(`{ ${'dup '.repeat(500)}}`)([0])).toThrow(UnsupportedFunctionError);
    // Aninhamento muito profundo.
    expect(() => ps(`${'{ '.repeat(100)}${'} '.repeat(100)}`)).toThrow(UnsupportedFunctionError);
  });
});

describe('geral', () => {
  it('array de funções concatena as saídas', () => {
    const fn = compileFunction([exp([0], [1]), exp([1], [0])], source());
    close(fn([0.25]), [0.25, 0.75]);
  });

  it('tipo desconhecido e funções aninhadas demais', () => {
    expect(() => compileFunction({ '/FunctionType': 9, '/Domain': [0, 1] }, source())).toThrow(
      UnsupportedFunctionError,
    );
    const objects: Record<string, PdfValue> = {
      '1': {
        '/FunctionType': 3,
        '/Domain': [0, 1],
        '/Bounds': [],
        '/Encode': [0, 1],
        '/Functions': ['1 0 R'],
      },
    };
    expect(() => compileFunction('1 0 R', source(objects))).toThrow(UnsupportedFunctionError);
  });

  it('média ao longo do domínio', () => {
    close(averageOverDomain(compileFunction(exp([0, 1], [1, 1]), source()), 0, 1), [0.5, 1]);
  });
});
