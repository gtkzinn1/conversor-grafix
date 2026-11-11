import { ContentSyntaxError, isName, parseContent, type Instruction } from './content-lexer';
import {
  averageOverDomain,
  compileFunction,
  UnsupportedFunctionError,
  type PdfFunction,
  type PdfSource,
} from './functions';
import { listPages } from './pages';
import { addSwatchPages, type Swatch } from './swatch-page';
import {
  isDict,
  isRef,
  keyOf,
  type PdfDict,
  type PdfJsonDocument,
  type PdfValue,
} from './qpdf-json';

/**
 * Troca de TODOS os degradês por cor sólida (seção 2.1b da especificação).
 *
 * O CorelDRAW cria o recorte de um "caminho W n /Sh sh", mas descarta o preenchimento
 * do degradê (sh), deixando o objeto vazio. A troca validada é:
 *   caminho W|W* n [cm] /Sh sh  →  cor-média  caminho  f|f*
 * Qualquer outro "sh" vira o preenchimento da área inteira com a cor média, isolado em q…Q:
 * o sh pinta tudo dentro do recorte atual, então o efeito na tela é o mesmo.
 * Degradês sem cor calculável (malhas, espaços de cor exóticos) viram uma cor aproximada.
 * Nas páginas originais nenhum degradê fica (decisão do usuário, 2026-11-11). Os degradês
 * lineares e radiais originais vão para páginas de amostras no fim do arquivo, no formato
 * "recorte + sh", que o Corel 27 importa como degradê editável (rodada 8).
 */

export interface ShadingFixResult {
  readonly replaced: number;
  readonly warnings: readonly string[];
  /** Páginas de amostras acrescentadas no fim e quantos degradês elas mostram. */
  readonly swatchPages: number;
  readonly swatches: number;
}

/** Caminho: operadores de construção (m l c v y re h). */
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h']);
/** Limite de Form XObjects distintos processados (proteção contra arquivos hostis). */
const MAX_FORMS = 10_000;

class SkipShading extends Error {}

/** Matriz afim PDF [a b c d e f]. */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** CTM' = M × CTM (ordem do operador cm). */
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
function invert(m: Matrix): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

interface Color {
  /** Operador de cor de preenchimento com operandos, ex.: "0 1 1 0.17 k". */
  readonly fill: string;
  /** Mesmo para traço (RG, K, G). */
  readonly stroke: string;
}

/** Cor usada quando não dá para calcular a média (cinza médio). */
const FALLBACK_COLOR: Color = { fill: '0.5 g', stroke: '0.5 G' };

const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 10000) / 10000;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(4).replace(/\.?0+$/, '');
};

/** Resolve o espaço de cor e devolve uma função que converte componentes para um espaço Device*. */
function deviceConverter(
  value: PdfValue | undefined,
  doc: PdfJsonDocument,
  source: PdfSource,
  depth = 0,
): { space: 'gray' | 'rgb' | 'cmyk'; convert: (components: number[]) => number[] } {
  if (depth > 8) throw new SkipShading('espaço de cor aninhado demais');
  const resolved = doc.resolve(value);
  const identity = (components: number[]) => components;
  if (typeof resolved === 'string') {
    if (resolved === '/DeviceGray' || resolved === '/G' || resolved === '/CalGray')
      return { space: 'gray', convert: identity };
    if (resolved === '/DeviceRGB' || resolved === '/RGB')
      return { space: 'rgb', convert: identity };
    if (resolved === '/DeviceCMYK' || resolved === '/CMYK')
      return { space: 'cmyk', convert: identity };
    throw new SkipShading(`espaço de cor ${resolved} não suportado`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0)
    throw new SkipShading('espaço de cor inválido');
  const family = doc.resolve(resolved[0]);
  switch (family) {
    case '/CalRGB':
      return { space: 'rgb', convert: identity };
    case '/CalGray':
      return { space: 'gray', convert: identity };
    case '/ICCBased': {
      const stream = doc.resolve(resolved[1]);
      if (!isDict(stream)) throw new SkipShading('perfil ICC inválido');
      if (stream['/Alternate'] !== undefined) {
        try {
          return deviceConverter(stream['/Alternate'], doc, source, depth + 1);
        } catch {
          // Alternativo estranho: cai no número de componentes.
        }
      }
      const n = doc.resolve(stream['/N']);
      if (n === 1) return { space: 'gray', convert: identity };
      if (n === 3) return { space: 'rgb', convert: identity };
      if (n === 4) return { space: 'cmyk', convert: identity };
      throw new SkipShading('perfil ICC com número de componentes inválido');
    }
    case '/Separation':
    case '/DeviceN': {
      // Aproximação documentada: tinta → espaço alternativo pela tintTransform.
      const alternate = deviceConverter(resolved[2], doc, source, depth + 1);
      let tint: PdfFunction;
      try {
        tint = compileFunction(resolved[3], source);
      } catch (error) {
        throw new SkipShading(error instanceof Error ? error.message : 'tintTransform inválida');
      }
      return {
        space: alternate.space,
        convert: (components) => alternate.convert(tint(components)),
      };
    }
    case '/Indexed': {
      const base = deviceConverter(resolved[1], doc, source, depth + 1);
      const hival = doc.resolve(resolved[2]);
      const lookupValue = resolved[3];
      const lookup =
        typeof doc.resolve(lookupValue) === 'string'
          ? decodePdfString(doc.resolve(lookupValue) as string)
          : source.streamData(lookupValue);
      if (typeof hival !== 'number' || !lookup) throw new SkipShading('tabela de cores inválida');
      const width = base.space === 'gray' ? 1 : base.space === 'rgb' ? 3 : 4;
      return {
        space: base.space,
        convert: ([index = 0]) => {
          const i = Math.max(0, Math.min(hival, Math.round(index)));
          const values = Array.from(
            { length: width },
            (_, j) => (lookup[i * width + j] ?? 0) / 255,
          );
          return base.convert(values);
        },
      };
    }
    default:
      throw new SkipShading(`espaço de cor ${JSON.stringify(family)} não suportado`);
  }
}

/** Strings do JSON do qpdf: "u:texto" ou "b:hex". */
function decodePdfString(value: string): Uint8Array | undefined {
  if (value.startsWith('b:')) {
    const hex = value.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    return bytes;
  }
  if (value.startsWith('u:')) return new TextEncoder().encode(value.slice(2));
  return undefined;
}

/** Cor média de um degradê axial (2) ou radial (3). */
export function averageShadingColor(
  shading: PdfDict,
  doc: PdfJsonDocument,
  source: PdfSource,
): Color {
  const type = doc.resolve(shading['/ShadingType']);
  if (type !== 1 && type !== 2 && type !== 3)
    throw new SkipShading(`degradê de malha, tipo ${JSON.stringify(type)}`);
  const converter = deviceConverter(shading['/ColorSpace'], doc, source);
  let fn: PdfFunction;
  try {
    fn = compileFunction(shading['/Function'], source);
  } catch (error) {
    if (error instanceof UnsupportedFunctionError) throw new SkipShading(error.message);
    throw error;
  }
  const domainValue = doc.resolve(shading['/Domain']);
  const domain = (i: number, fallback: number) => {
    const value = Array.isArray(domainValue) ? domainValue[i] : undefined;
    return typeof value === 'number' ? value : fallback;
  };
  const color = (inputs: readonly number[]) => converter.convert(fn(inputs));
  let average: number[];
  try {
    if (type === 1) {
      // Degradê baseado em função (2 entradas): média numa grade 21 × 21 do /Domain.
      const [x0, x1, y0, y1] = [domain(0, 0), domain(1, 1), domain(2, 0), domain(3, 1)];
      const steps = 20;
      const sum: number[] = [];
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
          const output = color([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * j) / steps]);
          output.forEach((value, c) => {
            sum[c] = (sum[c] ?? 0) + value;
          });
        }
      }
      average = sum.map((value) => value / (steps + 1) ** 2);
    } else {
      average = averageOverDomain(color, domain(0, 0), domain(1, 1));
    }
  } catch (error) {
    if (error instanceof UnsupportedFunctionError) throw new SkipShading(error.message);
    throw error;
  }
  const expected = converter.space === 'gray' ? 1 : converter.space === 'rgb' ? 3 : 4;
  if (average.length < expected || average.some((v) => !Number.isFinite(v))) {
    throw new SkipShading('a função não gerou uma cor válida');
  }
  const values = average
    .slice(0, expected)
    .map((v) => formatNumber(Math.min(1, Math.max(0, v))))
    .join(' ');
  const [fillOp, strokeOp] =
    converter.space === 'gray' ? ['g', 'G'] : converter.space === 'rgb' ? ['rg', 'RG'] : ['k', 'K'];
  return { fill: `${values} ${fillOp}`, stroke: `${values} ${strokeOp}` };
}

/**
 * Cor sólida para o degradê: a média quando dá para calcular; senão a cor de fundo
 * (/Background) ou cinza médio, com aviso de cor aproximada.
 */
function solidColorFor(shading: PdfValue | undefined, context: RewriteContext): Color {
  const dict = context.doc.resolve(shading);
  if (!isDict(dict)) {
    warn(context, 'Um degradê sem definição virou cinza; confira a cor no Corel.');
    return FALLBACK_COLOR;
  }
  const type = context.doc.resolve(dict['/ShadingType']);
  if (type === 2 || type === 3) {
    const id = isRef(shading) ? shading : JSON.stringify(dict);
    if (!context.swatches.has(id)) context.swatches.set(id, { shading: dict, page: context.page });
  }
  try {
    return averageShadingColor(dict, context.doc, context.source);
  } catch (error) {
    if (!(error instanceof SkipShading)) throw error;
    warn(
      context,
      `Um degradê virou uma cor aproximada (${error.message}); confira a cor no Corel.`,
    );
    return backgroundColor(dict, context) ?? FALLBACK_COLOR;
  }
}

/** Cor de fundo declarada pelo degradê (/Background), quando houver. */
function backgroundColor(shading: PdfDict, context: RewriteContext): Color | undefined {
  const background = context.doc.resolve(shading['/Background']);
  if (!Array.isArray(background)) return undefined;
  const components = background.filter((value): value is number => typeof value === 'number');
  if (components.length !== background.length) return undefined;
  try {
    const converter = deviceConverter(shading['/ColorSpace'], context.doc, context.source);
    const values = converter.convert(components);
    const expected = converter.space === 'gray' ? 1 : converter.space === 'rgb' ? 3 : 4;
    if (values.length < expected || values.some((v) => !Number.isFinite(v))) return undefined;
    const text = values
      .slice(0, expected)
      .map((v) => formatNumber(Math.min(1, Math.max(0, v))))
      .join(' ');
    const [fillOp, strokeOp] =
      converter.space === 'gray'
        ? ['g', 'G']
        : converter.space === 'rgb'
          ? ['rg', 'RG']
          : ['k', 'K'];
    return { fill: `${text} ${fillOp}`, stroke: `${text} ${strokeOp}` };
  } catch {
    return undefined;
  }
}

/** Busca um recurso (ex.: /Shading /Sh1) no dicionário de recursos. */
function resource(
  doc: PdfJsonDocument,
  resources: PdfValue | undefined,
  category: string,
  name: string,
) {
  const dict = doc.resolve(resources);
  if (!isDict(dict)) return undefined;
  const group = doc.resolve(dict[category]);
  if (!isDict(group)) return undefined;
  return group[`/${name}`];
}

/** Recursos da página, com herança pela árvore /Parent; `owner` é o objeto que os contém. */
function pageResources(
  doc: PdfJsonDocument,
  pageKey: string,
): { value: PdfValue | undefined; owner: string | undefined } {
  let key: string | undefined = pageKey;
  for (let depth = 0; key !== undefined && depth < 64; depth++) {
    const node = doc.dict(key);
    if (!node) break;
    if (node['/Resources'] !== undefined) return { value: node['/Resources'], owner: key };
    const parent: PdfValue | undefined = node['/Parent'];
    key = isRef(parent) ? keyOf(parent) : undefined;
  }
  return { value: undefined, owner: undefined };
}

/**
 * Nomes usados por cada dicionário de recursos (somando todos os conteúdos que o usam).
 * `null` = algum conteúdo não pôde ser lido; aí nada é retirado desse dicionário.
 */
type ResourceUsage = Map<string, { owner: string; value: PdfValue; names: Set<string> | null }>;

function recordUsage(
  usage: ResourceUsage,
  owner: string | undefined,
  value: PdfValue | undefined,
  names: ReadonlySet<string> | null,
): void {
  if (owner === undefined || value === undefined) return;
  // Recursos indiretos são compartilháveis: a chave é o próprio objeto; diretos, o dono.
  const id = isRef(value) ? keyOf(value) : `${owner}#direto`;
  const entry = usage.get(id) ?? { owner, value, names: new Set<string>() };
  if (names === null || entry.names === null) entry.names = null;
  else for (const name of names) entry.names.add(name);
  usage.set(id, entry);
}

/** Retira /Shading e padrões de degradê (/Pattern tipo 2) que nenhum conteúdo usa mais. */
function pruneUnusedShadings(doc: PdfJsonDocument, usage: ResourceUsage): void {
  for (const { owner, value, names } of usage.values()) {
    if (names === null) continue;
    const prune = (resources: PdfDict) => {
      const shadings = doc.resolve(resources['/Shading']);
      if (isDict(shadings) && !isRef(resources['/Shading'])) {
        const kept = Object.entries(shadings).filter(([key]) => names.has(key.slice(1)));
        if (kept.length === 0) delete resources['/Shading'];
        else resources['/Shading'] = Object.fromEntries(kept);
      } else if (isRef(resources['/Shading']) && isDict(shadings)) {
        // Dicionário compartilhado: só sai inteiro, quando nada nele é usado.
        const used = Object.keys(shadings).some((key) => names.has(key.slice(1)));
        if (!used) delete resources['/Shading'];
      }
      const patterns = doc.resolve(resources['/Pattern']);
      if (isDict(patterns) && !isRef(resources['/Pattern'])) {
        const kept = Object.entries(patterns).filter(([key, entry]) => {
          const pattern = doc.resolve(entry);
          const isShadingPattern = isDict(pattern) && doc.resolve(pattern['/PatternType']) === 2;
          return !isShadingPattern || names.has(key.slice(1));
        });
        if (kept.length === 0) delete resources['/Pattern'];
        else resources['/Pattern'] = Object.fromEntries(kept);
      }
    };
    if (isRef(value)) {
      if (isDict(doc.resolve(value))) doc.edit(keyOf(value), prune);
    } else if (isDict(value)) {
      doc.edit(owner, (dict) => {
        const resources = dict['/Resources'];
        if (isDict(resources)) prune(resources);
      });
    }
  }
}

interface RewriteContext {
  readonly doc: PdfJsonDocument;
  readonly source: PdfSource;
  readonly resources: PdfValue | undefined;
  /** Nomes de recursos usados pelo conteúdo reescrito (preenchido por rewriteContent). */
  readonly usedNames?: Set<string>;
  /** Área do conteúdo no espaço inicial do stream: MediaBox da página ou BBox do Form. */
  readonly area: readonly [number, number, number, number];
  readonly warnings: Map<string, number>;
  readonly forms: { key: string; resources: PdfValue | undefined; page: number }[];
  /** Página (1, 2, …) onde o conteúdo aparece, para identificar as amostras. */
  readonly page: number;
  /** Degradês originais encontrados, sem repetir (chave = referência ou o próprio dicionário). */
  readonly swatches: Map<string, Swatch>;
}

const warn = (context: RewriteContext, message: string) => {
  context.warnings.set(message, (context.warnings.get(message) ?? 0) + 1);
};

/** Reescreve um content stream; devolve o novo conteúdo (ou null se nada mudou) e o total trocado. */
export function rewriteContent(
  data: Uint8Array,
  context: RewriteContext,
): { data: Uint8Array | null; replaced: number; usedNames: Set<string> | null } {
  let instructions: Instruction[];
  try {
    instructions = parseContent(data);
  } catch (error) {
    if (error instanceof ContentSyntaxError) {
      warn(context, 'Uma página tem conteúdo com sintaxe inválida e foi mantida como estava.');
      return { data: null, replaced: 0, usedNames: null };
    }
    throw error;
  }
  // Nomes usados como operando (recursos), exceto os de degradês trocados (removidos abaixo).
  const usedNames = new Set<string>();
  const removedNames = new Set<string>();

  const text = (start: number, end: number) =>
    new TextDecoder('latin1').decode(data.subarray(start, end));
  const replacements: { start: number; end: number; text: string }[] = [];
  let replaced = 0;
  // Pilha (q/Q) de "trocamos um padrão por cor e o espaço de cor deixou de ser /Pattern".
  let fillOverride = false;
  let strokeOverride = false;
  let ctm: Matrix = IDENTITY;
  const stack: [boolean, boolean, Matrix][] = [];

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction === undefined) break;
    const { op, operands } = instruction;

    if (op === 'q') stack.push([fillOverride, strokeOverride, ctm]);
    else if (op === 'Q') {
      [fillOverride, strokeOverride, ctm] = stack.pop() ?? [false, false, IDENTITY];
    } else if (op === 'cm') {
      const values = operands.filter((value): value is number => typeof value === 'number');
      if (values.length === 6) ctm = multiply(values as unknown as Matrix, ctm);
    } else if (op === 'cs') fillOverride = false;
    else if (op === 'CS') strokeOverride = false;
    else if (op === 'Do') {
      const name = operands[0];
      if (!isName(name)) continue;
      const xobject = resource(context.doc, context.resources, '/XObject', name.value);
      if (isRef(xobject) && context.doc.dict(keyOf(xobject))?.['/Subtype'] === '/Form') {
        context.forms.push({
          key: keyOf(xobject),
          resources: context.resources,
          page: context.page,
        });
      }
    } else if (op === 'sh') {
      const result = replaceShading(instructions, i, context, text, ctm);
      if (result) {
        replacements.push(result);
        replaced++;
        const name = operands[0];
        if (isName(name)) removedNames.add(name.value);
        continue;
      }
    } else if (op === 'scn' || op === 'SCN') {
      const name = operands.at(-1);
      if (!isName(name)) continue;
      const stroke = op === 'SCN';
      const color = patternColor(name.value, context);
      if (color) {
        removedNames.add(name.value);
        replacements.push({
          start: instruction.start,
          end: instruction.end,
          text: stroke ? color.stroke : color.fill,
        });
        replaced++;
        if (stroke) strokeOverride = true;
        else fillOverride = true;
      } else if (stroke ? strokeOverride : fillOverride) {
        // Outro padrão (não trocado) depois de uma troca: restaura o espaço /Pattern antes dele.
        replacements.push({
          start: instruction.start,
          end: instruction.start,
          text: stroke ? '/Pattern CS ' : '/Pattern cs ',
        });
      }
    }
  }

  for (const { op, operands } of instructions) {
    for (const operand of operands) {
      if (isName(operand) && !(op === 'sh' || op === 'scn' || op === 'SCN'))
        usedNames.add(operand.value);
    }
    // sh/scn que NÃO foram trocados continuam usando o recurso.
    if (op === 'sh' || op === 'scn' || op === 'SCN') {
      const name = operands.at(-1);
      if (isName(name) && !removedNames.has(name.value)) usedNames.add(name.value);
    }
  }

  if (replacements.length === 0) return { data: null, replaced: 0, usedNames };

  // Monta o novo stream: trechos originais intactos + trechos trocados.
  replacements.sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let cursor = 0;
  for (const replacement of replacements) {
    parts.push(data.subarray(cursor, replacement.start), encoder.encode(replacement.text));
    cursor = replacement.end;
  }
  parts.push(data.subarray(cursor));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return { data: output, replaced, usedNames };
}

function patternColor(name: string, context: RewriteContext): Color | undefined {
  const pattern = context.doc.resolve(resource(context.doc, context.resources, '/Pattern', name));
  if (!isDict(pattern) || context.doc.resolve(pattern['/PatternType']) !== 2) return undefined;
  return solidColorFor(pattern['/Shading'], context);
}

function replaceShading(
  instructions: readonly Instruction[],
  index: number,
  context: RewriteContext,
  text: (start: number, end: number) => string,
  ctm: Matrix,
): { start: number; end: number; text: string } | undefined {
  const sh = instructions[index];
  if (sh === undefined) return undefined;
  const name = sh.operands[0];
  if (!isName(name)) return undefined;
  const color = solidColorFor(
    resource(context.doc, context.resources, '/Shading', name.value),
    context,
  );

  // Padrão validado, de trás para frente: [cm...] n W|W* <caminho>.
  let j = index - 1;
  while (instructions[j]?.op === 'cm') j--;
  const endPath = instructions[j];
  const clip = instructions[j - 1];
  let k = j - 2;
  while (k >= 0 && PATH_OPS.has(instructions[k]?.op ?? '')) k--;
  const first = instructions[k + 1];
  const last = instructions[j - 2];
  const validated =
    endPath?.op === 'n' &&
    (clip?.op === 'W' || clip?.op === 'W*') &&
    k + 1 <= j - 2 &&
    (first?.op === 'm' || first?.op === 're');

  if (!validated || !last) {
    // Outro formato: troca só o "sh" pelo preenchimento da área inteira (o recorte atual limita).
    const area = areaPath(context.area, ctm);
    return { start: sh.start, end: sh.end, text: area ? `q ${color.fill} ${area} f Q` : '' };
  }

  const path = text(first.start, last.end);
  const fill = clip.op === 'W*' ? 'f*' : 'f';
  const next = instructions[index + 1];
  if (next === undefined || next.op === 'Q') {
    // Caso comum (técnica validada): o bloco termina aqui, então recorte, cm e cor não afetam mais nada.
    return { start: first.start, end: sh.end, text: `${color.fill}\n${path}\n${fill}` };
  }
  // Há desenho depois, no mesmo bloco: preenche isolado (q…Q) e mantém recorte e cm como estavam.
  const transforms = instructions
    .slice(j + 1, index)
    .map((cm) => text(cm.start, cm.end))
    .join('\n');
  return {
    start: first.start,
    end: sh.end,
    text: `q\n${color.fill}\n${path}\n${fill}\nQ\n${path}\n${clip.op} n${transforms ? `\n${transforms}` : ''}`,
  };
}

/** Retângulo da área (no espaço inicial do stream) escrito no espaço atual (desfaz a CTM). */
function areaPath(
  area: readonly [number, number, number, number],
  ctm: Matrix,
): string | undefined {
  const inverse = invert(ctm);
  if (!inverse) return undefined;
  const [x0, y0, x1, y1] = area;
  const [a, b, c, d] = [
    apply(inverse, x0, y0),
    apply(inverse, x1, y0),
    apply(inverse, x1, y1),
    apply(inverse, x0, y1),
  ].map(([x, y]) => `${formatNumber(x)} ${formatNumber(y)}`);
  return `${a} m ${b} l ${c} l ${d} l h`;
}

/** Objetos cujos dados (decodificados) a troca de degradês precisa ler ou reescrever. */
export function streamsNeededForShadings(doc: PdfJsonDocument): string[] {
  const needed = new Set<string>();
  for (const page of listPages(doc)) {
    const contents = doc.dict(page.key)?.['/Contents'];
    const refs = isRef(contents)
      ? [contents]
      : Array.isArray(doc.resolve(contents))
        ? (doc.resolve(contents) as PdfValue[])
        : [];
    for (const ref of refs) if (isRef(ref)) needed.add(keyOf(ref));
  }
  for (const key of doc.keys()) {
    const dict = doc.dict(key);
    if (!dict || !('stream' in (doc.entry(key) ?? {}))) continue;
    if (dict['/Subtype'] === '/Form' || dict['/FunctionType'] !== undefined) needed.add(key);
  }
  return [...needed];
}

/**
 * Aplica a troca em todas as páginas e Form XObjects (recursivamente, sem repetir).
 * `streams` traz os dados decodificados dos objetos de streamsNeededForShadings.
 */
export function applyShadingFix(
  doc: PdfJsonDocument,
  streams: ReadonlyMap<string, Uint8Array>,
): ShadingFixResult {
  const source: PdfSource = {
    resolve: (value) => doc.resolve(value),
    streamData: (value) => (isRef(value) ? streams.get(keyOf(value)) : undefined),
  };
  const warnings = new Map<string, number>();
  const forms: RewriteContext['forms'] = [];
  const swatches = new Map<string, Swatch>();
  const visitedForms = new Set<string>();
  // Páginas podem compartilhar o mesmo conteúdo: cada conjunto de streams é reescrito uma vez.
  const visitedContents = new Set<string>();
  const encodeBase64 = (bytes: Uint8Array) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };
  let replaced = 0;
  const usage: ResourceUsage = new Map();

  const pages = listPages(doc);
  for (const [pageIndex, page] of pages.entries()) {
    const pageDict = doc.dict(page.key);
    if (!pageDict) continue;
    const contents = pageDict['/Contents'];
    const list = isRef(contents) ? [contents] : doc.resolve(contents);
    if (!Array.isArray(list) || list.length === 0) continue;
    const refs = list.filter(isRef);
    const contentsKey = refs.join('|');
    if (visitedContents.has(contentsKey)) continue;
    visitedContents.add(contentsKey);
    const chunks = refs.map((ref) => streams.get(keyOf(ref)));
    if (chunks.some((chunk) => chunk === undefined)) continue;
    // Vários streams formam um só conteúdo (operadores podem atravessar a divisa).
    const joined = joinWithNewline(chunks as Uint8Array[]);
    const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.mediaBox;
    const resources = pageResources(doc, page.key);
    const context: RewriteContext = {
      doc,
      source,
      resources: resources.value,
      area: [x0, y0, x1, y1],
      warnings,
      forms,
      page: pageIndex + 1,
      swatches,
    };
    const result = rewriteContent(joined, context);
    recordUsage(usage, resources.owner, resources.value, result.usedNames);
    const firstRef = refs[0];
    if (result.data && firstRef !== undefined) {
      doc.replaceStream(keyOf(firstRef), encodeBase64(result.data));
      if (refs.length > 1) {
        doc.edit(page.key, (target) => {
          target['/Contents'] = firstRef;
        });
      }
      replaced += result.replaced;
    }
  }

  // Form XObjects encontrados nas páginas (e dentro de outros Forms).
  // Cada Form é processado uma vez só (protege contra referência circular).
  for (
    let form = forms.shift();
    form !== undefined && visitedForms.size < MAX_FORMS;
    form = forms.shift()
  ) {
    if (visitedForms.has(form.key)) continue;
    visitedForms.add(form.key);
    const dict = doc.dict(form.key);
    const data = streams.get(form.key);
    if (!dict || !data) continue;
    const ownResources = dict['/Resources'];
    const resources = ownResources ?? form.resources;
    const bbox = doc.resolve(dict['/BBox']);
    const box = Array.isArray(bbox) ? bbox.filter((v): v is number => typeof v === 'number') : [];
    const [bx0 = -1e4, by0 = -1e4, bx1 = 1e4, by1 = 1e4] = box.length === 4 ? box : [];
    const result = rewriteContent(data, {
      doc,
      source,
      resources,
      area: [bx0, by0, bx1, by1],
      warnings,
      forms,
      page: form.page,
      swatches,
    });
    if (ownResources !== undefined) recordUsage(usage, form.key, ownResources, result.usedNames);
    if (result.data) {
      doc.replaceStream(form.key, encodeBase64(result.data));
      replaced += result.replaced;
    }
  }

  pruneUnusedShadings(doc, usage);
  const [px0 = 0, py0 = 0, px1 = 595, py1 = 842] = pages[0]?.mediaBox ?? [];
  const swatchPages = addSwatchPages(doc, [...swatches.values()], [px1 - px0, py1 - py0]);

  const messages = [...warnings].map(([message, count]) =>
    count > 1 ? `${message} (${count}×)` : message,
  );
  return { replaced, warnings: messages, swatchPages, swatches: swatches.size };
}

function joinWithNewline(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length + 1, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
    output[offset++] = 0x0a;
  }
  return output;
}
