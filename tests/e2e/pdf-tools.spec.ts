import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** "Editar PDF" de ponta a ponta, no Chrome, com o qpdf e o pdf.js reais. */

const sample = (name: string) => `tests/samples/${name}`;

async function open(page: Page, option: string, ...files: string[]) {
  await page.goto('/#/editar-pdf');
  await page.getByRole('radio', { name: option, exact: true }).check();
  if (files.length > 0) await page.getByTestId('file-input').setInputFiles(files.map(sample));
}

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

/** Número de páginas pelos objetos /Type /Page (a saída não usa object streams). */
const countPages = (bytes: Buffer) => bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length;

const thumbnails = (page: Page) => page.getByRole('list', { name: 'Páginas' }).getByRole('button');

test('juntar: muda a ordem e junta num PDF só', async ({ page }) => {
  await open(page, 'Juntar', 'object-streams-1.7.pdf', 'paginas.pdf');
  const rows = page.getByTestId('file-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveClass(/file-row--ready/);
  await page.getByRole('button', { name: 'Subir paginas.pdf' }).click();
  await expect(rows.nth(0)).toContainText('paginas.pdf');

  const { name, bytes } = await download(
    page,
    page.getByRole('button', { name: 'Juntar e baixar' }),
  );
  expect(name).toBe('paginas (juntado).pdf');
  expect(countPages(bytes)).toBe(5);
  await expect(page.getByRole('status')).toContainText('Baixado: paginas (juntado).pdf');
});

test('extrair: miniaturas, escolha por clique e PDF só com as páginas escolhidas', async ({
  page,
}) => {
  await open(page, 'Extrair páginas', 'paginas.pdf');
  const thumbs = thumbnails(page);
  await expect(thumbs).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText('3 páginas')).toBeVisible();
  await thumbs.nth(0).click();
  await thumbs.nth(2).click();
  await expect(thumbs.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Extrair páginas 1 e 3.')).toBeVisible();

  const { name, bytes } = await download(
    page,
    page.getByRole('button', { name: 'Extrair e baixar' }),
  );
  expect(name).toBe('paginas (páginas).pdf');
  expect(countPages(bytes)).toBe(2);
});

test('girar: gira a página escolhida e grava o giro', async ({ page }) => {
  await open(page, 'Girar', 'paginas.pdf');
  const thumbs = thumbnails(page);
  await expect(thumbs).toHaveCount(3, { timeout: 30_000 });
  await thumbs.nth(0).click();
  await page.getByRole('button', { name: 'Girar à direita' }).click();
  await expect(thumbs.nth(0)).toContainText('90°');

  const { name, bytes } = await download(
    page,
    page.getByRole('button', { name: 'Salvar e baixar' }),
  );
  expect(name).toBe('paginas (girado).pdf');
  expect(bytes.toString('latin1')).toMatch(/\/Rotate 90/);
});

test('cortar: área desenhada com o mouse vira a nova caixa das páginas', async ({ page }) => {
  await open(page, 'Cortar', 'paginas.pdf');
  const overlay = page.getByTestId('crop-overlay');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  const box = await overlay.boundingBox();
  if (!box) throw new Error('sem área de corte');
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  // Metade da largura de uma A4 (210 mm).
  await expect(page.getByRole('spinbutton', { name: 'Largura' })).toHaveValue(/^10[4-6]\.\d$/);

  await page.getByRole('radio', { name: 'Todas as páginas' }).check();
  const { name, bytes } = await download(
    page,
    page.getByRole('button', { name: 'Cortar e baixar' }),
  );
  expect(name).toBe('paginas (cortado).pdf');
  expect(bytes.toString('latin1').match(/\/CropBox/g)).toHaveLength(3);
  await expect(page.getByText('escondido, não apagado', { exact: false })).toBeVisible();
});

test('separar: um PDF por página, num ZIP', async ({ page }) => {
  await open(page, 'Separar', 'paginas.pdf');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('um PDF por página', { timeout: 30_000 });
  const { name, bytes } = await download(page, row.getByRole('button', { name: 'Baixar' }));
  expect(name).toBe('paginas (páginas).zip');
  expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  expect(bytes.toString('utf8')).toContain('paginas - página 3.pdf');
});

test('comprimir: imagens em JPEG deixam o PDF menor', async ({ page }) => {
  await open(page, 'Comprimir', 'imagem-pesada.pdf');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('% menor', { timeout: 60_000 });
  const { name, bytes } = await download(page, row.getByRole('button', { name: 'Baixar' }));
  expect(name).toBe('imagem-pesada (comprimido).pdf');
  expect(bytes.toString('latin1')).toContain('/DCTDecode');
});

test('PDF para imagem: uma página vira PNG; várias, um ZIP', async ({ page }) => {
  await open(page, 'PDF para imagem');
  await page.getByRole('radio', { name: '150 DPI' }).check();
  await page
    .getByTestId('file-input')
    .setInputFiles([sample('canva-tags.pdf'), sample('paginas.pdf')]);
  const rows = page.getByTestId('file-row');
  await expect(rows.nth(0)).toContainText('150 DPI', { timeout: 60_000 });
  await expect(rows.nth(1)).toContainText('3 páginas', { timeout: 60_000 });

  const single = await download(page, rows.nth(0).getByRole('button', { name: 'Baixar' }));
  expect(single.name).toBe('canva-tags.png');
  expect(single.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  // Página Carta (612 pt) a 150 DPI: 1275 px de largura (cabeçalho IHDR do PNG).
  expect(single.bytes.readUInt32BE(16)).toBe(1275);
  const zip = await download(page, rows.nth(1).getByRole('button', { name: 'Baixar' }));
  expect(zip.name).toBe('paginas (imagens).zip');
});

test('PDF com senha: pede a senha antes das miniaturas', async ({ page }) => {
  await open(page, 'Extrair páginas', 'senha-grafix.pdf');
  await expect(page.getByText('Este PDF tem senha de abertura.')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByPlaceholder('Senha').fill('grafix');
  await page.getByRole('button', { name: 'Abrir' }).click();
  await expect(thumbnails(page)).toHaveCount(1, { timeout: 30_000 });
});
