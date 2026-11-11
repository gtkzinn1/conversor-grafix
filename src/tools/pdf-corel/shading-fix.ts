import { ContentSyntaxError, isName, parseContent, type Instruction } from './content-lexer';
import {
  averageOverDomain,
  compileFunction,
  UnsupportedFunctionError,
  type PdfFunction,
  type PdfSource,
} from './functions';
import { listPages } from './pages';
import {
  isDict,
  isRef,
  keyOf,
  type PdfDict,
  type PdfJsonDocument,
  type PdfValue,
} from './qpdf-json';

/**
 * Troca de degradês por cor sólida (seção 2.1b da especificação).
 *
 * O CorelDRAW cria o recorte de um "caminho W n /Sh sh", mas descarta o preenchimento
 * do degradê (sh), deixando o objeto vazio. A troca validada é:
 *   caminho W|W* n [cm] /Sh sh  →  cor-média  caminho  f|f*
 * A cor é a média da função do degradê, no mesmo espaço de cor (ou no espaço alternativo).
 */

export interface ShadingFixResult {
  readonly replaced: number;
  readonly warnings: readonly string[];
}

/** Caminho: operadores de construção (m l c v y re h). */
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h']);
/** Limite de Form XObjects distintos processados (proteção contra arquivos hostis). */
const MAX_FORMS = 10_000;

class SkipShading extends Error {}

interface Color {
  /** Operador de cor de preenchimento com operandos, ex.: "0 1 1 0.17 k". */
  readonly fill: string;
  /** Mesmo para traço (RG, K, G). */
  readonly stroke: string;
}

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
  if (type !== 2 && type !== 3)
    throw new SkipShading(`degradê tipo ${JSON.stringify(type)} não suportado`);
  const converter = deviceConverter(shading['/ColorSpace'], doc, source);
  let fn: PdfFunction;
  try {
    fn = compileFunction(shading['/Function'], source);
  } catch (error) {
    if (error instanceof UnsupportedFunctionError) throw new SkipShading(error.message);
    throw error;
  }
  const domainValue = doc.resolve(shading['/Domain']);
  const t0 = Array.isArray(domainValue) && typeof domainValue[0] === 'number' ? domainValue[0] : 0;
  const t1 = Array.isArray(domainValue) && typeof domainValue[1] === 'number' ? domainValue[1] : 1;
  let average: number[];
  try {
    average = averageOverDomain((inputs) => converter.convert(fn(inputs)), t0, t1);
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

/** Recursos da página, com herança pela árvore /Parent. */
function pageResources(doc: PdfJsonDocument, pageKey: string): PdfValue | undefined {
  let key: string | undefined = pageKey;
  for (let depth = 0; key !== undefined && depth < 64; depth++) {
    const node = doc.dict(key);
    if (!node) return undefined;
    if (node['/Resources'] !== undefined) return node['/Resources'];
    const parent: PdfValue | undefined = node['/Parent'];
    key = isRef(parent) ? keyOf(parent) : undefined;
  }
  return undefined;
}

interface RewriteContext {
  readonly doc: PdfJsonDocument;
  readonly source: PdfSource;
  readonly resources: PdfValue | undefined;
  readonly warnings: Map<string, number>;
  readonly forms: { key: string; resources: PdfValue | undefined }[];
}

const warn = (context: RewriteContext, message: string) => {
  context.warnings.set(message, (context.warnings.get(message) ?? 0) + 1);
};

/** Reescreve um content stream; devolve o novo conteúdo (ou null se nada mudou) e o total trocado. */
export function rewriteContent(
  data: Uint8Array,
  context: RewriteContext,
): { data: Uint8Array | null; replaced: number } {
  let instructions: Instruction[];
  try {
    instructions = parseContent(data);
  } catch (error) {
    if (error instanceof ContentSyntaxError) {
      warn(context, 'Uma página tem conteúdo com sintaxe inválida e foi mantida como estava.');
      return { data: null, replaced: 0 };
    }
    throw error;
  }

  const text = (start: number, end: number) =>
    new TextDecoder('latin1').decode(data.subarray(start, end));
  const replacements: { start: number; end: number; text: string }[] = [];
  let replaced = 0;
  // Pilha (q/Q) de "trocamos um padrão por cor e o espaço de cor deixou de ser /Pattern".
  let fillOverride = false;
  let strokeOverride = false;
  const stack: [boolean, boolean][] = [];

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction === undefined) break;
    const { op, operands } = instruction;

    if (op === 'q') stack.push([fillOverride, strokeOverride]);
    else if (op === 'Q') [fillOverride, strokeOverride] = stack.pop() ?? [false, false];
    else if (op === 'cs') fillOverride = false;
    else if (op === 'CS') strokeOverride = false;
    else if (op === 'Do') {
      const name = operands[0];
      if (!isName(name)) continue;
      const xobject = resource(context.doc, context.resources, '/XObject', name.value);
      if (isRef(xobject) && context.doc.dict(keyOf(xobject))?.['/Subtype'] === '/Form') {
        context.forms.push({ key: keyOf(xobject), resources: context.resources });
      }
    } else if (op === 'sh') {
      const result = replaceShading(instructions, i, context, text);
      if (result) {
        replacements.push(result);
        replaced++;
      }
    } else if (op === 'scn' || op === 'SCN') {
      const name = operands.at(-1);
      if (!isName(name)) continue;
      const stroke = op === 'SCN';
      const color = patternColor(name.value, context);
      if (color) {
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

  if (replacements.length === 0) return { data: null, replaced: 0 };

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
  return { data: output, replaced };
}

function patternColor(name: string, context: RewriteContext): Color | undefined {
  const pattern = context.doc.resolve(resource(context.doc, context.resources, '/Pattern', name));
  if (!isDict(pattern) || context.doc.resolve(pattern['/PatternType']) !== 2) return undefined;
  const shading = context.doc.resolve(pattern['/Shading']);
  if (!isDict(shading)) return undefined;
  try {
    return averageShadingColor(shading, context.doc, context.source);
  } catch (error) {
    if (error instanceof SkipShading) {
      warn(context, `Um degradê foi mantido (${error.message}); o Corel pode não mostrá-lo.`);
      return undefined;
    }
    throw error;
  }
}

function replaceShading(
  instructions: readonly Instruction[],
  index: number,
  context: RewriteContext,
  text: (start: number, end: number) => string,
): { start: number; end: number; text: string } | undefined {
  const sh = instructions[index];
  if (sh === undefined) return undefined;
  const name = sh.operands[0];
  if (!isName(name)) return undefined;

  // Padrão esperado, de trás para frente: [cm...] n W|W* <caminho>.
  let j = index - 1;
  while (instructions[j]?.op === 'cm') j--;
  const endPath = instructions[j];
  const clip = instructions[j - 1];
  if (endPath?.op !== 'n' || (clip?.op !== 'W' && clip?.op !== 'W*')) {
    warn(context, 'Um degradê sem recorte foi mantido como estava; o Corel pode não mostrá-lo.');
    return undefined;
  }
  let k = j - 2;
  while (k >= 0 && PATH_OPS.has(instructions[k]?.op ?? '')) k--;
  const first = instructions[k + 1];
  const last = instructions[j - 2];
  if (k + 1 > j - 2 || !first || !last || (first.op !== 'm' && first.op !== 're')) {
    warn(context, 'Um degradê com recorte fora do padrão foi mantido como estava.');
    return undefined;
  }

  const shading = context.doc.resolve(
    resource(context.doc, context.resources, '/Shading', name.value),
  );
  if (!isDict(shading)) {
    warn(context, 'Um degradê sem definição foi mantido como estava.');
    return undefined;
  }
  let color: Color;
  try {
    color = averageShadingColor(shading, context.doc, context.source);
  } catch (error) {
    if (error instanceof SkipShading) {
      warn(context, `Um degradê foi mantido (${error.message}); o Corel pode não mostrá-lo.`);
      return undefined;
    }
    throw error;
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
  const forms: { key: string; resources: PdfValue | undefined }[] = [];
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

  for (const page of listPages(doc)) {
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
    const context: RewriteContext = {
      doc,
      source,
      resources: pageResources(doc, page.key),
      warnings,
      forms,
    };
    const result = rewriteContent(joined, context);
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
    const resources = dict['/Resources'] ?? form.resources;
    const result = rewriteContent(data, { doc, source, resources, warnings, forms });
    if (result.data) {
      doc.replaceStream(form.key, encodeBase64(result.data));
      replaced += result.replaced;
    }
  }

  const messages = [...warnings].map(([message, count]) =>
    count > 1 ? `${message} (${count}×)` : message,
  );
  return { replaced, warnings: messages };
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
