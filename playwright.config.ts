import { defineConfig } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env['CI']);

/**
 * Testes ponta a ponta no Google Chrome instalado (o navegador usado na Grafix),
 * contra a build de produção servida com os mesmos cabeçalhos do Cloudflare Pages.
 * Rode `npm run build` antes.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
