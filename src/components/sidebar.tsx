import logoDark from '../assets/logo-grafix-dark.png';
import logoLight from '../assets/logo-grafix-light.png';
import { hrefFor } from '../lib/router';
import type { Theme } from '../lib/theme';
import { TOOL_GROUPS, TOOLS } from '../tools/registry';
import { Icon } from './icon';

interface SidebarProps {
  readonly route: string;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
}

export function Sidebar({ route, theme, onToggleTheme }: SidebarProps) {
  return (
    <aside class="sidebar">
      <a class="sidebar__brand" href={hrefFor(TOOLS[0]?.id ?? '')}>
        <img
          src={theme === 'dark' ? logoDark : logoLight}
          alt="Grafix – Gráfica e Comunicação Visual"
          width={180}
          height={63}
        />
      </a>

      <nav class="sidebar__nav" aria-label="Ferramentas">
        {TOOL_GROUPS.map((group) => (
          <div key={group} class="sidebar__group">
            <p class="sidebar__group-label" id={`grupo-${group}`}>
              {group}
            </p>
            <ul aria-labelledby={`grupo-${group}`}>
              {TOOLS.filter((tool) => tool.group === group).map((tool) => (
                <li key={tool.id}>
                  <a
                    class="sidebar__link"
                    href={hrefFor(tool.id)}
                    aria-current={route === tool.id ? 'page' : undefined}
                  >
                    <Icon name={tool.icon} />
                    {tool.menuLabel}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div class="sidebar__footer">
        <a
          class="sidebar__link"
          href={hrefFor('sobre')}
          aria-current={route === 'sobre' ? 'page' : undefined}
        >
          <Icon name="info" />
          Sobre
        </a>
        <button type="button" class="sidebar__link" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </button>
      </div>
    </aside>
  );
}
