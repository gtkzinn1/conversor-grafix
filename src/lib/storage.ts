/**
 * Preferências simples no navegador. O armazenamento pode estar bloqueado ou indisponível,
 * então toda leitura/escrita é protegida e o app funciona sem ele.
 */

const PREFIX = 'conversor:';

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Sem armazenamento: a preferência vale só nesta sessão.
  }
}

const GPU_FAILED_KEY = 'placa-de-video-falhou';
const GPU_FAILED_EVENT = 'conversor:placa-de-video-falhou';

/** A placa de vídeo já travou neste computador: o recorte fica só no processador. */
export function gpuFailed(): boolean {
  return readPreference(GPU_FAILED_KEY) === '1';
}

/** Lembra, neste computador, que a placa de vídeo falhou, e avisa as telas abertas. */
export function markGpuFailed(): void {
  writePreference(GPU_FAILED_KEY, '1');
  window.dispatchEvent(new Event(GPU_FAILED_EVENT));
}

/** Volta a oferecer a placa de vídeo (escolha do usuário em "Sobre"). */
export function clearGpuFailed(): void {
  try {
    window.localStorage.removeItem(PREFIX + GPU_FAILED_KEY);
  } catch {
    // Sem armazenamento: nada a limpar.
  }
  window.dispatchEvent(new Event(GPU_FAILED_EVENT));
}

export function onGpuFailedChange(listener: () => void): () => void {
  window.addEventListener(GPU_FAILED_EVENT, listener);
  return () => {
    window.removeEventListener(GPU_FAILED_EVENT, listener);
  };
}
