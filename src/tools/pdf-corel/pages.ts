import { isRef, keyOf, type PdfJsonDocument, type PdfValue } from './qpdf-json';

export interface PageInfo {
  /** Chave do objeto da página no JSON ("obj:N G R"). */
  readonly key: string;
  /** [x0, y0, x1, y1] em pontos, já considerando herança da árvore de páginas. */
  readonly mediaBox: readonly number[];
  /** CropBox (também herdável), quando existir. */
  readonly cropBox?: readonly number[];
  readonly rotate: number;
}

const MAX_DEPTH = 64;

function toBox(value: PdfValue | undefined): number[] | undefined {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number')
    ? value
    : undefined;
}

/**
 * Lista as páginas na ordem do documento, percorrendo a árvore /Pages
 * (com proteção contra ciclos e profundidade excessiva).
 */
export function listPages(doc: PdfJsonDocument): PageInfo[] {
  const pages: PageInfo[] = [];
  const visited = new Set<string>();
  const root = doc.dict(doc.rootKey);
  const rootPages = root?.['/Pages'];
  if (!isRef(rootPages)) return pages;

  const walk = (
    ref: string,
    inheritedBox: number[] | undefined,
    inheritedCrop: number[] | undefined,
    inheritedRotate: number,
    depth: number,
  ) => {
    const key = keyOf(ref);
    if (visited.has(key) || depth > MAX_DEPTH) return;
    visited.add(key);
    const node = doc.dict(key);
    if (node === undefined) return;
    const box = toBox(doc.resolve(node['/MediaBox'])) ?? inheritedBox;
    const crop = toBox(doc.resolve(node['/CropBox'])) ?? inheritedCrop;
    const rotateValue = doc.resolve(node['/Rotate']);
    const rotate = typeof rotateValue === 'number' ? rotateValue : inheritedRotate;
    if (node['/Type'] === '/Pages' || Array.isArray(doc.resolve(node['/Kids']))) {
      const kids = doc.resolve(node['/Kids']);
      if (Array.isArray(kids)) {
        for (const kid of kids) if (isRef(kid)) walk(kid, box, crop, rotate, depth + 1);
      }
      return;
    }
    const mediaBox = box ?? [0, 0, 612, 792];
    pages.push(
      crop === undefined ? { key, mediaBox, rotate } : { key, mediaBox, cropBox: crop, rotate },
    );
  };

  walk(rootPages, undefined, undefined, 0, 0);
  return pages;
}

/** Compara tamanhos de página com tolerância de arredondamento. */
export function samePageGeometry(a: readonly PageInfo[], b: readonly PageInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((page, index) => {
    const other = b[index];
    if (!other || page.rotate % 360 !== other.rotate % 360) return false;
    return page.mediaBox.every((value, i) => Math.abs(value - (other.mediaBox[i] ?? NaN)) < 0.01);
  });
}
