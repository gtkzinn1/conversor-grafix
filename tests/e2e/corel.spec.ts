import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Ferramenta "Corrigir PDF para o Corel" de ponta a ponta, no Chrome, com o qpdf WebAssembly real. */

async function dropSamples(
  page: Page,
  option: 'Correção básica' | 'Básica + degradês',
  ...names: string[]
) {
  await page.goto('/#/corrigir-pdf');
  await page.getByRole('radio', { name: option }).check();
  await page.getByTestId('file-input').setInputFiles(names.map((name) => `tests/samples/${name}`));
}

async function download(page: Page, row: ReturnType<Page['getByTestId']>) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Baixar' }).click(),
  ]);
  const path = await file.path();
  return { name: file.suggestedFilename(), bytes: await readFile(path) };
}

test('PDF no estilo Canva: corrige, confere e baixa como "(corel).pdf" em PDF 1.4', async ({
  page,
}) => {
  await dropSamples(page, 'Correção básica', 'canva-tags.pdf');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('marcações de acessibilidade removidas', { timeout: 30_000 });
  await expect(row).not.toContainText('conferência visual');

  const { name, bytes } = await download(page, row);
  expect(name).toBe('canva-tags (corel).pdf');
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).not.toContain('/StructTreeRoot');
  expect(text).not.toContain('/ObjStm');
  expect(text).toMatch(/\nxref\n/);
});

test('vários arquivos de uma vez, com resumo de cada um', async ({ page }) => {
  await dropSamples(
    page,
    'Correção básica',
    'conteudo-ativo.pdf',
    'object-streams-1.7.pdf',
    'xref-quebrada.pdf',
  );
  const rows = page.getByTestId('file-row');
  await expect(rows.nth(0)).toContainText('conteúdo ativo removido', { timeout: 30_000 });
  await expect(rows.nth(1)).toContainText('2 páginas · PDF 1.7 → 1.4', { timeout: 30_000 });
  await expect(rows.nth(2)).toContainText('1 página · PDF 1.4', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Baixar' })).toHaveCount(3);
});

test('PDF com senha de abertura: pede a senha, recusa a errada e aceita a certa', async ({
  page,
}) => {
  await dropSamples(page, 'Correção básica', 'senha-grafix.pdf');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('Este PDF tem senha de abertura.', { timeout: 30_000 });
  const field = row.getByPlaceholder('Senha de abertura');
  await field.fill('errada');
  await row.getByRole('button', { name: 'Abrir' }).click();
  await expect(row).toContainText('A senha não confere', { timeout: 30_000 });
  await field.fill('grafix');
  await row.getByRole('button', { name: 'Abrir' }).click();
  await expect(row).toContainText('proteção removida', { timeout: 30_000 });
  const { bytes } = await download(page, row);
  expect(bytes.toString('latin1')).not.toContain('/Encrypt');
});

test('degradês: viram cor sólida e os originais vão para a página de amostras', async ({
  page,
}) => {
  await dropSamples(page, 'Básica + degradês', 'degrades.pdf');
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('10 degradês trocados por cor sólida', { timeout: 30_000 });
  await expect(row).toContainText('cor aproximada (degradê de malha, tipo 4)');
  await expect(row).not.toContainText('mantido');
  await expect(row).not.toContainText('conferência visual encontrou diferença');
  await expect(row).toContainText('degradês originais numa página extra no fim');
  const { bytes } = await download(page, row);
  const text = bytes.toString('latin1');
  // Degradês só na página de amostras, e nunca como padrão (o Corel recusa /Pattern scn).
  expect(text).not.toContain('/PatternType');
  expect(text).toMatch(/\/Sw1 <</);
});

test('arquivo com extensão .pdf que não é PDF é recusado antes de processar', async ({ page }) => {
  await page.goto('/#/corrigir-pdf');
  await page.getByTestId('file-input').setInputFiles({
    name: 'falso.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await expect(page.getByTestId('file-row')).toContainText('o conteúdo deste arquivo é PNG');
});

test('PDF ilegível mostra erro em português, com detalhe técnico recolhível', async ({ page }) => {
  await page.goto('/#/corrigir-pdf');
  await page.getByTestId('file-input').setInputFiles({
    name: 'quebrado.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nisto não é um PDF de verdade\n%%EOF'),
  });
  const row = page.getByTestId('file-row');
  await expect(row).toContainText('Não foi possível ler este PDF', { timeout: 30_000 });
  await expect(row.getByText('Detalhes técnicos')).toBeVisible();
});
