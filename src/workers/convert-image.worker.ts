import { AppError } from '../lib/shared/errors';
import { detectFileKind, type FileKind } from '../lib/shared/file-type';
import { assertMegapixels } from '../lib/shared/limits';
import {
  isImageTaskInput,
  type ConvertSettings,
  type ImageTaskInput,
  type ImageTaskOutput,
  type PdfPageSize,
} from '../lib/shared/tasks/convert-image';
import { EXTENSIONS, outputFormat, targetSize } from '../tools/convert-image/convert';
import { buildImagesPdf, type PdfImage } from '../tools/convert-image/images-pdf';
import { readJpegInfo, readPngDpi, setJpegDpi, setPngDpi } from '../tools/convert-image/metadata';
import { defineWorkerTask, type TaskContext } from './runtime';

const THUMBNAIL_SIZE = 240;

async function readBytes(file: Blob): Promise<{ bytes: Uint8Array; kind: FileKind }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectFileKind(bytes);
  if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') throw new AppError('unsupported-type');
  return { bytes, kind };
}

/** Decodifica com a orientação EXIF aplicada; recusa acima do limite de megapixels. */
async function decode(
  file: Blob,
  resize?: { width: number; height: number },
): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (resize)
    Object.assign(options, {
      resizeWidth: resize.width,
      resizeHeight: resize.height,
      resizeQuality: 'high',
    });
  try {
    return await createImageBitmap(file, options);
  } catch (caught) {
    throw new AppError('invalid-image', undefined, String(caught));
  }
}

function context2d(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new AppError('unexpected', undefined, 'Canvas 2D indisponível no worker.');
  return { canvas, context };
}

/** Algum pixel não é totalmente opaco? */
function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) return true;
  return false;
}

function sourceDpi(kind: FileKind, bytes: Uint8Array): number | null {
  if (kind === 'jpeg') return readJpegInfo(bytes)?.dpi ?? null;
  if (kind === 'png') return readPngDpi(bytes);
  return null;
}

async function convert(
  file: Blob,
  settings: ConvertSettings,
  context: TaskContext,
): Promise<ImageTaskOutput> {
  context.progress(null, 'Lendo a imagem');
  const { bytes, kind } = await readBytes(file);
  const original = await decode(file);
  const { width: sourceWidth, height: sourceHeight } = original;
  assertMegapixels(sourceWidth, sourceHeight);
  const size = targetSize(sourceWidth, sourceHeight, settings.resize);
  assertMegapixels(size.width, size.height);

  context.progress(null, 'Convertendo');
  let bitmap = original;
  if (size.width !== sourceWidth || size.height !== sourceHeight) {
    original.close();
    bitmap = await decode(file, size);
  }
  const format = outputFormat(settings.format, kind);
  const { canvas, context: draw } = context2d(size.width, size.height);
  draw.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  let transparencyFilled = false;
  if (format === 'jpeg' && kind !== 'jpeg') {
    transparencyFilled = hasTransparency(draw.getImageData(0, 0, size.width, size.height).data);
    if (transparencyFilled) {
      draw.globalCompositeOperation = 'destination-over';
      draw.fillStyle = settings.background === 'white' ? '#ffffff' : '#000000';
      draw.fillRect(0, 0, size.width, size.height);
    }
  }

  const encoded = await canvas.convertToBlob({
    type: `image/${format}`,
    quality: settings.quality / 100,
  });
  const dpi =
    settings.resize.kind === 'print' ? Math.round(settings.resize.dpi) : sourceDpi(kind, bytes);
  let image: Blob = encoded;
  if (dpi !== null && format !== 'webp') {
    const data = new Uint8Array(await encoded.arrayBuffer());
    const withDpi = format === 'jpeg' ? setJpegDpi(data, dpi) : setPngDpi(data, dpi);
    image = new Blob([withDpi as Uint8Array<ArrayBuffer>], { type: encoded.type });
  }
  return {
    kind: 'convert',
    image,
    extension: EXTENSIONS[format],
    width: size.width,
    height: size.height,
    dpi: format === 'webp' ? null : dpi,
    cmykToRgb: kind === 'jpeg' && readJpegInfo(bytes)?.components === 4,
    transparencyFilled,
  };
}

async function thumbnail(file: Blob): Promise<ImageTaskOutput> {
  const original = await decode(file);
  const { width, height } = original;
  original.close();
  assertMegapixels(width, height);
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height));
  const small = await decode(file, {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
  const { canvas, context } = context2d(small.width, small.height);
  context.drawImage(small, 0, 0);
  small.close();
  return {
    kind: 'thumbnail',
    image: await canvas.convertToBlob({ type: 'image/png' }),
    width,
    height,
  };
}

/** Comprime em zlib (o FlateDecode do PDF). */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Uma imagem para o PDF. JPEG comum entra como está (sem perda, CMYK mantido); os demais
 * formatos viram pixels RGB sem perda, com a transparência numa máscara.
 */
async function pdfImage(file: Blob): Promise<PdfImage> {
  const { bytes, kind } = await readBytes(file);
  if (kind === 'jpeg') {
    const info = readJpegInfo(bytes);
    if (info?.precision === 8 && info.frame !== 'other' && [1, 3, 4].includes(info.components)) {
      assertMegapixels(info.width, info.height);
      return {
        width: info.width,
        height: info.height,
        colorSpace:
          info.components === 1 ? 'DeviceGray' : info.components === 3 ? 'DeviceRGB' : 'DeviceCMYK',
        filter: 'DCTDecode',
        data: bytes,
        invertCmyk: info.components === 4 && info.adobe,
        orientation: info.orientation,
        dpi: info.dpi,
      };
    }
  }
  const bitmap = await decode(file);
  const { width, height } = bitmap;
  assertMegapixels(width, height);
  const { context } = context2d(width, height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data;
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (
    let pixel = 0, source = 0, target = 0;
    pixel < alpha.length;
    pixel++, source += 4, target += 3
  ) {
    rgb[target] = pixels[source] ?? 0;
    rgb[target + 1] = pixels[source + 1] ?? 0;
    rgb[target + 2] = pixels[source + 2] ?? 0;
    const value = pixels[source + 3] ?? 255;
    alpha[pixel] = value;
    if (value !== 255) opaque = false;
  }
  const image: PdfImage = {
    width,
    height,
    colorSpace: 'DeviceRGB',
    filter: 'FlateDecode',
    data: await deflate(rgb),
    orientation: 1,
    dpi: sourceDpi(kind, bytes),
  };
  return opaque ? image : { ...image, alpha: await deflate(alpha) };
}

async function toPdf(
  files: readonly Blob[],
  page: PdfPageSize,
  marginMm: number,
  context: TaskContext,
): Promise<ImageTaskOutput> {
  const images: PdfImage[] = [];
  for (const [index, file] of files.entries()) {
    context.progress(
      index / files.length,
      `Imagem ${String(index + 1)} de ${String(files.length)}`,
    );
    try {
      images.push(await pdfImage(file));
    } catch (caught) {
      if (caught instanceof AppError) {
        throw new AppError(
          caught.code,
          `Imagem ${String(index + 1)}: ${caught.message}`,
          caught.detail,
        );
      }
      throw caught;
    }
  }
  context.progress(1, 'Gravando o PDF');
  const parts = buildImagesPdf(images, page, marginMm) as Uint8Array<ArrayBuffer>[];
  return {
    kind: 'to-pdf',
    pdf: new Blob(parts, { type: 'application/pdf' }),
    pages: images.length,
  };
}

/** Converter imagens: trocar formato e tamanho, miniaturas e imagens para PDF. */
defineWorkerTask<ImageTaskInput, ImageTaskOutput>(isImageTaskInput, async (input, context) => {
  switch (input.kind) {
    case 'convert':
      return { output: await convert(input.file, input.settings, context) };
    case 'thumbnail':
      return { output: await thumbnail(input.file) };
    case 'to-pdf':
      return { output: await toPdf(input.files, input.page, input.marginMm, context) };
  }
});
