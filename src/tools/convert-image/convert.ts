import type { FileKind } from '../../lib/shared/file-type';
import type { ImageTarget, ResizeMode } from '../../lib/shared/tasks/convert-image';

/** Tamanho final em pixels; a altura acompanha a largura (proporção mantida). */
export function targetSize(
  width: number,
  height: number,
  resize: ResizeMode,
): { width: number; height: number } {
  let target: number;
  switch (resize.kind) {
    case 'original':
      return { width, height };
    case 'width':
      target = resize.width;
      break;
    case 'percent':
      target = (width * resize.percent) / 100;
      break;
    case 'print':
      target = (resize.widthCm / 2.54) * resize.dpi;
      break;
  }
  const newWidth = Math.max(1, Math.round(target));
  return { width: newWidth, height: Math.max(1, Math.round((height * newWidth) / width)) };
}

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/** Formato de saída: "Manter" usa o do arquivo original. */
export function outputFormat(target: ImageTarget, source: FileKind): OutputFormat {
  if (target !== 'keep') return target;
  return source === 'jpeg' || source === 'webp' ? source : 'png';
}

export const EXTENSIONS: Record<OutputFormat, 'jpg' | 'png' | 'webp'> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};
