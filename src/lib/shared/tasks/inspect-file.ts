import type { FileKind } from '../file-type';

/** Contrato da tarefa "inspecionar arquivo" (página ↔ worker). */

export interface InspectFileInput {
  readonly file: Blob;
}

export interface InspectFileOutput {
  readonly kind: FileKind | null;
  readonly size: number;
}

export function isInspectFileInput(value: unknown): value is InspectFileInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['file'] instanceof Blob
  );
}

const FILE_KINDS: readonly string[] = ['pdf', 'png', 'jpeg', 'webp', 'psd', 'psb'];

export function isInspectFileOutput(value: unknown): value is InspectFileOutput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  const size = record['size'];
  return (
    (kind === null || (typeof kind === 'string' && FILE_KINDS.includes(kind))) &&
    typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size >= 0
  );
}
