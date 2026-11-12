/** Contrato da tarefa "ferramentas de PDF" (página ↔ worker). */

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PdfEditOperation =
  | { readonly kind: 'merge' }
  | { readonly kind: 'split'; readonly archiveBaseName: string }
  | { readonly kind: 'extract'; readonly pages: readonly number[] }
  /** Pares [página, ângulo no sentido horário]. */
  | { readonly kind: 'rotate'; readonly rotations: readonly (readonly [number, 90 | 180 | 270])[] }
  | { readonly kind: 'crop'; readonly rect: CropRect; readonly pages: readonly number[] | 'all' }
  | { readonly kind: 'compress'; readonly mode: 'lossless' | 'images'; readonly quality: number };

export interface PdfEditInput {
  /** Um PDF (ou vários, para juntar, na ordem). */
  readonly sources: readonly { readonly file: Blob; readonly name: string }[];
  readonly password?: string;
  readonly operation: PdfEditOperation;
}

export interface PdfEditOutput {
  /** PDF (ou ZIP, no "separar"). */
  readonly result: Blob;
}

const isPageList = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length <= 100_000 &&
  value.every((page) => Number.isSafeInteger(page) && (page as number) >= 1);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isOperation(value: unknown): value is PdfEditOperation {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  switch (op['kind']) {
    case 'merge':
      return true;
    case 'split':
      return typeof op['archiveBaseName'] === 'string';
    case 'extract':
      return isPageList(op['pages']);
    case 'rotate': {
      const rotations = op['rotations'];
      return (
        Array.isArray(rotations) &&
        rotations.every(
          (pair: unknown) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            isPageList([pair[0]]) &&
            (pair[1] === 90 || pair[1] === 180 || pair[1] === 270),
        )
      );
    }
    case 'crop': {
      const rect = op['rect'];
      if (typeof rect !== 'object' || rect === null) return false;
      const r = rect as Record<string, unknown>;
      return (
        isFiniteNumber(r['x']) &&
        isFiniteNumber(r['y']) &&
        isFiniteNumber(r['width']) &&
        isFiniteNumber(r['height']) &&
        (op['pages'] === 'all' || isPageList(op['pages']))
      );
    }
    case 'compress':
      return (
        (op['mode'] === 'lossless' || op['mode'] === 'images') && isFiniteNumber(op['quality'])
      );
    default:
      return false;
  }
}

export function isPdfEditInput(value: unknown): value is PdfEditInput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const sources = record['sources'];
  return (
    Array.isArray(sources) &&
    sources.length >= 1 &&
    sources.length <= 200 &&
    sources.every((source: unknown) => {
      if (typeof source !== 'object' || source === null) return false;
      const s = source as Record<string, unknown>;
      return s['file'] instanceof Blob && typeof s['name'] === 'string';
    }) &&
    (record['password'] === undefined || typeof record['password'] === 'string') &&
    isOperation(record['operation'])
  );
}

export function isPdfEditOutput(value: unknown): value is PdfEditOutput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['result'] instanceof Blob;
}
