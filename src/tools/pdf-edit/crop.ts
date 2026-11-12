import type { PageInfo } from '../pdf-corel/pages';

/**
 * Geometria do corte. A área vem da tela: em pontos, com origem no canto superior esquerdo
 * da página como ela aparece (já girada e limitada à CropBox, igual ao pdf.js).
 */

export interface DisplayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Box = readonly [number, number, number, number];

/** Menor lado aceito para a área de corte, em pontos (~1 mm). */
export const MIN_CROP_SIZE = 3;

function normalizeBox(box: readonly number[]): Box {
  const [a = 0, b = 0, c = 0, d = 0] = box;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** Rotação da página em 0, 90, 180 ou 270 (valores fora do padrão são arredondados). */
export function normalizeRotation(rotate: number): 0 | 90 | 180 | 270 {
  const quarter = ((Math.round(rotate / 90) % 4) + 4) % 4;
  return ([0, 90, 180, 270] as const)[quarter] ?? 0;
}

/** Parte visível da página: CropBox ∩ MediaBox (MediaBox se a interseção for vazia). */
export function visibleBox(page: PageInfo): Box {
  const media = normalizeBox(page.mediaBox);
  if (page.cropBox === undefined) return media;
  const crop = normalizeBox(page.cropBox);
  const box: Box = [
    Math.max(media[0], crop[0]),
    Math.max(media[1], crop[1]),
    Math.min(media[2], crop[2]),
    Math.min(media[3], crop[3]),
  ];
  return box[2] > box[0] && box[3] > box[1] ? box : media;
}

/** Tamanho da página como aparece na tela (largura e altura, em pontos). */
export function displaySize(page: PageInfo): { width: number; height: number } {
  const [x0, y0, x1, y1] = visibleBox(page);
  const turned = normalizeRotation(page.rotate) % 180 !== 0;
  return turned ? { width: y1 - y0, height: x1 - x0 } : { width: x1 - x0, height: y1 - y0 };
}

/**
 * Converte a área da tela para uma caixa no espaço da página (sem rotação), limitada à parte
 * visível. Devolve `undefined` se a área ficar fora da página ou pequena demais.
 */
export function displayRectToBox(page: PageInfo, rect: DisplayRect): Box | undefined {
  const size = displaySize(page);
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(size.width, rect.x + rect.width);
  const bottom = Math.min(size.height, rect.y + rect.height);
  if (right - left < MIN_CROP_SIZE || bottom - top < MIN_CROP_SIZE) return undefined;
  const x = left;
  const y = top;
  const w = right - left;
  const h = bottom - top;

  const [vx0, vy0, vx1, vy1] = visibleBox(page);
  switch (normalizeRotation(page.rotate)) {
    case 0:
      return [vx0 + x, vy1 - y - h, vx0 + x + w, vy1 - y];
    case 90:
      return [vx0 + y, vy0 + x, vx0 + y + h, vy0 + x + w];
    case 180:
      return [vx1 - x - w, vy0 + y, vx1 - x, vy0 + y + h];
    case 270:
      return [vx1 - y - h, vy1 - x - w, vx1 - y, vy1 - x];
  }
}
