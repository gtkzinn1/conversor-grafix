import { useEffect, useState } from 'preact/hooks';
import licensesText from '../../THIRD_PARTY_LICENSES.md?raw';
import { Icon } from '../components/icon';
import { formatBytes } from '../lib/shared/limits';
import { cachedModelIds } from '../tools/remove-bg/model-cache';
import { MODEL_VARIANTS } from '../tools/remove-bg/models';
import { useAiModel } from '../tools/remove-bg/use-ai-model';

const COMPONENTS = [
  { name: 'Preact', license: 'MIT', use: 'Interface' },
  { name: 'Workbox', license: 'MIT', use: 'Funcionamento offline e atualizações' },
  { name: 'Exo 2', license: 'SIL Open Font License 1.1', use: 'Fonte' },
  { name: 'qpdf', license: 'Apache 2.0', use: 'Leitura e gravação de PDF' },
  { name: 'PDF.js', license: 'Apache 2.0', use: 'Conferência visual de PDF' },
  { name: 'ONNX Runtime Web', license: 'MIT', use: 'Execução do modelo de IA' },
  { name: 'BiRefNet', license: 'MIT', use: 'Modelo de IA do remover fundo (baixado no 1º uso)' },
  { name: 'zlib e libjpeg (IJG)', license: 'zlib e IJG', use: 'Compressão e imagens JPEG' },
] as const;

/** Espaço ocupado pelos modelos baixados (tamanhos conferidos no download). */
async function cachedBytes(): Promise<number> {
  const ids = await cachedModelIds(MODEL_VARIANTS).catch(() => new Set<string>());
  return MODEL_VARIANTS.filter((model) => ids.has(model.id)).reduce(
    (total, model) => total + model.bytes,
    0,
  );
}

/** Modelo de IA (seção 6.4): escolha do modelo, espaço ocupado e exclusão do cache. */
function AiModelSettings() {
  const ai = useAiModel();
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const status = ai.state.status;

  useEffect(() => {
    void cachedBytes().then(setBytes);
  }, [status]);

  const current = ai.state.status === 'detecting' ? null : ai.state.model;

  return (
    <section class="about__block" aria-labelledby="ai-model-title">
      <h2 id="ai-model-title">Modelo de IA</h2>
      <p class="about__muted">
        Usado pelo “Remover fundo”. É baixado do Hugging Face uma vez por computador e fica guardado
        no navegador.
      </p>
      <ul class="about__list">
        <li>
          <label class="about__select">
            <span>Modelo</span>
            <select
              value={current?.id}
              disabled={!current || status === 'downloading'}
              onChange={(event) => {
                ai.choose(event.currentTarget.value);
              }}
            >
              {ai.choices.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({formatBytes(model.bytes)})
                </option>
              ))}
            </select>
          </label>
          <span class="about__muted">
            {status === 'ready' ? 'baixado' : status === 'detecting' ? '…' : 'não baixado'}
          </span>
        </li>
        <li>
          <span>Espaço ocupado</span>
          <span class="about__muted">
            {bytes === null ? '…' : bytes === 0 ? 'nenhum modelo baixado' : formatBytes(bytes)}
          </span>
        </li>
      </ul>
      {ai.choices.some((model) => model.backend === 'webgpu') && (
        <p class="about__muted">
          Os modelos “na placa de vídeo” são mais detalhados, mas podem travar placas antigas. Se a
          placa parar de responder, o app volta sozinho para o processador.
        </p>
      )}
      {ai.gpuDisabled && (
        <p class="notice notice--warning">
          <Icon name="alert" size={18} />A placa de vídeo parou de responder num recorte e foi
          desligada neste computador.
        </p>
      )}
      <div class="about__actions">
        <button
          type="button"
          class="button"
          disabled={busy || bytes === 0}
          onClick={() => {
            setBusy(true);
            void ai
              .clear()
              .then(cachedBytes)
              .then(setBytes)
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Apagar modelos baixados
        </button>
        {ai.gpuDisabled && (
          <button type="button" class="button" onClick={ai.enableGpu}>
            Voltar a oferecer a placa de vídeo
          </button>
        )}
      </div>
    </section>
  );
}

export function AboutPage() {
  return (
    <section class="tool about" aria-labelledby="about-title">
      <header class="tool__header">
        <h1 id="about-title">Sobre o Conversor</h1>
        <p class="tool__description">Versão {__APP_VERSION__}</p>
      </header>

      <p class="notice notice--privacy">
        <Icon name="lock" size={18} />
        Nenhum arquivo sai deste computador. Tudo é processado aqui mesmo, no navegador, e funciona
        sem internet.
      </p>

      <AiModelSettings />

      <div class="about__block">
        <h2>Componentes de terceiros</h2>
        <ul class="about__list">
          {COMPONENTS.map((component) => (
            <li key={component.name}>
              <span>{component.name}</span>
              <span class="about__muted">
                {component.use} · {component.license}
              </span>
            </li>
          ))}
        </ul>
        <details class="about__licenses">
          <summary>Ver textos completos das licenças</summary>
          <pre>{licensesText}</pre>
        </details>
      </div>

      <p class="about__muted">Feito para a Grafix – Gráfica e Comunicação Visual.</p>
    </section>
  );
}
