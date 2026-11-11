/**
 * Download e cache local do modelo de IA (única conexão externa do app, seção 6.4).
 * Roda nos workers (Cache API, fetch e WebCrypto existem lá) e na página (estado e exclusão).
 */
import { AppError } from '../../lib/shared/errors';
import { formatBytes } from '../../lib/shared/limits';
import type { ModelVariant } from './models';

const CACHE_NAME = 'conversor-modelo-ia';

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

  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    model.url,
    new Response(buffer, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(received) },
    }),
  );
}

/**
 * Lê o modelo do cache e confere o SHA-256 de novo (protege contra cache corrompido).
 * Se não bater, apaga e pede novo download.
 */
export async function loadCachedModel(model: ModelVariant): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(model.url);
  if (!response) throw new AppError('model-missing');
  const data = await response.arrayBuffer();
  if (data.byteLength !== model.bytes || (await sha256Hex(data)) !== model.sha256) {
    await cache.delete(model.url);
    throw new AppError('model-integrity', undefined, 'O arquivo em cache não confere.');
  }
  return data;
}

/** Modelos já baixados, pela URL. */
export async function cachedModelUrls(): Promise<Set<string>> {
  if (!('caches' in globalThis)) return new Set();
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return new Set(keys.map((request) => request.url));
}

/** Apaga todos os modelos baixados. */
export async function deleteCachedModels(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
