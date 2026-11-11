/** Contratos das tarefas do "Remover fundo" (página ↔ worker). */

export interface ModelDownloadInput {
  readonly modelId: string;
}

/** O worker só responde quando o modelo foi baixado, conferido e guardado. */
export interface ModelDownloadOutput {
  readonly saved: true;
}

export interface RemoveBgInput {
  readonly file: Blob;
  readonly modelId: string;
  readonly maxMegapixels: number;
}

export interface RemoveBgOutput {
  /** PNG transparente na resolução original. */
  readonly png: Blob;
  readonly width: number;
  readonly height: number;
  /** Onde a IA rodou, para informar o usuário. */
  readonly backend: 'webgpu' | 'wasm';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export function isModelDownloadInput(value: unknown): value is ModelDownloadInput {
  return isRecord(value) && typeof value['modelId'] === 'string';
}

export function isModelDownloadOutput(value: unknown): value is ModelDownloadOutput {
  return isRecord(value) && value['saved'] === true;
}

export function isRemoveBgInput(value: unknown): value is RemoveBgInput {
  return (
    isRecord(value) &&
    value['file'] instanceof Blob &&
    typeof value['modelId'] === 'string' &&
    typeof value['maxMegapixels'] === 'number' &&
    value['maxMegapixels'] > 0
  );
}

export function isRemoveBgOutput(value: unknown): value is RemoveBgOutput {
  return (
    isRecord(value) &&
    value['png'] instanceof Blob &&
    isPositiveInteger(value['width']) &&
    isPositiveInteger(value['height']) &&
    (value['backend'] === 'webgpu' || value['backend'] === 'wasm')
  );
}
