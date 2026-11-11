import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { headersForPath, parseHeadersFile } from './headers.ts';

/**
 * Aplica `public/_headers` ao `vite preview`, reproduzindo o comportamento do
 * Cloudflare Pages. Não é aplicado ao `vite dev`, porque o servidor de
 * desenvolvimento injeta estilos e scripts que a CSP de produção bloquearia.
 */
export function cloudflareHeaders(headersFile = 'public/_headers'): Plugin {
  return {
    name: 'grafix:cloudflare-headers',
    configurePreviewServer(server) {
      const rules = parseHeadersFile(readFileSync(resolve(headersFile), 'utf8'));
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        for (const [name, value] of headersForPath(rules, path)) res.setHeader(name, value);
        next();
      });
    },
  };
}
