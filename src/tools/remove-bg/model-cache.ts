/**
 * Download e cópia local do modelo de IA (única conexão externa do app, seção 6.4).
 * Roda nos workers (OPFS, fetch e WebCrypto existem lá) e na página (estado e exclusão).
 *
 * O modelo fica no sistema de arquivos privado do site (OPFS), e não na Cache API: o Chrome
 * recusou guardar na Cache API arquivos acima de algumas centenas de MB ("Unexpected internal
 * error"), e o modelo padrão tem 897 MB.
 */
import { AppError } from '../../lib/shared/errors';
import { formatBytes } from '../../lib/shared/limits';
import type { ModelVariant } from './models';

const DIRECTORY = 'modelo-ia';
/** Cache usado antes da troca para OPFS; apagado junto com os modelos. */
const LEGACY_CACHE = 'conversor-modelo-ia';

/** Nome do arquivo no OPFS: muda se o modelo mudar (outro hash), nunca reaproveita o antigo. */
export function modelFileName(model: ModelVariant): string {
  return `${model.id}-${model.sha256.slice(0, 16)}.onnx`;
}

async function modelDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle(DIRECTORY, { create });
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function modelFile(model: ModelVariant): Promise<File | null> {
  const directory = await modelDirectory(false);
  if (!directory) return null;
  try {
    const handle = await directory.getFileHandle(modelFileName(model));
    return await handle.getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Baixa o modelo, confere tamanho e SHA-256 e só então guarda no cache.
 * Nada é guardado se o arquivo não bater com o valor gravado no código.
 */
export async function downloadModel(
  model: ModelVariant,
  onProgress: (fraction: number) => void,
): Promise<void> {
  let response: Response;
  try {
    // Sem cookies nem referência à página; o navegador segue o redirecionamento para a CDN.
    response = await fetch(model.url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (error) {
    throw new AppError('model-download', undefined, String(error));
  }
  if (!response.ok || !response.body) {
    throw new AppError('model-download', undefined, `HTTP ${String(response.status)}`);
  }

  // Lê em partes num buffer do tamanho esperado; para se vier mais do que isso.
  const buffer = new Uint8Array(model.bytes);
  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > model.bytes) {
      await reader.cancel();
      throw new AppError('model-integrity', undefined, 'Arquivo maior que o esperado.');
    }
    buffer.set(value, received);
    received += value.byteLength;
    onProgress(received / model.bytes);
  }
  if (received !== model.bytes) {
    throw new AppError(
      'model-download',
      undefined,
      `Recebidos ${formatBytes(received)} de ${formatBytes(model.bytes)}.`,
    );
  }

  const hash = await sha256Hex(buffer.buffer);
  if (hash !== model.sha256) {
    throw new AppError('model-integrity', undefined, `SHA-256 recebido: ${hash}`);
  }

  // `createWritable` grava num arquivo temporário e só troca pelo definitivo no `close`.
  const directory = await modelDirectory(true);
  if (!directory) throw new AppError('unexpected', undefined, 'OPFS indisponível.');
  const handle = await directory.getFileHandle(modelFileName(model), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(buffer);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await directory.removeEntry(modelFileName(model)).catch(() => undefined);
    throw new AppError(
      'model-download',
      'Não foi possível guardar o modelo de IA neste computador. Confira o espaço livre no disco.',
      String(error),
    );
  }
}

/**
 * Lê o modelo guardado e confere o SHA-256 de novo (protege contra arquivo corrompido).
 * Se não bater, apaga e pede novo download.
 */
export async function loadCachedModel(model: ModelVariant): Promise<ArrayBuffer> {
  const file = await modelFile(model);
  if (!file) throw new AppError('model-missing');
  const data = await file.arrayBuffer();
  if (data.byteLength !== model.bytes || (await sha256Hex(data)) !== model.sha256) {
    const directory = await modelDirectory(false);
    await directory?.removeEntry(modelFileName(model)).catch(() => undefined);
    throw new AppError('model-integrity', undefined, 'O arquivo guardado não confere.');
  }
  return data;
}

/** Ids dos modelos já baixados (o SHA-256 é conferido ao carregar). */
export async function cachedModelIds(models: readonly ModelVariant[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) return ids;
  for (const model of models) {
    const file = await modelFile(model);
    if (file) ids.add(model.id);
  }
  return ids;
}

/** Apaga todos os modelos baixados. */
export async function deleteCachedModels(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIRECTORY, { recursive: true }).catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  });
  if ('caches' in globalThis) await caches.delete(LEGACY_CACHE);
}
