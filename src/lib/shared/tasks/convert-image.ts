/** Contrato da tarefa "converter imagens" (página ↔ worker). */

export type ImageTarget = 'keep' | 'jpeg' | 'png' | 'webp';

export type ResizeMode =
  | { readonly kind: 'original' }
  | { readonly kind: 'width'; readonly width: number }
  | { readonly kind: 'percent'; readonly percent: number }
  /** Largura de impressão em cm, na resolução escolhida (gravada no arquivo). */
  | { readonly kind: 'print'; readonly widthCm: number; readonly dpi: number };

export interface ConvertSettings {
  readonly format: ImageTarget;
  /** Qualidade de JPG e WebP, de 50 a 100. */
  readonly quality: number;
  readonly resize: ResizeMode;
  /** Cor que fica no lugar da transparência quando a saída é JPG. */
  readonly background: 'white' | 'black';
}

export type PdfPageSize = 'image' | 'a4' | 'a3';

export type ImageTaskInput =
  | { readonly kind: 'convert'; readonly file: Blob; readonly settings: ConvertSettings }
  | { readonly kind: 'thumbnail'; readonly file: Blob }
  | {
      readonly kind: 'to-pdf';
      readonly files: readonly Blob[];
      readonly page: PdfPageSize;
      readonly marginMm: number;
    };

export type ImageTaskOutput =
  | {
      readonly kind: 'convert';
      readonly image: Blob;
      readonly extension: 'jpg' | 'png' | 'webp';
      readonly width: number;
      readonly height: number;
      /** Resolução gravada no arquivo, ou `null`. */
      readonly dpi: number | null;
      readonly cmykToRgb: boolean;
      readonly transparencyFilled: boolean;
    }
  | {
      readonly kind: 'thumbnail';
      readonly image: Blob;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'to-pdf'; readonly pdf: Blob; readonly pages: number };

/** Limites das opções (a tela usa os mesmos). */
export const RESIZE_LIMITS = {
  width: [1, 20_000],
  percent: [1, 1000],
  widthCm: [0.1, 500],
  dpi: [10, 2400],
} as const;

export const MAX_PDF_IMAGES = 200;

const inRange = (value: unknown, [min, max]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function isResizeMode(value: unknown): value is ResizeMode {
  if (typeof value !== 'object' || value === null) return false;
  const mode = value as Record<string, unknown>;
  switch (mode['kind']) {
    case 'original':
      return true;
    case 'width':
      return Number.isInteger(mode['width']) && inRange(mode['width'], RESIZE_LIMITS.width);
    case 'percent':
      return inRange(mode['percent'], RESIZE_LIMITS.percent);
    case 'print':
      return (
        inRange(mode['widthCm'], RESIZE_LIMITS.widthCm) && inRange(mode['dpi'], RESIZE_LIMITS.dpi)
      );
    default:
      return false;
  }
}

function isConvertSettings(value: unknown): value is ConvertSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    ['keep', 'jpeg', 'png', 'webp'].includes(settings['format'] as string) &&
    inRange(settings['quality'], [50, 100]) &&
    isResizeMode(settings['resize']) &&
    (settings['background'] === 'white' || settings['background'] === 'black')
  );
}

export function isImageTaskInput(value: unknown): value is ImageTaskInput {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Record<string, unknown>;
  switch (input['kind']) {
    case 'convert':
      return input['file'] instanceof Blob && isConvertSettings(input['settings']);
    case 'thumbnail':
      return input['file'] instanceof Blob;
    case 'to-pdf': {
      const files = input['files'];
      return (
        Array.isArray(files) &&
        files.length >= 1 &&
        files.length <= MAX_PDF_IMAGES &&
        files.every((file: unknown) => file instanceof Blob) &&
        ['image', 'a4', 'a3'].includes(input['page'] as string) &&
        inRange(input['marginMm'], [0, 50])
      );
    }
    default:
      return false;
  }
}

const isSize = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

export function isImageTaskOutput(value: unknown): value is ImageTaskOutput {
  if (typeof value !== 'object' || value === null) return false;
  const output = value as Record<string, unknown>;
  switch (output['kind']) {
    case 'convert':
      return (
        output['image'] instanceof Blob &&
        ['jpg', 'png', 'webp'].includes(output['extension'] as string) &&
        isSize(output['width']) &&
        isSize(output['height']) &&
        (output['dpi'] === null || isSize(output['dpi'])) &&
        typeof output['cmykToRgb'] === 'boolean' &&
        typeof output['transparencyFilled'] === 'boolean'
      );
    case 'thumbnail':
      return output['image'] instanceof Blob && isSize(output['width']) && isSize(output['height']);
    case 'to-pdf':
      return output['pdf'] instanceof Blob && isSize(output['pages']);
    default:
      return false;
  }
}
