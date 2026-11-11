import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Arquivo do modelo padrão no OPFS, como em `modelFileName` (`model-cache.ts`). */
const DEFAULT_MODEL_FILE = 'birefnet-512-fp32-617a11ca04cb13a2.onnx';

/**
 * Simula o modelo sem baixar 897 MB: um arquivo falso no OPFS faz a tela considerar o modelo
 * baixado, e o worker do recorte é trocado por um que devolve a metade esquerda da imagem.
 * Nada disso existe no app: só neste teste.
 */
async function simulateModel(page: Page) {
  await page.addInitScript(() => {
    const RealWorker = window.Worker;
    class FakeRemoveBgWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      postMessage(message: { input: { file: Blob } }) {
        void (async () => {
          const bitmap = await createImageBitmap(message.input.file);
          const { width, height } = bitmap;
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(
            bitmap,
            0,
            0,
            Math.ceil(width / 2),
            height,
            0,
            0,
            Math.ceil(width / 2),
            height,
          );
          const png = await canvas.convertToBlob({ type: 'image/png' });
          this.onmessage?.({
            data: { type: 'done', output: { png, width, height, backend: 'wasm' } },
          });
        })();
      }
      terminate() {
        // Nada a encerrar.
      }
    }
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (options?.name === 'remove-bg') return new FakeRemoveBgWorker() as unknown as Worker;
        super(url, options);
      }
    };
  });
  await page.goto('/#/sobre');
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('modelo-ia', { create: true });
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
    await writable.write('modelo simulado');
    await writable.close();
  }, DEFAULT_MODEL_FILE);
}

/** PNG opaco de 64 × 48 px, gerado no navegador. */
async function samplePng(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('sem canvas');
    context.fillStyle = '#c03030';
    context.fillRect(0, 0, 64, 48);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

test.describe('remover fundo', () => {
  test('pede confirmação antes de baixar o modelo, sem conexão externa', async ({ page }) => {
    await page.goto('/#/remover-fundo');
    await expect(page.getByRole('heading', { name: 'Baixar o modelo de IA' })).toBeVisible();
    await expect(page.getByText('BiRefNet 512 no processador (897 MB)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Baixar 897 MB' })).toBeVisible();
    // Sem o modelo, não há onde soltar imagens.
    await expect(page.getByTestId('dropzone')).toHaveCount(0);
  });

  test('recorta, abre o editor e guarda o ajuste', async ({ page }) => {
    await simulateModel(page);
    await page.goto('/#/remover-fundo');
    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: await samplePng(page) });

    const row = page.getByTestId('file-row');
    await expect(row).toContainText('64 × 48 px');
    await expect(row).toContainText('IA no processador');
    await row.getByRole('button', { name: 'Ajustar' }).click();

    const editor = page.getByRole('region', { name: 'Ajustar foto (sem fundo).png' });
    await expect(editor).toBeVisible();
    const undo = editor.getByRole('button', { name: 'Desfazer (Ctrl+Z)' });
    await expect(undo).toBeDisabled();

    await editor.getByRole('button', { name: 'Restaurar' }).click();
    await expect(editor.getByRole('button', { name: 'Restaurar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const canvas = editor.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas do editor sem tamanho');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Refazer (Ctrl+Y)' })).toBeEnabled();

    await editor.getByRole('button', { name: 'Apagar' }).click();
    await editor.getByRole('combobox', { name: 'Fundo para conferir' }).selectOption('black');

    const download = page.waitForEvent('download');
    await editor.getByRole('button', { name: 'Baixar PNG' }).click();
    expect((await download).suggestedFilename()).toBe('foto (sem fundo).png');
    await expect(editor).toHaveCount(0);
    await expect(row).toContainText('64 × 48 px');

    await row.getByRole('button', { name: 'Ajustar' }).click();
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remover fundo');
  });

  test('recusa arquivo que não é imagem', async ({ page }) => {
    await simulateModel(page);
    await page.goto('/#/remover-fundo');
    await page.getByTestId('file-input').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from('%PDF-1.4\n%fake\n'),
    });
    await expect(page.getByTestId('file-row')).toContainText('o conteúdo deste arquivo é PDF');
  });

  test('Sobre mostra o modelo, o espaço ocupado e apaga o cache', async ({ page }) => {
    await simulateModel(page);
    await page.reload();
    const block = page.getByRole('region', { name: 'Modelo de IA' });
    await expect(block.getByRole('combobox', { name: 'Modelo' })).toHaveValue('birefnet-512-fp32');
    const space = block.getByRole('listitem').filter({ hasText: 'Espaço ocupado' });
    await expect(space).toContainText('897 MB');
    await block.getByRole('button', { name: 'Apagar modelos baixados' }).click();
    await expect(space).toContainText('nenhum modelo baixado');
    await expect(block.getByRole('listitem').first()).toContainText('não baixado');
  });

  test('placa de vídeo desligada pode voltar a ser oferecida', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('conversor:placa-de-video-falhou', '1');
    });
    await page.goto('/#/remover-fundo');
    await expect(
      page.getByText('A placa de vídeo deste computador parou de responder'),
    ).toBeVisible();

    await page.goto('/#/sobre');
    const block = page.getByRole('region', { name: 'Modelo de IA' });
    await expect(block.getByRole('combobox', { name: 'Modelo' }).locator('option')).toHaveCount(1);
    await block.getByRole('button', { name: 'Voltar a oferecer a placa de vídeo' }).click();
    await expect(
      block.getByRole('button', { name: 'Voltar a oferecer a placa de vídeo' }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('conversor:placa-de-video-falhou')),
    ).toBeNull();
  });
});
