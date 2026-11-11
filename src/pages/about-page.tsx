import licensesText from '../../THIRD_PARTY_LICENSES.md?raw';
import { Icon } from '../components/icon';

const COMPONENTS = [
  { name: 'Preact', license: 'MIT', use: 'Interface' },
  { name: 'Workbox', license: 'MIT', use: 'Funcionamento offline e atualizações' },
  { name: 'Exo 2', license: 'SIL Open Font License 1.1', use: 'Fonte' },
] as const;

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
