import { registerSW } from 'virtual:pwa-register';

/** Verifica se há versão nova do app a cada hora enquanto ele estiver aberto. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PwaCallbacks {
  /** Há versão nova pronta; `apply` ativa e recarrega a página. */
  onUpdateReady(apply: () => Promise<void>): void;
  onRegisterError(error: unknown): void;
}

/**
 * Registra o service worker. A atualização NUNCA é aplicada sozinha:
 * o usuário vê o aviso "Nova versão disponível" e decide quando recarregar.
 */
export function setupPwa(callbacks: PwaCallbacks): void {
  if (!('serviceWorker' in navigator)) return;

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      callbacks.onUpdateReady(() => updateServiceWorker(true));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      }, UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error: unknown) {
      callbacks.onRegisterError(error);
    },
  });
}
