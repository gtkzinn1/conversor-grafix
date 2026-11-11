import { useEffect, useState } from 'preact/hooks';
import { Sidebar } from './components/sidebar';
import { UpdateBanner } from './components/update-banner';
import { hrefFor, useRoute } from './lib/router';
import { getSavedTheme, saveTheme, type Theme } from './lib/theme';
import { AboutPage } from './pages/about-page';
import { ToolPage } from './pages/tool-page';
import { DEFAULT_TOOL_ID, findTool } from './tools/registry';

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(getSavedTheme);

  const tool = findTool(route);
  const isAbout = route === 'sobre';

  // Endereço vazio ou desconhecido: abre a ferramenta padrão.
  useEffect(() => {
    if (!tool && !isAbout) window.location.replace(hrefFor(DEFAULT_TOOL_ID));
  }, [tool, isAbout]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  };

  const pageTitle = isAbout ? 'Sobre' : tool?.name;
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · Conversor Grafix` : 'Conversor Grafix';
  }, [pageTitle]);

  return (
    <div class="layout">
      <Sidebar route={route} theme={theme} onToggleTheme={toggleTheme} />
      <main class="layout__main">
        <UpdateBanner />
        {isAbout ? <AboutPage /> : tool && <ToolPage key={tool.id} tool={tool} />}
      </main>
    </div>
  );
}
