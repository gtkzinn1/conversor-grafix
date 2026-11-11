import { useEffect, useState } from 'preact/hooks';
import { setupPwa } from '../lib/pwa';

/** Aviso "Nova versão disponível". A atualização só acontece quando o usuário clica. */
export function UpdateBanner() {
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    setupPwa({
      onUpdateReady: (apply) => {
        setApplyUpdate(() => apply);
      },
      onRegisterError: (error) => {
        console.error('Falha ao registrar o service worker.', error);
      },
    });
  }, []);

  if (!applyUpdate) return null;

  return (
    <div class="banner" role="status">
      <span>Nova versão disponível.</span>
      <button
        type="button"
        class="button button--primary"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void applyUpdate();
        }}
      >
        {updating ? 'Atualizando…' : 'Atualizar agora'}
      </button>
    </div>
  );
}
