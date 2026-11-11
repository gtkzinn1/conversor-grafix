import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID,
  defaultModel,
  MODEL_VARIANTS,
  modelsFor,
} from '../../src/tools/remove-bg/models';

describe('modelos do remover fundo', () => {
  it('o padrão é o BiRefNet 512 no processador', () => {
    const model = defaultModel();
    expect(model.id).toBe(DEFAULT_MODEL_ID);
    expect(model.backend).toBe('wasm');
    expect(model.inputSize).toBe(512);
  });

  it('sem WebGPU, só sobra o modelo do processador', () => {
    expect(modelsFor({ webGpu: false, shaderF16: false }).map((m) => m.id)).toEqual([
      DEFAULT_MODEL_ID,
    ]);
  });

  it('com WebGPU, a placa vira opção e o padrão continua no topo', () => {
    const semF16 = modelsFor({ webGpu: true, shaderF16: false });
    expect(semF16[0]?.id).toBe(DEFAULT_MODEL_ID);
    expect(semF16.some((m) => m.needsShaderF16)).toBe(false);
    expect(modelsFor({ webGpu: true, shaderF16: true })).toHaveLength(MODEL_VARIANTS.length);
  });

  it('todo modelo tem revisão fixa e SHA-256', () => {
    for (const model of MODEL_VARIANTS) {
      expect(model.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//);
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
