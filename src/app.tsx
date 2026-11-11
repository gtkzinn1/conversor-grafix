import { useRef, useState } from 'preact/hooks';
import logoDark from './assets/logo-grafix-dark.png';
import logoLight from './assets/logo-grafix-light.png';
import { ErrorMessage } from './components/error-message';
import { UpdateBanner } from './components/update-banner';
import { toAppError, type AppError } from './lib/shared/errors';
import { FILE_KIND_LABELS } from './lib/shared/file-type';
import { formatBytes } from './lib/shared/limits';
import type { InspectFileOutput } from './lib/shared/tasks/inspect-file';
import { inspectFile } from './lib/tasks';
import { getSavedTheme, saveTheme, type Theme } from './lib/theme';

/**
 * Casca PROVISÓRIA da Etapa 1. Serve para validar tema, PWA e workers;
 * o layout definitivo será desenhado junto com o usuário.
 */
export function App() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [result, setResult] = useState<{ name: string; info: InspectFileOutput } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  };

  const onFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const info = await inspectFile(file, { signal: controller.signal });
      setResult({ name: file.name, info });
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.code !== 'cancelled') setError(appError);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
      input.value = '';
    }
  };

  return (
    <div class="shell">
      <header class="shell__header">
        <img
          class="shell__logo"
          src={theme === 'dark' ? logoDark : logoLight}
          alt="Grafix – Gráfica e Comunicação Visual"
          width={1796}
          height={632}
        />
        <button type="button" class="button" onClick={toggleTheme} aria-pressed={theme === 'light'}>
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </button>
      </header>

      <UpdateBanner />

      <main class="shell__card">
        <h1>Conversor</h1>
        <p class="shell__muted">
          Interface em construção. Por enquanto dá para testar a leitura de arquivos: o tipo é
          identificado pelo conteúdo, não pela extensão.
        </p>
        <label>
          <span class="visually-hidden">Escolher arquivo</span>
          <input type="file" data-testid="file-input" onChange={(e) => void onFileChange(e)} />
        </label>
        {busy && (
          <p class="shell__muted" aria-live="polite">
            Lendo arquivo…
          </p>
        )}
        {result && (
          <p data-testid="inspect-result" aria-live="polite">
            {result.name}:{' '}
            {result.info.kind ? FILE_KIND_LABELS[result.info.kind] : 'tipo não reconhecido'} (
            {formatBytes(result.info.size)})
          </p>
        )}
        {error && <ErrorMessage error={error} />}
      </main>

      <footer class="shell__muted">Nenhum arquivo sai deste computador.</footer>
    </div>
  );
}
