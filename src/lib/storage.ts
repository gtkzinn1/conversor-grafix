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
