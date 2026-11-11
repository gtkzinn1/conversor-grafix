import { isDict, isRef, keyOf, type PdfDict, type PdfJsonDocument } from './qpdf-json';

/**
 * Páginas de amostras: um quadrado para cada degradê original (linear ou radial), no fim do PDF.
 *
 * Nas páginas originais todos os degradês viram cor sólida; aqui o usuário copia o degradê
 * e aplica no Corel. O formato "caminho W n /Sh sh" é o que o CorelDRAW 27 importa como
 * degradê editável (rodada 8, 2026-11-11); degradês em padrão (/Pattern scn) ele recusa.
 */

export interface Swatch {
  /** Dicionário do degradê original (tipo 2 ou 3). */
  readonly shading: PdfDict;
  /** Página onde o degradê aparece pela primeira vez. */
  readonly page: number;
}

/** Limite de amostras (protege contra PDFs com milhares de degradês). */
export const MAX_SWATCHES = 200;

const MARGIN = 36;
const GAP = 28;
const TITLE_HEIGHT = 34;
const LABEL_OFFSET = 12;

const format = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** Texto em WinAnsi para string literal do PDF (acentos em octal). */
function pdfText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code >= 0x20 && code < 0x7f) out += char;
    else if (code >= 0xa0 && code <= 0xff) out += `\\${code.toString(8)}`;
    else out += '?';
  }
  return `(${out})`;
}

const numbers = (value: unknown): number[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'number') ? value : undefined;

/**
 * Cópia do degradê com /Coords refeitas para preencher o quadrado (x, y, lado),
 * mantendo a direção do linear e a proporção do radial.
 */
function fitShading(
  doc: PdfJsonDocument,
  shading: PdfDict,
  x: number,
  y: number,
  side: number,
): PdfDict | undefined {
  const copy = structuredClone(shading);
  // A /BBox original está no espaço de onde o degradê veio; aqui ela recortaria errado.
  delete copy['/BBox'];
  const coords = numbers(doc.resolve(shading['/Coords']));
  const type = doc.resolve(shading['/ShadingType']);
  const [cx, cy] = [x + side / 2, y + side / 2];
  if (type === 2 && coords?.length === 4) {
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 0] = coords;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const [ux, uy] = length > 0 ? [(x1 - x0) / length, (y1 - y0) / length] : [1, 0];
    // Meio eixo que cobre o quadrado inteiro na direção do degradê.
    const half = (side / 2) * (Math.abs(ux) + Math.abs(uy));
    copy['/Coords'] = [cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half];
    return copy;
  }
  if (type === 3 && coords?.length === 6) {
    const [x0 = 0, y0 = 0, r0 = 0, x1 = 0, y1 = 0, r1 = 1] = coords;
    const minX = Math.min(x0 - r0, x1 - r1);
    const maxX = Math.max(x0 + r0, x1 + r1);
    const minY = Math.min(y0 - r0, y1 - r1);
    const maxY = Math.max(y0 + r0, y1 + r1);
    const extent = Math.max(maxX - minX, maxY - minY);
    const scale = extent > 0 ? side / extent : 1;
    const [mx, my] = [(minX + maxX) / 2, (minY + maxY) / 2];
    const mapX = (v: number) => cx + (v - mx) * scale;
    const mapY = (v: number) => cy + (v - my) * scale;
    copy['/Coords'] = [mapX(x0), mapY(y0), r0 * scale, mapX(x1), mapY(y1), r1 * scale];
    return copy;
  }
  return undefined;
}

/**
 * Acrescenta as páginas de amostras no fim do documento (mesmo tamanho da 1ª página).
 * Devolve quantas páginas foram criadas.
 */
export function addSwatchPages(
  doc: PdfJsonDocument,
  swatches: readonly Swatch[],
  pageSize: readonly [number, number],
): number {
  const list = swatches.slice(0, MAX_SWATCHES);
  if (list.length === 0) return 0;
  const pagesRef = doc.dict(doc.rootKey)?.['/Pages'];
  if (!isRef(pagesRef) || !isDict(doc.dict(keyOf(pagesRef)))) return 0;

  const [width, height] = [Math.max(pageSize[0], 200), Math.max(pageSize[1], 200)];
  const usableWidth = width - 2 * MARGIN;
  const usableHeight = height - 2 * MARGIN - TITLE_HEIGHT;
  const side = Math.min(96, usableWidth, usableHeight - LABEL_OFFSET - 4);
  const columns = Math.max(1, Math.floor((usableWidth + GAP) / (side + GAP)));
  const rows = Math.max(1, Math.floor((usableHeight + GAP) / (side + GAP)));
  const perPage = columns * rows;
  const font: PdfDict = {
    '/Type': '/Font',
    '/Subtype': '/Type1',
    '/BaseFont': '/Helvetica',
    '/Encoding': '/WinAnsiEncoding',
  };

  const newPages: string[] = [];
  for (let start = 0; start < list.length; start += perPage) {
    const shadings: PdfDict = {};
    const parts = [
      `BT /F1 14 Tf ${format(MARGIN)} ${format(height - MARGIN - 14)} Td ${pdfText('Degradês originais')} Tj ET`,
      `BT /F1 9 Tf ${format(MARGIN)} ${format(height - MARGIN - 28)} Td ${pdfText('Copie o degradê do quadrado para o objeto que ficou em cor sólida.')} Tj ET`,
    ];
    list.slice(start, start + perPage).forEach((swatch, offset) => {
      const index = start + offset + 1;
      const column = offset % columns;
      const row = Math.floor(offset / columns);
      const x = MARGIN + column * (side + GAP);
      const y = height - MARGIN - TITLE_HEIGHT - side - row * (side + GAP);
      const fitted = fitShading(doc, swatch.shading, x, y, side);
      if (!fitted) return;
      const name = `/Sw${String(index)}`;
      shadings[name] = fitted;
      const box = `${format(x)} ${format(y)} ${format(side)} ${format(side)} re`;
      parts.push(
        `q ${box} W n ${name} sh Q`,
        `BT /F1 9 Tf ${format(x)} ${format(y - LABEL_OFFSET)} Td ${pdfText(`Degradê ${String(index)} (pág. ${String(swatch.page)})`)} Tj ET`,
      );
    });
    if (Object.keys(shadings).length === 0) continue;
    const contents = doc.add({
      stream: { dict: {}, data: btoa(parts.join('\n')) },
    });
    newPages.push(
      doc.add({
        value: {
          '/Type': '/Page',
          '/Parent': pagesRef,
          '/MediaBox': [0, 0, width, height],
          '/Resources': { '/Shading': shadings, '/Font': { '/F1': font } },
          '/Contents': contents,
        },
      }),
    );
  }
  if (newPages.length === 0) return 0;

  doc.edit(keyOf(pagesRef), (pages) => {
    const kids = doc.resolve(pages['/Kids']);
    pages['/Kids'] = [...(Array.isArray(kids) ? kids : []), ...newPages];
    const count = doc.resolve(pages['/Count']);
    pages['/Count'] = (typeof count === 'number' ? count : 0) + newPages.length;
  });
  return newPages.length;
}
