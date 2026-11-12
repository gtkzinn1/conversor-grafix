import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { readJpegInfo, readPngDpi } from '../../src/tools/convert-image/metadata';
import { expect, test } from './fixtures';

/** "Converter imagens" de ponta a ponta, no Chrome (decodificação e codificação reais). */

const sample = (name: string) => `tests/samples/${name}`;

async function open(page: Page, option: string, ...files: string[]) {
  await page.goto('/#/converter-imagens');
  await page.getByRole('radio', { name: option, exact: true }).check();
  if (files.length > 0) await page.getByTestId('file-input').setInputFiles(files.map(sample));
}

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile(await file.path())),
  };
}

/** Largura e altura gravadas no IHDR do PNG. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
};

test('PNG transparente para JPG: fundo branco e DPI mantido', async ({ page }) => {
  await open(page, 'Converter', 'logo-transparente.png');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('200 × 200 px');
  await expect(row).toContainText('O JPG não tem transparência: o fundo ficou branco.');
  const { name, bytes } = await download(page, row.getByRole('button', { name: 'Baixar' }));
  expect(name).toBe('logo-transparente.jpg');
  expect(readJpegInfo(bytes)).toMatchObject({ width: 200, height: 200, dpi: 300 });
});

test('redimensiona pela largura e aplica a orientação EXIF', async ({ page }) => {
  await page.goto('/#/converter-imagens');
  await page.getByRole('radio', { name: 'Manter', exact: true }).check();
  await page.getByRole('radio', { name: 'Largura (px)', exact: true }).check();
  await page.getByLabel('Largura em px').fill('100');
  await page.getByTestId('file-input').setInputFiles(sample('foto-girada.jpg'));
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('100 × 200 px');
  const { name, bytes } = await download(page, row.getByRole('button', { name: 'Baixar' }));
  expect(name).toBe('foto-girada (redimensionado).jpg');
  // A foto já sai em pé: sem orientação EXIF para girar de novo.
  expect(readJpegInfo(bytes)).toMatchObject({ width: 100, height: 200, orientation: 1, dpi: 300 });
});

test('cm + DPI grava a resolução no PNG', async ({ page }) => {
  await page.goto('/#/converter-imagens');
  await page.getByRole('radio', { name: 'PNG', exact: true }).check();
  await page.getByRole('radio', { name: 'cm + DPI', exact: true }).check();
  await page.getByLabel('Largura em cm').fill('2');
  await page.getByLabel('Resolução em DPI').fill('300');
  await page.getByTestId('file-input').setInputFiles(sample('imagem.webp'));
  const row = page.getByTestId('file-row');
  // 2 cm a 300 DPI = 236 px; altura proporcional (120 × 80).
  await expect(row).toContainText('236 × 157 px');
  const { name, bytes } = await download(page, row.getByRole('button', { name: 'Baixar' }));
  expect(name).toBe('imagem.png');
  expect(pngSize(bytes)).toEqual([236, 157]);
  expect(readPngDpi(bytes)).toBe(300);
});

test('opção inválida não entra na fila', async ({ page }) => {
  await page.goto('/#/converter-imagens');
  await page.getByRole('radio', { name: 'Largura (px)', exact: true }).check();
  await page.getByLabel('Largura em px').fill('0');
  await page.getByTestId('file-input').setInputFiles(sample('imagem.webp'));
  await expect(page.getByRole('alert')).toContainText('A largura vai de 1 a 20.000 px.');
  await expect(page.getByTestId('file-row')).toHaveCount(0);
});

test('imagens para PDF: ordena, mantém o JPEG CMYK e a transparência', async ({ page }) => {
  await open(page, 'Imagens para PDF', 'logo-transparente.png', 'cmyk.jpg', 'foto-girada.jpg');
  const cards = page.getByTestId('image-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('img')).toHaveCount(3);
  await page.getByRole('button', { name: 'Mover cmyk.jpg para antes' }).click();
  await expect(cards.nth(0)).toContainText('1. cmyk.jpg');
  // Arrastar também muda a ordem.
  await cards.nth(2).dragTo(cards.nth(1));
  await expect(cards.nth(1)).toContainText('2. foto-girada.jpg');
  await page.getByRole('radio', { name: 'A4', exact: true }).check();

  const { name, bytes } = await download(page, page.getByRole('button', { name: 'Gerar PDF' }));
  expect(name).toBe('cmyk.pdf');
  const text = Buffer.from(bytes).toString('latin1');
  expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3);
  // JPEGs entram como estão (sem recompressão); o PNG leva a máscara de transparência.
  expect(text.match(/\/DCTDecode/g)).toHaveLength(2);
  expect(text).toContain('/DeviceCMYK');
  expect(text.match(/\/SMask/g)).toHaveLength(1);
  await expect(page.getByRole('status')).toContainText('Baixado: cmyk.pdf');
});

test('imagem corrompida aparece com erro e fica fora do PDF', async ({ page }) => {
  await open(page, 'Imagens para PDF');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'cmyk.jpg', mimeType: 'image/jpeg', buffer: await readFile(sample('cmyk.jpg')) },
    {
      name: 'quebrada.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    },
  ]);
  const cards = page.getByTestId('image-card');
  await expect(cards.nth(1)).toContainText('Não foi possível ler esta imagem.');
  await expect(page.getByText('1 imagem, nesta ordem.')).toBeVisible();
  const { bytes } = await download(page, page.getByRole('button', { name: 'Gerar PDF' }));
  expect(
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type \/Page\b/g),
  ).toHaveLength(1);
});
