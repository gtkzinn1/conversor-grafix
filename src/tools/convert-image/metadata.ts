import { crc32 } from '../../lib/shared/zip';

/**
 * Leitura e gravação dos metadados de JPEG e PNG que a conversão usa: dimensões, componentes de
 * cor, orientação EXIF e resolução (DPI). Lógica pura, sem DOM; os arquivos são tratados como
 * hostis (todo acesso confere os limites do buffer).
 */

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  /** 1 (cinza), 3 (YCbCr/RGB) ou 4 (CMYK/YCCK). */
  readonly components: number;
  readonly precision: number;
  /** Tipo do quadro: só "baseline" e "progressive" entram no PDF sem recompressão. */
  readonly frame: 'baseline' | 'progressive' | 'other';
  /** Orientação EXIF (1 a 8); 1 quando não informada. */
  readonly orientation: number;
  /** Resolução gravada (JFIF), ou `null`. */
  readonly dpi: number | null;
  /** Segmento Adobe APP14: no CMYK do Photoshop, os valores vêm invertidos. */
  readonly adobe: boolean;
}

const readU16 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

const readU32 = (bytes: Uint8Array, offset: number) =>
  readU16(bytes, offset) * 0x1_0000 + readU16(bytes, offset + 2);

const matches = (bytes: Uint8Array, offset: number, text: string) =>
  Array.from(text).every((char, index) => bytes[offset + index] === char.charCodeAt(0));

/** Resolução aceitável (evita valores absurdos de arquivos estranhos). */
const saneDpi = (dpi: number) => (dpi >= 10 && dpi <= 10_000 ? Math.round(dpi) : null);

interface Segment {
  readonly marker: number;
  /** Início dos dados (depois do tamanho). */
  readonly start: number;
  readonly end: number;
}

/** Segmentos do cabeçalho do JPEG, do SOI até o início da imagem (SOS). */
function jpegSegments(bytes: Uint8Array): Segment[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
  const segments: Segment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length && segments.length < 1000) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset++; // bytes de preenchimento
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = readU16(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    segments.push({ marker, start: offset + 4, end: offset + 2 + length });
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return segments;
}

/** Orientação no EXIF (tag 0x0112 do IFD0). */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
  const u16 = (offset: number) =>
    little ? (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) : readU16(bytes, offset);
  const u32 = (offset: number) =>
    little ? u16(offset) + u16(offset + 2) * 0x1_0000 : readU32(bytes, offset);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let index = 0; index < count && index < 500; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Lê o cabeçalho do JPEG; `null` se não houver quadro (SOF) legível. */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  let frame: Pick<JpegInfo, 'width' | 'height' | 'components' | 'precision' | 'frame'> | null =
    null;
  let orientation = 1;
  let dpi: number | null = null;
  let adobe = false;
  for (const { marker, start, end } of jpegSegments(bytes)) {
    if (marker === 0xe0 && end - start >= 12 && matches(bytes, start, 'JFIF\0')) {
      const units = bytes[start + 7];
      const density = readU16(bytes, start + 8);
      if (units === 1) dpi = saneDpi(density);
      else if (units === 2) dpi = saneDpi(density * 2.54);
    } else if (marker === 0xe1 && end - start >= 14 && matches(bytes, start, 'Exif\0\0')) {
      orientation = exifOrientation(bytes, start, end);
    } else if (marker === 0xee && end - start >= 12 && matches(bytes, start, 'Adobe')) {
      adobe = true;
    } else if (
      frame === null &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      end - start >= 6
    ) {
      frame = {
        precision: bytes[start] ?? 0,
        height: readU16(bytes, start + 1),
        width: readU16(bytes, start + 3),
        components: bytes[start + 5] ?? 0,
        frame:
          marker === 0xc0 || marker === 0xc1
            ? 'baseline'
            : marker === 0xc2
              ? 'progressive'
              : 'other',
      };
    }
  }
  if (frame === null || frame.width === 0 || frame.height === 0) return null;
  return { ...frame, orientation, dpi, adobe };
}

/** Segmento JFIF APP0 com a resolução em DPI. */
function jfifSegment(dpi: number): Uint8Array {
  const density = Math.min(65_535, Math.max(1, Math.round(dpi)));
  return Uint8Array.of(
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01, // versão 1.1
    0x01, // unidade: pontos por polegada
    density >> 8,
    density & 0xff,
    density >> 8,
    density & 0xff,
    0x00,
    0x00, // sem miniatura
  );
}

/** Grava a resolução no JPEG: ajusta o JFIF existente ou insere um logo após o SOI. */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const density = Math.min(65_535, Math.max(1, Math.round(dpi)));
  const jfif = jpegSegments(bytes).find(
    ({ marker, start, end }) =>
      marker === 0xe0 && end - start >= 12 && matches(bytes, start, 'JFIF\0'),
  );
  if (jfif) {
    const copy = bytes.slice();
    copy[jfif.start + 7] = 1;
    copy[jfif.start + 8] = density >> 8;
    copy[jfif.start + 9] = density & 0xff;
    copy[jfif.start + 10] = density >> 8;
    copy[jfif.start + 11] = density & 0xff;
    return copy;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const segment = jfifSegment(density);
  const result = new Uint8Array(bytes.length + segment.length);
  result.set(bytes.subarray(0, 2));
  result.set(segment, 2);
  result.set(bytes.subarray(2), 2 + segment.length);
  return result;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  readonly type: string;
  /** Do campo de tamanho até o fim do CRC. */
  readonly offset: number;
  readonly end: number;
  readonly data: number;
}

function pngChunks(bytes: Uint8Array): Chunk[] {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return [];
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length && chunks.length < 100_000) {
    const length = readU32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, offset, end, data: offset + 8 });
    if (type === 'IEND') break;
    offset = end;
  }
  return chunks;
}

/** Resolução do PNG (chunk pHYs em pixels por metro), ou `null`. */
export function readPngDpi(bytes: Uint8Array): number | null {
  const phys = pngChunks(bytes).find((chunk) => chunk.type === 'pHYs');
  if (!phys || phys.end - phys.data < 13 || bytes[phys.data + 8] !== 1) return null;
  return saneDpi(readU32(bytes, phys.data) * 0.0254);
}

/** Grava a resolução no PNG: troca o pHYs ou insere um antes do primeiro IDAT. */
export function setPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const chunks = pngChunks(bytes);
  const firstData = chunks.find((chunk) => chunk.type === 'IDAT');
  if (!firstData) return bytes;
  const perMeter = Math.round(dpi / 0.0254);
  const body = new Uint8Array(4 + 9);
  const view = new DataView(body.buffer);
  body.set([0x70, 0x48, 0x59, 0x73]); // "pHYs"
  view.setUint32(4, perMeter);
  view.setUint32(8, perMeter);
  body[12] = 1; // metro
  const phys = new Uint8Array(4 + body.length + 4);
  const physView = new DataView(phys.buffer);
  physView.setUint32(0, 9);
  phys.set(body, 4);
  physView.setUint32(4 + body.length, crc32(body));

  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  for (const chunk of chunks) {
    if (chunk.type === 'pHYs') continue;
    if (chunk === firstData) parts.push(phys);
    parts.push(bytes.subarray(chunk.offset, chunk.end));
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
