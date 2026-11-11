/**
 * Comparação de duas renderizações da mesma página (RGBA, mesmo tamanho).
 * Usada na conferência visual antes de liberar o PDF corrigido (seção 9.3).
 */

/** Diferença mínima num canal (0–255) para o pixel contar como "diferente" (ignora suavização). */
const CHANNEL_TOLERANCE = 48;

/** Fração dos pixels que mudaram de forma visível (0 a 1). Tamanhos diferentes contam como 100%. */
export function differingFraction(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  tolerance = CHANNEL_TOLERANCE,
): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tolerance ||
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) > tolerance ||
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)) > tolerance ||
      Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0)) > tolerance
    ) {
      differing++;
    }
  }
  return differing / (a.length / 4);
}

/** Limites de diferença aceitável por página. */
export const VISUAL_LIMITS = {
  /** Correção básica: o desenho não deve mudar nada. */
  basic: 0.005,
  /**
   * Correção de degradês: fundos inteiros em degradê viram cor sólida (diferença grande e esperada);
   * só uma página quase toda diferente (ex.: em branco) indica problema.
   */
  shadings: 0.95,
} as const;
