import type { PdfPageSize } from '../../lib/shared/tasks/convert-image';

/**
 * Monta um PDF 1.4 com uma imagem por página. Lógica pura, sem DOM: recebe as imagens já
 * codificadas (JPEG original ou pixels comprimidos em zlib) e devolve os pedaços do arquivo.
 * Sem object streams, como as outras saídas do app, para o CorelDRAW.
 */

export interface PdfImage {
  /** Dimensões gravadas no arquivo (antes da orientação EXIF). */
  readonly width: number;
  readonly height: number;
  readonly colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  readonly filter: 'DCTDecode' | 'FlateDecode';
  readonly data: Uint8Array;
  /** CMYK do Photoshop (Adobe APP14): valores invertidos. */
  readonly invertCmyk?: boolean;
  /** Transparência: 8 bits por pixel, em zlib (FlateDecode). */
  readonly alpha?: Uint8Array;
  /** Orientação EXIF (1 a 8), aplicada na página sem recomprimir a imagem. */
  readonly orientation: number;
  /** Resolução da imagem; sem ela, 72 DPI. */
  readonly dpi: number | null;
}

type PageSize = PdfPageSize;

export interface PageLayout {
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Retângulo da imagem na página (em pontos). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const MM = 72 / 25.4;
const PAPER: Record<Exclude<PageSize, 'image'>, readonly [number, number]> = {
  a4: [210 * MM, 297 * MM],
  a3: [297 * MM, 420 * MM],
};

/** Orientações 5 a 8 giram 90°: largura e altura trocam na página. */
export const isRotated = (orientation: number) => orientation >= 5 && orientation <= 8;

/**
 * Posição da imagem na página. "Tamanho da imagem": a página tem o tamanho da imagem na sua
 * resolução, mais a margem. A4/A3: a imagem preenche a área útil, centralizada, e a folha
 * fica deitada quando a imagem é mais larga que alta.
 */
export function layoutPage(
  image: Pick<PdfImage, 'width' | 'height' | 'orientation' | 'dpi'>,
  page: PageSize,
  marginMm: number,
): PageLayout {
  const rotated = isRotated(image.orientation);
  const pixelsWide = rotated ? image.height : image.width;
  const pixelsHigh = rotated ? image.width : image.height;
  const margin = marginMm * MM;
  if (page === 'image') {
    const scale = 72 / (image.dpi ?? 72);
    const width = pixelsWide * scale;
    const height = pixelsHigh * scale;
    return {
      pageWidth: width + 2 * margin,
      pageHeight: height + 2 * margin,
      x: margin,
      y: margin,
      width,
      height,
    };
  }
  const [short, long] = PAPER[page];
  const landscape = pixelsWide > pixelsHigh;
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const scale = Math.min(
    (pageWidth - 2 * margin) / pixelsWide,
    (pageHeight - 2 * margin) / pixelsHigh,
  );
  const width = pixelsWide * scale;
  const height = pixelsHigh * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Matriz que leva o quadrado da imagem (0..1) ao retângulo da página, já aplicando a
 * orientação EXIF (espelhar e girar).
 */
export function placementMatrix(
  orientation: number,
  rect: Omit<PageLayout, 'pageWidth' | 'pageHeight'>,
) {
  const { x, y, width: w, height: h } = rect;
  switch (orientation) {
    case 2:
      return [-w, 0, 0, h, x + w, y];
    case 3:
      return [-w, 0, 0, -h, x + w, y + h];
    case 4:
      return [w, 0, 0, -h, x, y + h];
    case 5:
      return [0, -h, -w, 0, x + w, y + h];
    case 6:
      return [0, -h, w, 0, x, y + h];
    case 7:
      return [0, h, w, 0, x, y];
    case 8:
      return [0, h, -w, 0, x + w, y];
    default:
      return [w, 0, 0, h, x, y];
  }
}

/** Número em PDF: até 3 casas, sem zeros sobrando. */
const num = (value: number) => {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
};

const latin1 = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);

/** Pedaços do PDF (juntar com `new Blob(parts)`), sem copiar as imagens. */
export function buildImagesPdf(
  images: readonly PdfImage[],
  page: PageSize,
  marginMm: number,
): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  const object = (id: number, dictionary: string, stream?: Uint8Array) => {
    offsets[id] = length;
    if (stream === undefined) {
      push(latin1(`${String(id)} 0 obj\n${dictionary}\nendobj\n`));
      return;
    }
    push(latin1(`${String(id)} 0 obj\n${dictionary}\nstream\n`));
    push(stream);
    push(latin1('\nendstream\nendobj\n'));
  };

  // 1: catálogo, 2: páginas, 3: informações; depois, por imagem: página, conteúdo, imagem e,
  // se houver transparência, máscara. Números seguidos, sem buracos na tabela.
  let nextId = 4;
  const pageIds = images.map((image) => {
    const id = nextId;
    nextId += image.alpha === undefined ? 3 : 4;
    return id;
  });

  push(latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(images.length)} >>`,
  );
  object(3, '<< /Producer (Conversor Grafix) >>');

  images.forEach((image, index) => {
    const pageId = pageIds[index] ?? 0;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const maskId = pageId + 3;
    const layout = layoutPage(image, page, marginMm);
    const matrix = placementMatrix(image.orientation, layout).map(num).join(' ');
    const content = latin1(`q ${matrix} cm /Im0 Do Q\n`);

    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(layout.pageWidth)} ${num(layout.pageHeight)}] ` +
        `/Resources << /XObject << /Im0 ${String(imageId)} 0 R >> >> /Contents ${String(contentId)} 0 R >>`,
    );
    object(contentId, `<< /Length ${String(content.length)} >>`, content);

    const decode =
      image.colorSpace === 'DeviceCMYK' && image.invertCmyk === true
        ? ' /Decode [1 0 1 0 1 0 1 0]'
        : '';
    const mask = image.alpha === undefined ? '' : ` /SMask ${String(maskId)} 0 R`;
    object(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} ` +
        `/ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter}${decode}${mask} ` +
        `/Length ${String(image.data.length)} >>`,
      image.data,
    );
    if (image.alpha !== undefined) {
      object(
        maskId,
        `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${String(image.alpha.length)} >>`,
        image.alpha,
      );
    }
  });

  const count = nextId;
  const xrefStart = length;
  let xref = `xref\n0 ${String(count)}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(latin1(xref));
  push(
    latin1(
      `trailer\n<< /Size ${String(count)} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF\n`,
    ),
  );
  return parts;
}
