import { describe, expect, it } from 'vitest';
import { differingFraction } from '../../src/tools/pdf-corel/pixel-diff';

const pixels = (...values: number[][]) => Uint8ClampedArray.from(values.flat());

describe('differingFraction', () => {
  it('imagens iguais: 0', () => {
    const a = pixels([255, 255, 255, 255], [0, 0, 0, 255]);
    expect(differingFraction(a, a.slice())).toBe(0);
  });

  it('ignora pequenas diferenças de suavização', () => {
    expect(differingFraction(pixels([100, 100, 100, 255]), pixels([130, 90, 120, 255]))).toBe(0);
  });

  it('conta pixels que mudaram de verdade', () => {
    const a = pixels([255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]);
    const b = pixels([255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 0]);
    expect(differingFraction(a, b)).toBe(0.5);
  });

  it('tamanhos diferentes ou vazio contam como tudo diferente', () => {
    expect(differingFraction(pixels([0, 0, 0, 0]), pixels([0, 0, 0, 0], [0, 0, 0, 0]))).toBe(1);
    expect(differingFraction(new Uint8ClampedArray(), new Uint8ClampedArray())).toBe(1);
  });
});
