/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { cloudflareHeaders } from './scripts/vite-plugin-headers.ts';

const APP_NAME = 'Conversor Grafix';
const THEME_COLOR = '#141418';

export default defineConfig({
  // Nada de sourcemaps em produção: o app é privado e não precisa expor o código-fonte.
  build: {
    target: 'es2023',
    sourcemap: false,
    // Avisa se algum arquivo passar do limite de 25 MiB por arquivo do Cloudflare Pages.
    chunkSizeWarningLimit: 1024,
  },
  worker: {
    format: 'es',
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  plugins: [
    cloudflareHeaders(),
    VitePWA({
      // O usuário decide quando atualizar (aviso "Nova versão disponível").
      registerType: 'prompt',
      injectRegister: false,
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon-180.png'],
      manifest: {
        id: '/',
        name: APP_NAME,
        short_name: 'Conversor',
        description: 'Ferramentas de PDF, imagem e PSD da Grafix. Tudo roda no seu computador.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,wasm,webmanifest}'],
        // A fonte traz alfabetos que o app não usa (cirílico, vietnamita); não guardar offline.
        globIgnores: ['**/*-cyrillic-*.woff2', '**/*-vietnamese-*.woff2', '**/*-italic.woff2'],
        // Remove caches de versões antigas do app ao ativar a nova.
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // Nunca guardar em cache requisições de outros domínios (ex.: o modelo de IA tem cache próprio).
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
