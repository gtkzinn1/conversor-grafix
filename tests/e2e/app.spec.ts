import { expect, test } from './fixtures';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

test.describe('casca do app', () => {
  test('abre na ferramenta padrão com cabeçalhos de segurança ativos', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);

    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('credentialless');

    await expect(page).toHaveURL(/#\/corrigir-pdf$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Corrigir PDF para o Corel');
    await expect(page).toHaveTitle('Corrigir PDF para o Corel · Conversor Grafix');
    // Necessário para WASM com várias threads (ONNX Runtime) nas próximas etapas.
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  });

  test('menu lateral leva a cada ferramenta e marca a atual', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Ferramentas' });
    const expected = [
      ['Remover fundo', 'Remover fundo'],
      ['Converter imagens', 'Converter imagens'],
      ['Editar PDF', 'Editar PDF'],
      ['Corrigir PDF', 'Corrigir PDF para o Corel'],
    ] as const;
    for (const [link, title] of expected) {
      await nav.getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('endereço desconhecido volta para a ferramenta padrão', async ({ page }) => {
    await page.goto('/#/nao-existe');
    await expect(page).toHaveURL(/#\/corrigir-pdf$/);
  });

  test('Editar PDF tem a opção de cortar', async ({ page }) => {
    await page.goto('/#/editar-pdf');
    const cortar = page.getByRole('radio', { name: 'Cortar' });
    await cortar.check();
    await expect(cortar).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Juntar' })).not.toBeChecked();
  });

  test('tela Sobre mostra versão, privacidade e licenças', async ({ page }) => {
    await page.goto('/#/sobre');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sobre o Conversor');
    await expect(page.getByText(/^Versão \d+\.\d+\.\d+$/)).toBeVisible();
    await expect(
      page.getByText('Nenhum arquivo sai deste computador.', { exact: false }),
    ).toBeVisible();
    await page.getByText('Ver textos completos das licenças').click();
    await expect(page.getByText('SIL OPEN FONT LICENSE Version 1.1')).toBeVisible();
  });

  test('tema escuro por padrão; o claro fica salvo e troca o logo', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const logo = page.locator('.sidebar__brand img');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(logo).toHaveAttribute('src', /logo-grafix-dark/);

    await page.getByRole('button', { name: 'Tema claro' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(logo).toHaveAttribute('src', /logo-grafix-light/);
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
    await page.goto('/#/remover-fundo');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remover fundo');
    await expect(page.locator('.sidebar__brand img')).toHaveJSProperty('complete', true);
    await context.setOffline(false);
  });
});

test.describe('área de soltar e lista de arquivos', () => {
  test('confere o tipo pelo conteúdo e explica a recusa', async ({ page }) => {
    await page.goto('/#/editar-pdf');
    await page.getByTestId('file-input').setInputFiles([
      { name: 'arte.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%fake\n') },
      { name: 'foto.pdf', mimeType: 'application/pdf', buffer: PNG },
      { name: 'vazio.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
    ]);
    const rows = page.getByTestId('file-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('PDF · 15 B');
    await expect(rows.nth(1)).toContainText(
      'Esta ferramenta aceita PDF, e o conteúdo deste arquivo é PNG.',
    );
    await expect(rows.nth(2)).toContainText('O arquivo está vazio.');
  });

  test('cada ferramenta aceita seus próprios tipos', async ({ page }) => {
    await page.goto('/#/converter-imagens');
    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('file-row')).toContainText('PNG ·');
  });

  test('arrastar e soltar adiciona o arquivo', async ({ page }) => {
    await page.goto('/#/editar-pdf');
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['%PDF-1.7\n'], 'solto.pdf', { type: 'application/pdf' }));
      return data;
    });
    const zone = page.getByTestId('dropzone');
    await zone.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(zone).toHaveClass(/dropzone--active/);
    await zone.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(zone).not.toHaveClass(/dropzone--active/);
    await expect(page.getByTestId('file-row')).toContainText('solto.pdf');
  });

  test('remover tira o arquivo da lista', async ({ page }) => {
    await page.goto('/#/editar-pdf');
    await page.getByTestId('file-input').setInputFiles({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    });
    await page.getByRole('button', { name: 'Remover a.pdf' }).click();
    await expect(page.getByTestId('file-row')).toHaveCount(0);
  });

  test('nome de arquivo com HTML não vira HTML', async ({ page }) => {
    await page.goto('/#/converter-imagens');
    const name = '<img src=x onerror=alert(1)>.png';
    await page
      .getByTestId('file-input')
      .setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('file-row')).toContainText(name);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
