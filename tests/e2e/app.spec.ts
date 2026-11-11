import { expect, test } from './fixtures';

test.describe('casca do app', () => {
  test('abre com cabeçalhos de segurança ativos', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);

    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('credentialless');

    await expect(page.getByRole('heading', { name: 'Conversor' })).toBeVisible();
    await expect(page.getByText('Nenhum arquivo sai deste computador.')).toBeVisible();
    // Necessário para WASM com várias threads (ONNX Runtime) nas próximas etapas.
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  });

  test('tema escuro por padrão; o claro fica salvo', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Tema claro' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f6f8');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Tema escuro' })).toBeVisible();
  });

  test('manifest do PWA válido', async ({ page, request }) => {
    await page.goto('/');
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      name: string;
      display: string;
      lang: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe('Conversor Grafix');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('pt-BR');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect((await request.get(`/${icon.src}`)).ok(), icon.src).toBe(true);
    }
  });

  test('funciona offline depois da primeira visita', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Garante que a página atual é controlada pelo service worker.
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Conversor' })).toBeVisible();
    await expect(page.locator('img[alt^="Grafix"]')).toHaveJSProperty('complete', true);
    await context.setOffline(false);
  });
});

test.describe('leitura de arquivo em worker', () => {
  test('identifica o tipo pelo conteúdo', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('file-input');

    await input.setInputFiles({
      name: 'arte.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%fake\n'),
    });
    await expect(page.getByTestId('inspect-result')).toHaveText('arte.pdf: PDF (15 B)');

    // Extensão .pdf, mas o conteúdo não é PDF.
    await input.setInputFiles({
      name: 'falso.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('isto não é pdf'),
    });
    await expect(page.getByTestId('inspect-result')).toContainText(
      'falso.pdf: tipo não reconhecido',
    );
  });

  test('arquivo vazio mostra erro em português', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles({
      name: 'vazio.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(0),
    });
    await expect(page.getByRole('alert')).toContainText('O arquivo está vazio.');
  });

  test('nome de arquivo com HTML não vira HTML', async ({ page }) => {
    await page.goto('/');
    const name = '<img src=x onerror=alert(1)>.png';
    await page.getByTestId('file-input').setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(page.getByTestId('inspect-result')).toContainText(`${name}: PNG`);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
