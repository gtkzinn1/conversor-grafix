import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { crc32 } from '../../src/lib/shared/zip';
import { isImageTaskInput } from '../../src/lib/shared/tasks/convert-image';
import { outputFormat, targetSize } from '../../src/tools/convert-image/convert';
import {
  buildImagesPdf,
  layoutPage,
  placementMatrix,
  type PdfImage,
} from '../../src/tools/convert-image/images-pdf';
import {
  readJpegInfo,
  readPngDpi,
  setJpegDpi,
  setPngDpi,
} from '../../src/tools/convert-image/metadata';
import { loadQpdf, type Qpdf } from '../../src/tools/pdf-corel/qpdf';

const segment = (marker: number, data: number[]) => [
  0xff,
  marker,
  (data.length + 2) >> 8,
  (data.length + 2) & 0xff,
  ...data,
];
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/** Cabeçalho de JPEG sintético (não decodificável, mas com os segmentos que lemos). */
function jpegHeader(options: { jfifDpi?: number; orientation?: number; adobe?: boolean } = {}) {
  const bytes = [0xff, 0xd8];
  if (options.jfifDpi !== undefined) {
    const d = options.jfifDpi;
    bytes.push(
      ...segment(0xe0, [...ascii('JFIF\0'), 1, 1, 1, d >> 8, d & 0xff, d >> 8, d & 0xff, 0, 0]),
    );
  }
  if (options.orientation !== undefined) {
    // TIFF big-endian, IFD0 com uma entrada: 0x0112 SHORT 1 = orientação.
    const tiff = [
      0x4d,
      0x4d,
      0,
      42,
      0,
      0,
      0,
      8,
      0,
      1,
      0x01,
      0x12,
      0,
      3,
      0,
      0,
      0,
      1,
      0,
      options.orientation,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    bytes.push(...segment(0xe1, [...ascii('Exif\0\0'), ...tiff]));
  }
  if (options.adobe === true)
    bytes.push(...segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 2]));
  bytes.push(
    ...segment(0xc0, [
      8,
      0,
      20,
      0,
      30,
      options.adobe === true ? 4 : 3,
      1,
      0x11,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ]),
  );
  bytes.push(...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x00, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

function pngChunk(type: string, data: number[]) {
  const body = new Uint8Array([...ascii(type), ...data]);
  const length = data.length;
  const crc = crc32(body);
  return [
    length >>> 24,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...body,
    crc >>> 24,
    (crc >> 16) & 0xff,
    (crc >> 8) & 0xff,
    crc & 0xff,
  ];
}

/** PNG 1×1 RGB válido. */
function tinyPng() {
  const raw = deflateSync(Buffer.from([0, 255, 0, 0]));
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...pngChunk('IDAT', [...raw]),
    ...pngChunk('IEND', []),
  ]);
}

describe('metadados do JPEG', () => {
  it('lê dimensões, componentes, orientação, DPI e Adobe', () => {
    expect(readJpegInfo(jpegHeader({ jfifDpi: 300, orientation: 6, adobe: true }))).toEqual({
      width: 30,
      height: 20,
      components: 4,
      precision: 8,
      frame: 'baseline',
      orientation: 6,
      dpi: 300,
      adobe: true,
    });
    expect(readJpegInfo(jpegHeader())).toMatchObject({ orientation: 1, dpi: null, adobe: false });
  });

  it('recusa lixo sem estourar', () => {
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff]))).toBeNull();
    expect(readJpegInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('grava o DPI trocando o JFIF ou inserindo um', () => {
    expect(readJpegInfo(setJpegDpi(jpegHeader({ jfifDpi: 72 }), 300))?.dpi).toBe(300);
    const inserted = setJpegDpi(jpegHeader({ orientation: 3 }), 150);
    expect(readJpegInfo(inserted)).toMatchObject({ dpi: 150, orientation: 3, width: 30 });
  });
});

describe('amostras geradas pelo Pillow', () => {
  const sample = (name: string) => new Uint8Array(readFileSync(`tests/samples/${name}`));

  it('lê os metadados de arquivos reais', () => {
    expect(readJpegInfo(sample('foto-girada.jpg'))).toMatchObject({
      width: 400,
      height: 200,
      components: 3,
      orientation: 6,
      dpi: 300,
    });
    expect(readJpegInfo(sample('cmyk.jpg'))).toMatchObject({ components: 4, adobe: true });
    expect(readPngDpi(sample('logo-transparente.png'))).toBe(300);
  });
});

describe('metadados do PNG', () => {
  it('insere e troca o pHYs, com CRC válido', () => {
    const png = tinyPng();
    expect(readPngDpi(png)).toBeNull();
    const at300 = setPngDpi(png, 300);
    expect(readPngDpi(at300)).toBe(300);
    const at600 = setPngDpi(at300, 600);
    expect(readPngDpi(at600)).toBe(600);
    expect(at600.length).toBe(at300.length);
    // O pHYs fica antes do IDAT, com CRC conferido.
    const text = Buffer.from(at600).toString('latin1');
    const phys = text.indexOf('pHYs');
    expect(phys).toBeLessThan(text.indexOf('IDAT'));
    const crc = Buffer.from(at600).readUInt32BE(phys + 13);
    expect(crc).toBe(crc32(at600.subarray(phys, phys + 13)));
  });
});

describe('tamanho e formato', () => {
  it('calcula o tamanho mantendo a proporção', () => {
    expect(targetSize(4000, 3000, { kind: 'original' })).toEqual({ width: 4000, height: 3000 });
    expect(targetSize(4000, 3000, { kind: 'width', width: 1920 })).toEqual({
      width: 1920,
      height: 1440,
    });
    expect(targetSize(4000, 3000, { kind: 'percent', percent: 25 })).toEqual({
      width: 1000,
      height: 750,
    });
    // 10 cm a 300 DPI = 1181 px.
    expect(targetSize(4000, 3000, { kind: 'print', widthCm: 10, dpi: 300 })).toEqual({
      width: 1181,
      height: 886,
    });
    expect(targetSize(10, 1000, { kind: 'width', width: 1 })).toEqual({ width: 1, height: 100 });
  });

  it('"Manter" usa o formato do original', () => {
    expect(outputFormat('keep', 'jpeg')).toBe('jpeg');
    expect(outputFormat('keep', 'webp')).toBe('webp');
    expect(outputFormat('keep', 'png')).toBe('png');
    expect(outputFormat('webp', 'png')).toBe('webp');
  });

  it('valida a entrada do worker', () => {
    const file = new Blob(['x']);
    const settings = {
      format: 'jpeg',
      quality: 90,
      resize: { kind: 'original' },
      background: 'white',
    };
    expect(isImageTaskInput({ kind: 'convert', file, settings })).toBe(true);
    expect(
      isImageTaskInput({ kind: 'convert', file, settings: { ...settings, quality: 101 } }),
    ).toBe(false);
    expect(
      isImageTaskInput({
        kind: 'convert',
        file,
        settings: { ...settings, resize: { kind: 'width', width: 0 } },
      }),
    ).toBe(false);
    expect(isImageTaskInput({ kind: 'to-pdf', files: [], page: 'a4', marginMm: 0 })).toBe(false);
    expect(isImageTaskInput({ kind: 'to-pdf', files: [file], page: 'a5', marginMm: 0 })).toBe(
      false,
    );
  });
});

describe('layout da página', () => {
  const image = { width: 3000, height: 1500, orientation: 1, dpi: 300 };

  it('"Tamanho da imagem" usa a resolução do arquivo, mais a margem', () => {
    expect(layoutPage(image, 'image', 0)).toEqual({
      pageWidth: 720,
      pageHeight: 360,
      x: 0,
      y: 0,
      width: 720,
      height: 360,
    });
    const withMargin = layoutPage({ ...image, dpi: null }, 'image', 10);
    expect(withMargin.width).toBe(3000);
    expect(withMargin.pageWidth).toBeCloseTo(3000 + 2 * 28.346, 2);
  });

  it('A4 deita a folha para imagem larga e centraliza', () => {
    const layout = layoutPage(image, 'a4', 0);
    expect(layout.pageWidth).toBeCloseTo(841.89, 1);
    expect(layout.pageHeight).toBeCloseTo(595.28, 1);
    expect(layout.width).toBeCloseTo(841.89, 1);
    expect(layout.y).toBeCloseTo((595.28 - 420.94) / 2, 1);
  });

  it('orientação 6 troca largura e altura', () => {
    const layout = layoutPage({ ...image, orientation: 6 }, 'image', 0);
    expect([layout.pageWidth, layout.pageHeight]).toEqual([360, 720]);
  });

  it('a matriz leva os cantos da imagem aos lugares certos', () => {
    const apply = ([a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]: number[], u: number, v: number) => [
      a * u + c * v + e,
      b * u + d * v + f,
    ];
    const rect = { x: 0, y: 0, width: 100, height: 200 };
    // Orientação 6 (girar 90° no sentido horário): o topo-esquerdo guardado (u=0, v=1)
    // vai para o topo-direito da página.
    expect(apply(placementMatrix(6, rect), 0, 1)).toEqual([100, 200]);
    expect(apply(placementMatrix(1, rect), 0, 1)).toEqual([0, 200]);
    // Orientação 3 (180°): vai para baixo-direita.
    expect(apply(placementMatrix(3, rect), 0, 1)).toEqual([100, 0]);
    // Orientação 8 (90° anti-horário): vai para baixo-esquerda.
    expect(apply(placementMatrix(8, rect), 0, 1)).toEqual([0, 0]);
  });
});

describe('PDF com imagens', () => {
  let qpdf: Qpdf;
  beforeAll(async () => {
    qpdf = await loadQpdf();
  });

  const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

  it('gera um PDF válido, com transparência e CMYK invertido', () => {
    const rgb: PdfImage = {
      width: 2,
      height: 1,
      colorSpace: 'DeviceRGB',
      filter: 'FlateDecode',
      data: new Uint8Array(deflateSync(Buffer.from([255, 0, 0, 0, 0, 255]))),
      alpha: new Uint8Array(deflateSync(Buffer.from([255, 0]))),
      orientation: 1,
      dpi: 72,
    };
    const cmyk: PdfImage = {
      width: 2,
      height: 1,
      dpi: 72,
      filter: 'FlateDecode',
      colorSpace: 'DeviceCMYK',
      data: new Uint8Array(deflateSync(Buffer.alloc(8, 128))),
      invertCmyk: true,
      orientation: 6,
    };
    const pdf = join(buildImagesPdf([rgb, cmyk], 'a4', 5));
    qpdf.writeFile('/imagens.pdf', pdf);
    const check = qpdf.run(['--check', '/imagens.pdf']);
    expect(check.code, check.stderr + check.stdout).toBe(0);
    expect(check.stdout).not.toMatch(/WARNING/i);

    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(text.match(/\/SMask/g)).toHaveLength(1);
    expect(text).toContain('/Decode [1 0 1 0 1 0 1 0]');
    expect(text).not.toContain('/ObjStm');
  });
});
