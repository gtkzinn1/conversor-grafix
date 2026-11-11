/**
 * Leitor de content stream de PDF (ISO 32000-1, seções 7.2–7.3 e 8.9.7).
 *
 * Lê operandos e operadores byte a byte (sem regex), guardando a posição de cada
 * instrução no stream original. Assim, a reescrita troca só os trechos necessários
 * e mantém todo o resto byte a byte igual.
 *
 * O conteúdo vem de arquivos de clientes: há limites de tamanho e de aninhamento,
 * e qualquer sintaxe inválida gera ContentSyntaxError (o stream fica sem alteração).
 */

export type Operand = number | boolean | null | PdfName | PdfString | Operand[] | PdfInlineDict;

export interface PdfName {
  readonly kind: 'name';
  readonly value: string;
}
export interface PdfString {
  readonly kind: 'string';
  readonly bytes: Uint8Array;
}
export interface PdfInlineDict {
  readonly kind: 'dict';
  readonly entries: ReadonlyMap<string, Operand>;
}

export interface Instruction {
  readonly op: string;
  readonly operands: readonly Operand[];
  /** Posição do primeiro byte da instrução (primeiro operando, ou o operador). */
  readonly start: number;
  /** Posição logo depois do operador (ou do EI, em imagens embutidas). */
  readonly end: number;
}

export class ContentSyntaxError extends Error {
  constructor(message: string, position: number) {
    super(`${message} (byte ${position})`);
    this.name = 'ContentSyntaxError';
  }
}

export const MAX_INSTRUCTIONS = 5_000_000;
const MAX_NESTING = 64;
/** Números, nomes e operadores reais têm poucos caracteres; limite contra arquivos hostis. */
const MAX_TOKEN_LENGTH = 4096;

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isWhitespace = (byte: number | undefined) => byte !== undefined && WHITESPACE.has(byte);
const isRegular = (byte: number | undefined) =>
  byte !== undefined && !WHITESPACE.has(byte) && !DELIMITERS.has(byte);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export const name = (value: string): PdfName => ({ kind: 'name', value });
export const isName = (operand: Operand | undefined): operand is PdfName =>
  typeof operand === 'object' &&
  operand !== null &&
  !Array.isArray(operand) &&
  operand.kind === 'name';
export const isNumber = (operand: Operand | undefined): operand is number =>
  typeof operand === 'number';

/** Valor especial que marca o fim de array/dicionário durante a leitura. */
const CLOSE_ARRAY = Symbol('fim do array');
const CLOSE_DICT = Symbol('fim do dicionário');
type Token = Operand | { readonly keyword: string } | typeof CLOSE_ARRAY | typeof CLOSE_DICT;

class Lexer {
  pos = 0;
  constructor(private readonly data: Uint8Array) {}

  private peek(offset = 0): number | undefined {
    return this.data[this.pos + offset];
  }

  skipWhitespaceAndComments(): void {
    for (;;) {
      const byte = this.peek();
      if (isWhitespace(byte)) this.pos++;
      else if (byte === 0x25 /* % */) {
        while (this.pos < this.data.length && this.peek() !== 0x0a && this.peek() !== 0x0d)
          this.pos++;
      } else return;
    }
  }

  atEnd(): boolean {
    this.skipWhitespaceAndComments();
    return this.pos >= this.data.length;
  }

  /** Lê o próximo token (operando completo ou palavra-chave). */
  next(depth = 0): Token {
    if (depth > MAX_NESTING) throw new ContentSyntaxError('Aninhamento excessivo', this.pos);
    this.skipWhitespaceAndComments();
    const byte = this.peek();
    if (byte === undefined) throw new ContentSyntaxError('Fim inesperado', this.pos);

    switch (byte) {
      case 0x28 /* ( */:
        return this.literalString();
      case 0x2f /* / */:
        return this.name();
      case 0x5b /* [ */: {
        this.pos++;
        const items: Operand[] = [];
        for (;;) {
          const token = this.next(depth + 1);
          if (token === CLOSE_ARRAY) return items;
          items.push(this.asOperand(token));
        }
      }
      case 0x5d /* ] */:
        this.pos++;
        return CLOSE_ARRAY;
      case 0x3c /* < */:
        if (this.peek(1) === 0x3c) {
          this.pos += 2;
          return this.dictionary(depth);
        }
        return this.hexString();
      case 0x3e /* > */:
        if (this.peek(1) === 0x3e) {
          this.pos += 2;
          return CLOSE_DICT;
        }
        throw new ContentSyntaxError('">" inesperado', this.pos);
      case 0x7b /* { */:
      case 0x7d /* } */:
      case 0x29 /* ) */:
        throw new ContentSyntaxError(
          `Caractere inesperado "${String.fromCharCode(byte)}"`,
          this.pos,
        );
      default:
        return this.regular();
    }
  }

  private asOperand(token: Token): Operand {
    if (token === CLOSE_ARRAY || token === CLOSE_DICT) {
      throw new ContentSyntaxError('Fechamento sem abertura', this.pos);
    }
    if (typeof token === 'object' && token !== null && 'keyword' in token) {
      throw new ContentSyntaxError(`Operador "${token.keyword}" dentro de operando`, this.pos);
    }
    return token;
  }

  private dictionary(depth: number): PdfInlineDict {
    const entries = new Map<string, Operand>();
    for (;;) {
      const key = this.next(depth + 1);
      if (key === CLOSE_DICT) return { kind: 'dict', entries };
      if (!isName(key as Operand))
        throw new ContentSyntaxError('Chave de dicionário inválida', this.pos);
      entries.set((key as PdfName).value, this.asOperand(this.next(depth + 1)));
    }
  }

  private regular(): Token {
    const start = this.pos;
    while (isRegular(this.peek())) {
      this.pos++;
      if (this.pos - start > MAX_TOKEN_LENGTH)
        throw new ContentSyntaxError('Token longo demais', start);
    }
    if (this.pos === start) throw new ContentSyntaxError('Token vazio', this.pos);
    const text = String.fromCharCode(...this.data.subarray(start, this.pos));
    if (NUMBER.test(text)) return Number(text);
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    return { keyword: text };
  }

  private name(): PdfName {
    this.pos++; // "/"
    const bytes: number[] = [];
    while (isRegular(this.peek())) {
      if (bytes.length > MAX_TOKEN_LENGTH)
        throw new ContentSyntaxError('Nome longo demais', this.pos);
      const byte = this.data[this.pos++] ?? 0;
      if (byte === 0x23 /* # */) {
        const hex = String.fromCharCode(this.peek() ?? 0, this.peek(1) ?? 0);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          this.pos += 2;
          continue;
        }
      }
      bytes.push(byte);
    }
    return name(String.fromCharCode(...bytes));
  }

  private literalString(): PdfString {
    this.pos++; // "("
    const bytes: number[] = [];
    let depth = 1;
    for (;;) {
      const byte = this.data[this.pos++];
      if (byte === undefined) throw new ContentSyntaxError('Texto sem fechamento', this.pos);
      if (byte === 0x5c /* \ */) {
        const escaped = this.data[this.pos++];
        if (escaped === undefined) throw new ContentSyntaxError('Escape no fim', this.pos);
        const simple: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (simple[escaped] !== undefined) bytes.push(simple[escaped]);
        else if (escaped >= 0x30 && escaped <= 0x37) {
          let value = escaped - 0x30;
          for (let i = 0; i < 2; i++) {
            const digit = this.peek();
            if (digit === undefined || digit < 0x30 || digit > 0x37) break;
            value = value * 8 + (digit - 0x30);
            this.pos++;
          }
          bytes.push(value & 0xff);
        } else if (escaped === 0x0d) {
          if (this.peek() === 0x0a) this.pos++;
        } else if (escaped !== 0x0a) bytes.push(escaped);
        continue;
      }
      if (byte === 0x28) depth++;
      if (byte === 0x29 && --depth === 0) return { kind: 'string', bytes: Uint8Array.from(bytes) };
      bytes.push(byte);
    }
  }

  private hexString(): PdfString {
    this.pos++; // "<"
    const digits: number[] = [];
    for (;;) {
      const byte = this.data[this.pos++];
      if (byte === undefined)
        throw new ContentSyntaxError('Texto hexadecimal sem fechamento', this.pos);
      if (byte === 0x3e) break;
      if (isWhitespace(byte)) continue;
      const value = parseInt(String.fromCharCode(byte), 16);
      if (Number.isNaN(value))
        throw new ContentSyntaxError('Dígito hexadecimal inválido', this.pos);
      digits.push(value);
    }
    if (digits.length % 2 === 1) digits.push(0);
    const bytes = new Uint8Array(digits.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = ((digits[2 * i] ?? 0) << 4) | (digits[2 * i + 1] ?? 0);
    }
    return { kind: 'string', bytes };
  }

  /**
   * Imagem embutida: depois de "ID" e um espaço, os dados vão até "EI" cercado de espaços.
   * Usa /L ou /Length quando existir; senão procura o "EI" (método usual dos leitores).
   */
  skipInlineImageData(dict: ReadonlyMap<string, Operand>): void {
    if (isWhitespace(this.peek())) this.pos++;
    const declared = dict.get('L') ?? dict.get('Length');
    if (isNumber(declared) && declared >= 0 && this.pos + declared <= this.data.length) {
      const after = this.pos + declared;
      let probe = after;
      while (isWhitespace(this.data[probe])) probe++;
      if (
        this.data[probe] === 0x45 &&
        this.data[probe + 1] === 0x49 &&
        !isRegular(this.data[probe + 2])
      ) {
        this.pos = probe + 2;
        return;
      }
    }
    for (let i = this.pos; i < this.data.length - 1; i++) {
      if (
        this.data[i] === 0x45 &&
        this.data[i + 1] === 0x49 &&
        (i === this.pos || isWhitespace(this.data[i - 1])) &&
        !isRegular(this.data[i + 2])
      ) {
        this.pos = i + 2;
        return;
      }
    }
    throw new ContentSyntaxError('Imagem embutida sem EI', this.pos);
  }
}

/** Lê o content stream inteiro em instruções (operandos + operador, com posições). */
export function parseContent(data: Uint8Array): Instruction[] {
  const lexer = new Lexer(data);
  const instructions: Instruction[] = [];
  let operands: Operand[] = [];
  let start = -1;

  while (!lexer.atEnd()) {
    if (instructions.length >= MAX_INSTRUCTIONS) {
      throw new ContentSyntaxError('Conteúdo grande demais', lexer.pos);
    }
    const tokenStart = lexer.pos;
    const token = lexer.next();
    if (start < 0) start = tokenStart;

    if (typeof token === 'object' && token !== null && 'keyword' in token) {
      const op = token.keyword;
      if (op === 'BI') {
        // Pares chave/valor até "ID".
        const entries = new Map<string, Operand>();
        for (;;) {
          const key = lexer.next();
          if (typeof key === 'object' && key !== null && 'keyword' in key && key.keyword === 'ID')
            break;
          if (!isName(key as Operand))
            throw new ContentSyntaxError('Imagem embutida inválida', lexer.pos);
          const value = lexer.next();
          if (typeof value === 'object' && value !== null && 'keyword' in value) {
            // Valores abreviados de imagem embutida (ex.: /CS /G) chegam como nome; palavras soltas são erro.
            throw new ContentSyntaxError('Valor inválido em imagem embutida', lexer.pos);
          }
          entries.set((key as PdfName).value, value as Operand);
        }
        lexer.skipInlineImageData(entries);
        instructions.push({
          op: 'BI',
          operands: [{ kind: 'dict', entries }],
          start,
          end: lexer.pos,
        });
      } else {
        instructions.push({ op, operands, start, end: lexer.pos });
      }
      operands = [];
      start = -1;
      continue;
    }
    if (token === CLOSE_ARRAY || token === CLOSE_DICT) {
      throw new ContentSyntaxError('Fechamento sem abertura', lexer.pos);
    }
    operands.push(token);
  }
  if (operands.length > 0) throw new ContentSyntaxError('Operandos sem operador no fim', lexer.pos);
  return instructions;
}
