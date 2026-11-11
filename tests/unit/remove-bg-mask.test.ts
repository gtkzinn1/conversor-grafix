import { describe, expect, it } from 'vitest';
import {
  boxBlur,
  logitsToMask,
  refineForeground,
  toInputTensor,
  upscaleMask,
} from '../../src/tools/remove-bg/mask';

/** Gerador simples e reprodutível. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Média de caixa ingênua, para comparar com a versão rápida. */
function naiveBlur(plane: Float32Array, width: number, height: number, k: number) {
  const before = Math.floor(k / 2);
  const after = k - 1 - before;
  const out = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let yy = Math.max(0, y - before); yy <= Math.min(height - 1, y + after); yy++) {
        for (let xx = Math.max(0, x - before); xx <= Math.min(width - 1, x + after); xx++) {
          sum += plane[yy * width + xx] ?? 0;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

describe('toInputTensor', () => {
  it('normaliza cada canal com média e desvio do ImageNet, em planos separados', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 128, 255, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0,
    ]);
    const tensor = toInputTensor(rgba, 2);
    expect(tensor).toHaveLength(12);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(tensor[4 + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(tensor[8]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5);
  });

  it('recusa tamanho inconsistente', () => {
    expect(() => toInputTensor(new Uint8ClampedArray(12), 2)).toThrow(RangeError);
  });
});

describe('logitsToMask', () => {
  it('aplica a sigmoide e converte para 0–255', () => {
    expect([...logitsToMask(new Float32Array([0, 20, -20]))]).toEqual([128, 255, 0]);
  });
});

describe('upscaleMask', () => {
  it('mantém áreas uniformes e chega à resolução pedida', () => {
    const mask = new Uint8Array([255, 255, 0, 0]);
    const big = upscaleMask(mask, 2, 6, 5);
    expect(big).toHaveLength(30);
    expect(big[0]).toBe(255);
    expect(big[29]).toBe(0);
  });
});

describe('boxBlur', () => {
  it.each([1, 6, 11])('é igual à média ingênua (caixa %i)', (k) => {
    const next = random(k);
    const width = 23;
    const height = 17;
    const plane = Float32Array.from({ length: width * height }, () => next());
    const expected = naiveBlur(plane, width, height, k);
    boxBlur(plane, width, height, k);
    for (let i = 0; i < plane.length; i++) expect(plane[i]).toBeCloseTo(expected[i] ?? 0, 4);
  });
});

describe('refineForeground', () => {
  /** Quadrado vermelho com borda suave sobre fundo azul. */
  function scene(width: number, height: number) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height);
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const distance = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        const a = Math.min(1, Math.max(0, (width / 4 - distance) / 4 + 0.5));
        const i = y * width + x;
        rgba[i * 4] = Math.round(255 * a);
        rgba[i * 4 + 2] = Math.round(255 * (1 - a));
        rgba[i * 4 + 3] = 255;
        alpha[i] = Math.round(255 * a);
      }
    }
    return { rgba, alpha };
  }

  it('aplica a máscara como alfa', () => {
    const { rgba, alpha } = scene(40, 40);
    refineForeground(rgba, alpha, 40, 40);
    for (let i = 0; i < alpha.length; i++) expect(rgba[i * 4 + 3]).toBe(alpha[i]);
  });

  it('tira o azul do fundo da borda do objeto', () => {
    const { rgba, alpha } = scene(80, 80);
    const before = rgba.slice();
    refineForeground(rgba, alpha, 80, 80);
    let blueBefore = 0;
    let blueAfter = 0;
    for (let i = 0; i < alpha.length; i++) {
      const a = alpha[i] ?? 0;
      if (a > 40 && a < 215) {
        blueBefore += before[i * 4 + 2] ?? 0;
        blueAfter += rgba[i * 4 + 2] ?? 0;
      }
    }
    expect(blueBefore).toBeGreaterThan(0);
    expect(blueAfter).toBeLessThan(blueBefore * 0.3);
  });

  it('não muda pixels totalmente opacos de uma imagem sem fundo', () => {
    const next = random(7);
    const rgba = Uint8ClampedArray.from({ length: 20 * 10 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : Math.floor(next() * 256),
    );
    const before = rgba.slice();
    refineForeground(rgba, new Uint8Array(200).fill(255), 20, 10);
    expect(rgba).toEqual(before);
  });

  it('dá o mesmo resultado processando em faixas ou de uma vez', () => {
    const first = scene(30, 61);
    const second = scene(30, 61);
    refineForeground(first.rgba, first.alpha, 30, 61, 4);
    refineForeground(second.rgba, second.alpha, 30, 61, 1000);
    expect(first.rgba).toEqual(second.rgba);
  });
});
