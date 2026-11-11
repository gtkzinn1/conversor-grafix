import { test as base, expect } from '@playwright/test';

/**
 * Fixture que vigia a página durante cada teste:
 * - erros e avisos no console;
 * - violações de CSP;
 * - qualquer requisição para fora do próprio app.
 * Ao final do teste, tudo isso precisa estar vazio.
 */
export const test = base.extend<{ guard: { externalRequests: string[] } }>({
  guard: [
    async ({ page, baseURL }, use) => {
      const consoleProblems: string[] = [];
      const externalRequests: string[] = [];
      const origin = new URL(baseURL ?? 'http://localhost').origin;

      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleProblems.push(`[${message.type()}] ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => consoleProblems.push(`[pageerror] ${error.message}`));
      page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        if (new URL(url).origin !== origin) externalRequests.push(url);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(`CSP bloqueou ${event.blockedURI} (${event.violatedDirective})`);
        });
      });

      const guard = { externalRequests };
      await use(guard);

      expect(consoleProblems, 'console sem erros nem avisos').toEqual([]);
      expect(externalRequests, 'nenhuma requisição externa').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
