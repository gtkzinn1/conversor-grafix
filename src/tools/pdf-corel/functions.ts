import { isDict, type PdfValue } from './qpdf-json';

/**
 * Avaliação de funções PDF (ISO 32000-1, seção 7.10): tipos 0 (amostrada), 2 (exponencial),
 * 3 (costura) e 4 (calculadora PostScript, com limite de passos).
 * Usado para calcular a cor média de um degradê.
 */

export type PdfFunction = (inputs: readonly number[]) => number[];

export class UnsupportedFunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFunctionError';
  }
}

/** Acesso aos objetos do PDF: segue referências e entrega dados de streams já decodificados. */
export interface PdfSource {
  resolve(value: PdfValue | undefined): PdfValue | undefined;
  streamData(value: PdfValue | undefined): Uint8Array | undefined;
}

const MAX_FUNCTION_DEPTH = 16;
const MAX_SAMPLES = 1 << 24;
const POSTSCRIPT_STEP_LIMIT = 100_000;
const POSTSCRIPT_STACK_LIMIT = 100;

function numbers(value: PdfValue | undefined, source: PdfSource): number[] | undefined {
  const resolved = source.resolve(value);
  if (!Array.isArray(resolved)) return undefined;
  const result: number[] = [];
  for (const item of resolved) {
    const n = source.resolve(item);
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    result.push(n);
  }
  return result;
}

const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const interpolate = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);

function clipToRange(outputs: number[], range: number[] | undefined): number[] {
  if (!range) return outputs;
  return outputs.map((value, i) =>
    clamp(value, range[2 * i] ?? -Infinity, range[2 * i + 1] ?? Infinity),
  );
}

/** Compila a função PDF (dicionário, stream ou array de funções 1→1). */
export function compileFunction(
  value: PdfValue | undefined,
  source: PdfSource,
  depth = 0,
): PdfFunction {
  if (depth > MAX_FUNCTION_DEPTH) throw new UnsupportedFunctionError('Funções aninhadas demais');
  const resolved = source.resolve(value);

  // Array de funções de 1 saída: as saídas são concatenadas.
  if (Array.isArray(resolved)) {
    const parts = resolved.map((item) => compileFunction(item, source, depth + 1));
    return (inputs) => parts.flatMap((part) => part(inputs));
  }
  if (!isDict(resolved)) throw new UnsupportedFunctionError('Função ausente ou inválida');

  const type = source.resolve(resolved['/FunctionType']);
  const domain = numbers(resolved['/Domain'], source);
  const range = numbers(resolved['/Range'], source);
  if (!domain || domain.length < 2) throw new UnsupportedFunctionError('Função sem /Domain');
  const clipInput = (inputs: readonly number[]) =>
    inputs.map((x, i) => clamp(x, domain[2 * i] ?? -Infinity, domain[2 * i + 1] ?? Infinity));

  switch (type) {
    case 2:
      return exponential(resolved, source, clipInput, range);
    case 3:
      return stitching(resolved, source, clipInput, range, domain, depth);
    case 0:
      return sampled(value, resolved, source, clipInput, range, domain);
    case 4:
      return postscript(value, source, clipInput, range);
    default:
      throw new UnsupportedFunctionError(`FunctionType ${JSON.stringify(type)} não suportado`);
  }
}

function exponential(
  dict: Record<string, PdfValue>,
  source: PdfSource,
  clipInput: (inputs: readonly number[]) => number[],
  range: number[] | undefined,
): PdfFunction {
  const c0 = numbers(dict['/C0'], source) ?? [0];
  const c1 = numbers(dict['/C1'], source) ?? [1];
  const n = source.resolve(dict['/N']);
  if (typeof n !== 'number' || c0.length !== c1.length) {
    throw new UnsupportedFunctionError('Função exponencial inválida');
  }
  return (inputs) => {
    const x = clipInput(inputs)[0] ?? 0;
    const t = x ** n;
    return clipToRange(
      c0.map((a, i) => a + t * ((c1[i] ?? a) - a)),
      range,
    );
  };
}

function stitching(
  dict: Record<string, PdfValue>,
  source: PdfSource,
  clipInput: (inputs: readonly number[]) => number[],
  range: number[] | undefined,
  domain: number[],
  depth: number,
): PdfFunction {
  const functionsValue = source.resolve(dict['/Functions']);
  const bounds = numbers(dict['/Bounds'], source) ?? [];
  const encode = numbers(dict['/Encode'], source);
  if (!Array.isArray(functionsValue) || functionsValue.length === 0 || !encode) {
    throw new UnsupportedFunctionError('Função de costura inválida');
  }
  const k = functionsValue.length;
  if (bounds.length !== k - 1 || encode.length !== 2 * k) {
    throw new UnsupportedFunctionError('Função de costura com tamanhos inconsistentes');
  }
  const parts = functionsValue.map((f) => compileFunction(f, source, depth + 1));
  const d0 = domain[0] ?? 0;
  const d1 = domain[1] ?? 1;
  return (inputs) => {
    const x = clipInput(inputs)[0] ?? 0;
    let i = 0;
    while (i < k - 1 && x >= (bounds[i] ?? Infinity)) i++;
    const low = i === 0 ? d0 : (bounds[i - 1] ?? d0);
    const high = i === k - 1 ? d1 : (bounds[i] ?? d1);
    const t = interpolate(x, low, high, encode[2 * i] ?? 0, encode[2 * i + 1] ?? 1);
    const part = parts[i];
    if (!part) throw new UnsupportedFunctionError('Função de costura inválida');
    return clipToRange(part([t]), range);
  };
}

function sampled(
  value: PdfValue | undefined,
  dict: Record<string, PdfValue>,
  source: PdfSource,
  clipInput: (inputs: readonly number[]) => number[],
  range: number[] | undefined,
  domain: number[],
): PdfFunction {
  const size = numbers(dict['/Size'], source);
  const bps = source.resolve(dict['/BitsPerSample']);
  const data = source.streamData(value);
  if (!range || !size || typeof bps !== 'number' || !data) {
    throw new UnsupportedFunctionError('Função amostrada incompleta');
  }
  if (size.length !== 1 || domain.length !== 2) {
    throw new UnsupportedFunctionError('Função amostrada com mais de uma entrada');
  }
  if (![1, 2, 4, 8, 12, 16, 24, 32].includes(bps)) {
    throw new UnsupportedFunctionError(`BitsPerSample ${bps} inválido`);
  }
  const samples = size[0] ?? 0;
  const outputs = range.length / 2;
  if (!Number.isInteger(samples) || samples < 1 || samples * outputs > MAX_SAMPLES) {
    throw new UnsupportedFunctionError('Função amostrada grande demais');
  }
  const needed = Math.ceil((samples * outputs * bps) / 8);
  if (data.length < needed)
    throw new UnsupportedFunctionError('Função amostrada sem dados suficientes');

  const encode = numbers(dict['/Encode'], source) ?? [0, samples - 1];
  const decode = numbers(dict['/Decode'], source) ?? range;
  const max = 2 ** bps - 1;
  const read = (index: number): number => {
    // Leitura big-endian de `bps` bits a partir do bit index*bps.
    let bit = index * bps;
    let result = 0;
    for (let remaining = bps; remaining > 0;) {
      const byte = data[bit >> 3] ?? 0;
      const offset = bit & 7;
      const take = Math.min(remaining, 8 - offset);
      const chunk = (byte >> (8 - offset - take)) & ((1 << take) - 1);
      result = result * 2 ** take + chunk;
      remaining -= take;
      bit += take;
    }
    return result;
  };

  return (inputs) => {
    const x = clipInput(inputs)[0] ?? 0;
    const e = clamp(
      interpolate(x, domain[0] ?? 0, domain[1] ?? 1, encode[0] ?? 0, encode[1] ?? 0),
      0,
      samples - 1,
    );
    const i0 = Math.floor(e);
    const i1 = Math.min(samples - 1, i0 + 1);
    const frac = e - i0;
    const result: number[] = [];
    for (let j = 0; j < outputs; j++) {
      const s = read(i0 * outputs + j) * (1 - frac) + read(i1 * outputs + j) * frac;
      result.push(interpolate(s, 0, max, decode[2 * j] ?? 0, decode[2 * j + 1] ?? 1));
    }
    return clipToRange(result, range);
  };
}

// ---------- Tipo 4: calculadora PostScript ----------

type PsToken = number | boolean | string | PsBlock;
interface PsBlock {
  readonly block: PsToken[];
}

function parsePostScript(text: string): PsBlock {
  const tokens = text.match(/\{|\}|[^\s{}]+/g) ?? [];
  let index = 0;
  const parseBlock = (depth: number): PsBlock => {
    if (depth > 32) throw new UnsupportedFunctionError('Programa PostScript aninhado demais');
    const block: PsToken[] = [];
    while (index < tokens.length) {
      const token = tokens[index++] ?? '';
      if (token === '{') block.push(parseBlock(depth + 1));
      else if (token === '}') return { block };
      else if (token === 'true' || token === 'false') block.push(token === 'true');
      else if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) block.push(Number(token));
      else block.push(token);
    }
    throw new UnsupportedFunctionError('Programa PostScript sem "}"');
  };
  if (tokens[index++] !== '{') throw new UnsupportedFunctionError('Programa PostScript sem "{"');
  const program = parseBlock(0);
  if (index !== tokens.length) throw new UnsupportedFunctionError('Programa PostScript com sobra');
  return program;
}

function postscript(
  value: PdfValue | undefined,
  source: PdfSource,
  clipInput: (inputs: readonly number[]) => number[],
  range: number[] | undefined,
): PdfFunction {
  const data = source.streamData(value);
  if (!data || !range) throw new UnsupportedFunctionError('Função PostScript incompleta');
  const program = parsePostScript(new TextDecoder('latin1').decode(data));
  const outputs = range.length / 2;

  return (inputs) => {
    const stack: (number | boolean)[] = [...clipInput(inputs)];
    let steps = 0;
    const pop = (): number | boolean => {
      const item = stack.pop();
      if (item === undefined) throw new UnsupportedFunctionError('Pilha PostScript vazia');
      return item;
    };
    const num = (): number => {
      const item = pop();
      if (typeof item !== 'number') throw new UnsupportedFunctionError('Esperado número');
      return item;
    };
    const push = (item: number | boolean) => {
      if (stack.length >= POSTSCRIPT_STACK_LIMIT)
        throw new UnsupportedFunctionError('Pilha PostScript cheia');
      stack.push(item);
    };
    const execute = (op: string): void => {
      switch (op) {
        case 'abs':
          push(Math.abs(num()));
          break;
        case 'add': {
          const b = num();
          push(num() + b);
          break;
        }
        case 'sub': {
          const b = num();
          push(num() - b);
          break;
        }
        case 'mul': {
          const b = num();
          push(num() * b);
          break;
        }
        case 'div': {
          const b = num();
          const a = num();
          push(b === 0 ? 0 : a / b);
          break;
        }
        case 'idiv': {
          const b = Math.trunc(num());
          const a = Math.trunc(num());
          push(b === 0 ? 0 : Math.trunc(a / b));
          break;
        }
        case 'mod': {
          const b = Math.trunc(num());
          const a = Math.trunc(num());
          push(b === 0 ? 0 : a % b);
          break;
        }
        case 'neg':
          push(-num());
          break;
        case 'ceiling':
          push(Math.ceil(num()));
          break;
        case 'floor':
          push(Math.floor(num()));
          break;
        case 'round':
          push(Math.round(num()));
          break;
        case 'truncate':
          push(Math.trunc(num()));
          break;
        case 'cvi':
          push(Math.trunc(num()));
          break;
        case 'cvr':
          push(num());
          break;
        case 'sqrt':
          push(Math.sqrt(Math.max(0, num())));
          break;
        case 'sin':
          push(Math.sin((num() * Math.PI) / 180));
          break;
        case 'cos':
          push(Math.cos((num() * Math.PI) / 180));
          break;
        case 'atan': {
          const b = num();
          const a = num();
          const deg = (Math.atan2(a, b) * 180) / Math.PI;
          push(deg < 0 ? deg + 360 : deg);
          break;
        }
        case 'exp': {
          const b = num();
          push(num() ** b);
          break;
        }
        case 'ln':
          push(Math.log(num()));
          break;
        case 'log':
          push(Math.log10(num()));
          break;
        case 'dup': {
          const a = pop();
          push(a);
          push(a);
          break;
        }
        case 'pop':
          pop();
          break;
        case 'exch': {
          const b = pop();
          const a = pop();
          push(b);
          push(a);
          break;
        }
        case 'copy': {
          const n = num();
          if (n < 0 || n > stack.length) throw new UnsupportedFunctionError('copy inválido');
          for (const item of stack.slice(stack.length - n)) push(item);
          break;
        }
        case 'index': {
          const n = num();
          const item = stack[stack.length - 1 - n];
          if (item === undefined || n < 0) throw new UnsupportedFunctionError('index inválido');
          push(item);
          break;
        }
        case 'roll': {
          const j = num();
          const n = num();
          if (n < 0 || n > stack.length) throw new UnsupportedFunctionError('roll inválido');
          const part = stack.splice(stack.length - n, n);
          const shift = n === 0 ? 0 : ((j % n) + n) % n;
          stack.push(...part.slice(n - shift), ...part.slice(0, n - shift));
          break;
        }
        case 'eq': {
          const b = pop();
          push(pop() === b);
          break;
        }
        case 'ne': {
          const b = pop();
          push(pop() !== b);
          break;
        }
        case 'gt': {
          const b = num();
          push(num() > b);
          break;
        }
        case 'ge': {
          const b = num();
          push(num() >= b);
          break;
        }
        case 'lt': {
          const b = num();
          push(num() < b);
          break;
        }
        case 'le': {
          const b = num();
          push(num() <= b);
          break;
        }
        case 'and':
        case 'or':
        case 'xor': {
          const b = pop();
          const a = pop();
          if (typeof a === 'boolean' && typeof b === 'boolean')
            push(op === 'and' ? a && b : op === 'or' ? a || b : a !== b);
          else if (typeof a === 'number' && typeof b === 'number')
            push(op === 'and' ? a & b : op === 'or' ? a | b : a ^ b);
          else throw new UnsupportedFunctionError(`${op} com tipos diferentes`);
          break;
        }
        case 'not': {
          const a = pop();
          push(typeof a === 'boolean' ? !a : ~a);
          break;
        }
        case 'bitshift': {
          const s = num();
          const a = num();
          push(s >= 0 ? a << s : a >> -s);
          break;
        }
        case 'true':
          push(true);
          break;
        case 'false':
          push(false);
          break;
        default:
          throw new UnsupportedFunctionError(`Operador PostScript "${op}" não suportado`);
      }
    };

    // Blocos { } ficam pendentes e são consumidos pelo if/ifelse seguinte.
    const runWithBlocks = (block: PsBlock): void => {
      const pending: PsBlock[] = [];
      for (const token of block.block) {
        if (++steps > POSTSCRIPT_STEP_LIMIT)
          throw new UnsupportedFunctionError('Programa PostScript longo demais');
        if (typeof token === 'object') {
          pending.push(token);
          continue;
        }
        if (token === 'if' || token === 'ifelse') {
          const elseBlock = token === 'ifelse' ? pending.pop() : undefined;
          const thenBlock = pending.pop();
          const condition = pop();
          if (!thenBlock || (token === 'ifelse' && !elseBlock) || typeof condition !== 'boolean') {
            throw new UnsupportedFunctionError(`${token} inválido`);
          }
          if (condition) runWithBlocks(thenBlock);
          else if (elseBlock) runWithBlocks(elseBlock);
          continue;
        }
        if (pending.length > 0) throw new UnsupportedFunctionError('Bloco PostScript sem if');
        if (typeof token === 'number' || typeof token === 'boolean') push(token);
        else execute(token);
      }
      if (pending.length > 0) throw new UnsupportedFunctionError('Bloco PostScript sem if');
    };
    runWithBlocks(program);
    if (stack.length < outputs)
      throw new UnsupportedFunctionError('Função PostScript devolveu poucos valores');
    const result = stack
      .slice(stack.length - outputs)
      .map((item) => (typeof item === 'number' ? item : item ? 1 : 0));
    return clipToRange(result, range);
  };
}

/** Média da função ao longo de t ∈ [t0, t1] (amostragem uniforme). */
export function averageOverDomain(
  fn: PdfFunction,
  t0: number,
  t1: number,
  samples = 200,
): number[] {
  let sum: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const output = fn([t0 + ((t1 - t0) * i) / samples]);
    if (sum.length === 0) sum = output.map(() => 0);
    output.forEach((value, j) => {
      sum[j] = (sum[j] ?? 0) + value;
    });
  }
  return sum.map((value) => value / (samples + 1));
}
