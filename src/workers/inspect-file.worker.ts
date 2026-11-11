import { AppError } from '../lib/shared/errors';
import { detectFileKind, SIGNATURE_BYTES } from '../lib/shared/file-type';
import type { InspectFileInput, InspectFileOutput } from '../lib/shared/tasks/inspect-file';
import { isInspectFileInput } from '../lib/shared/tasks/inspect-file';
import { defineWorkerTask } from './runtime';

/**
 * Lê só o início do arquivo e identifica o tipo pela assinatura.
 * Fica num worker porque todo byte vindo de arquivo de cliente é tratado como hostil.
 */
defineWorkerTask<InspectFileInput, InspectFileOutput>(isInspectFileInput, async ({ file }) => {
  if (file.size === 0) throw new AppError('empty-file');
  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  return { output: { kind: detectFileKind(head), size: file.size } };
});
