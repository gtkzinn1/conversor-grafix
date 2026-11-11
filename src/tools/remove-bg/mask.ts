/**
 * Contas de imagem do "Remover fundo". Sem DOM: roda no worker e nos testes.
 *
 * - `toInputTensor`: pixels na resolução do modelo → tensor normalizado (ImageNet).
 * - `logitsToMask` / `upscaleMask`: saída do modelo → máscara 0–255 na resolução original.
 * - `refineForeground`: estima a cor real da borda (equivalente ao `refine_foreground` do
 *   BiRefNet, "blur fusion" em duas passadas) para não sobrar halo do fundo antigo.
 */

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** RGBA (size × size) → Float32 [1, 3, size, size], normalizado como no treino do BiRefNet. */
export function toInputTensor(rgba: Uint8ClampedArray, size: number): Float32Array {
  const plane = size * size;
  if (rgba.length !== plane * 4) throw new RangeError('Tamanho de pixels inesperado.');
  const tensor = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      tensor[c * plane + i] = ((rgba[i * 4 + c] ?? 0) / 255 - MEAN[c]!) / STD[c]!;
    }
  }
  return tensor;
}

/** Logits do modelo → máscara 0–255 (sigmoide). */
export function logitsToMask(logits: Float32Array): Uint8Array {
  const mask = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const value = 1 / (1 + Math.exp(-(logits[i] ?? 0)));
    mask[i] = Math.round(value * 255);
  }
  return mask;
}

/** Amostra bilinear (centro de pixel alinhado) de um plano `sw × sh` para `dw × dh`. */
function resample<T extends Uint8Array | Float32Array>(
  source: ArrayLike<number>,
  sw: number,
  sh: number,
  target: T,
  dw: number,
  dh: number,
): T {
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const top = (source[y0 * sw + x0] ?? 0) * (1 - wx) + (source[y0 * sw + x1] ?? 0) * wx;
      const bottom = (source[y1 * sw + x0] ?? 0) * (1 - wx) + (source[y1 * sw + x1] ?? 0) * wx;
      target[y * dw + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return target;
}

/** Máscara do modelo (`size × size`) → resolução original (`width × height`). */
export function upscaleMask(mask: Uint8Array, size: number, width: number, height: number) {
  return resample(mask, size, size, new Uint8Array(width * height), width, height);
}

/**
 * Média móvel (caixa `k × k`, como o `cv2.blur`) de um plano, no próprio lugar.
 * Perto das bordas divide pelos pixels que existem (sem repetir borda).
 */
export function boxBlur(plane: Float32Array, width: number, height: number, k: number): void {
  const before = Math.floor(k / 2);
  const after = k - 1 - before;
  const line = new Float32Array(Math.max(width, height));
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, after); x++) {
      sum += plane[row + x] ?? 0;
      count++;
    }
    for (let x = 0; x < width; x++) {
      line[x] = sum / count;
      const enter = x + after + 1;
      const leave = x - before;
      if (enter < width) {
        sum += plane[row + enter] ?? 0;
        count++;
      }
      if (leave >= 0) {
        sum -= plane[row + leave] ?? 0;
        count--;
      }
    }
    plane.set(line.subarray(0, width), row);
  }
  // Vertical.
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, after); y++) {
      sum += plane[y * width + x] ?? 0;
      count++;
    }
    for (let y = 0; y < height; y++) {
      line[y] = sum / count;
      const enter = y + after + 1;
      const leave = y - before;
      if (enter < height) {
        sum += plane[enter * width + x] ?? 0;
        count++;
      }
      if (leave >= 0) {
        sum -= plane[leave * width + x] ?? 0;
        count--;
      }
    }
    for (let y = 0; y < height; y++) plane[y * width + x] = line[y] ?? 0;
  }
}

const EPS = 1e-5;
/** Tamanhos das caixas das duas passadas, como no BiRefNet (`r=90`, depois `r=6`). */
const COARSE_KERNEL = 90;
const FINE_KERNEL = 6;
/** A passada larga roda numa versão reduzida: com caixa de 90 px, o resultado é praticamente igual. */
const COARSE_SCALE = 8;
/** Altura das faixas da passada fina (limita a memória com imagens grandes). */
const BAND_ROWS = 256;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Passada larga, na imagem reduzida: devolve, por canal, o primeiro plano borrado (`bF`)
 * e o fundo borrado (`bB`), cada um com `cw × ch` pixels.
 */
function coarsePass(rgba: Uint8ClampedArray, alpha: Uint8Array, width: number, height: number) {
  const cw = Math.max(1, Math.ceil(width / COARSE_SCALE));
  const ch = Math.max(1, Math.ceil(height / COARSE_SCALE));
  const k = Math.max(1, Math.round(COARSE_KERNEL / COARSE_SCALE));
  const small = cw * ch;

  // Médias por bloco de a, I·a e I·(1−a).
  const sumA = new Float32Array(small);
  const sumFA = [new Float32Array(small), new Float32Array(small), new Float32Array(small)];
  const sumBA = [new Float32Array(small), new Float32Array(small), new Float32Array(small)];
  const count = new Float32Array(small);
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / COARSE_SCALE) * cw;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ci = cy + Math.floor(x / COARSE_SCALE);
      const a = (alpha[i] ?? 0) / 255;
      sumA[ci]! += a;
      count[ci]! += 1;
      for (let c = 0; c < 3; c++) {
        const value = (rgba[i * 4 + c] ?? 0) / 255;
        sumFA[c]![ci]! += value * a;
        sumBA[c]![ci]! += value * (1 - a);
      }
    }
  }
  for (let i = 0; i < small; i++) {
    const n = count[i] ?? 1;
    sumA[i]! /= n;
    for (let c = 0; c < 3; c++) {
      sumFA[c]![i]! /= n;
      sumBA[c]![i]! /= n;
    }
  }

  boxBlur(sumA, cw, ch, k);
  for (let c = 0; c < 3; c++) {
    const fa = sumFA[c]!;
    const ba = sumBA[c]!;
    boxBlur(fa, cw, ch, k);
    boxBlur(ba, cw, ch, k);
    for (let i = 0; i < small; i++) {
      const blurredA = sumA[i] ?? 0;
      fa[i] = (fa[i] ?? 0) / (blurredA + EPS);
      ba[i] = (ba[i] ?? 0) / (1 - blurredA + EPS);
    }
  }
  return { cw, ch, blurredF: sumFA, blurredB: sumBA };
}

/**
 * Corrige as cores da borda e aplica a máscara: `rgba` recebe a cor estimada do primeiro plano
 * e o alfa da máscara (multiplicado pelo alfa original, se a imagem já tinha transparência).
 * `bandRows` só existe para os testes conferirem que o resultado não depende das faixas.
 */
export function refineForeground(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  width: number,
  height: number,
  bandRows = BAND_ROWS,
): void {
  if (rgba.length !== width * height * 4 || alpha.length !== width * height) {
    throw new RangeError('Tamanho de pixels inesperado.');
  }
  const coarse = coarsePass(rgba, alpha, width, height);
  const upF = [0, 1, 2].map(() => new Float32Array(width));
  const upB = [0, 1, 2].map(() => new Float32Array(width));
  const rowF = [0, 1, 2].map(() => new Float32Array(coarse.cw));
  const rowB = [0, 1, 2].map(() => new Float32Array(coarse.cw));

  /** Interpola uma linha da passada larga para a largura original. */
  const upsampleRow = (y: number) => {
    const fy = Math.min(coarse.ch - 1, Math.max(0, (y + 0.5) / COARSE_SCALE - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(coarse.ch - 1, y0 + 1);
    const wy = fy - y0;
    for (let c = 0; c < 3; c++) {
      const f = coarse.blurredF[c]!;
      const b = coarse.blurredB[c]!;
      const lineF = rowF[c]!;
      const lineB = rowB[c]!;
      for (let x = 0; x < coarse.cw; x++) {
        lineF[x] = (f[y0 * coarse.cw + x] ?? 0) * (1 - wy) + (f[y1 * coarse.cw + x] ?? 0) * wy;
        lineB[x] = (b[y0 * coarse.cw + x] ?? 0) * (1 - wy) + (b[y1 * coarse.cw + x] ?? 0) * wy;
      }
      resample(lineF, coarse.cw, 1, upF[c]!, width, 1);
      resample(lineB, coarse.cw, 1, upB[c]!, width, 1);
    }
  };

  // Passada fina em faixas, com margem para a caixa de 6 px não depender das faixas vizinhas.
  const halo = Math.floor(FINE_KERNEL / 2);
  // Linhas originais logo acima da faixa atual (a faixa anterior já as reescreveu em `rgba`).
  const carry = new Uint8ClampedArray(halo * width * 4);
  let carryStart = 0;
  for (let y0 = 0; y0 < height; y0 += bandRows) {
    const y1 = Math.min(height, y0 + bandRows);
    const top = Math.max(0, y0 - halo);
    const bottom = Math.min(height, y1 + halo);
    const rows = bottom - top;
    const size = rows * width;
    const planeA = new Float32Array(size);
    const planeFA = [new Float32Array(size), new Float32Array(size), new Float32Array(size)];
    const planeBA = [new Float32Array(size), new Float32Array(size), new Float32Array(size)];

    for (let y = top; y < bottom; y++) {
      upsampleRow(y);
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const j = (y - top) * width + x;
        const a = (alpha[i] ?? 0) / 255;
        planeA[j] = a;
        for (let c = 0; c < 3; c++) {
          const original = y < y0 ? carry[((y - carryStart) * width + x) * 4 + c] : rgba[i * 4 + c];
          const image = (original ?? 0) / 255;
          const bF = upF[c]![x] ?? 0;
          const bB = upB[c]![x] ?? 0;
          // Primeira estimativa do primeiro plano (fim da passada larga).
          const f1 = clamp01(bF + a * (image - a * bF - (1 - a) * bB));
          planeFA[c]![j] = f1 * a;
          planeBA[c]![j] = bB * (1 - a);
        }
      }
    }

    boxBlur(planeA, width, rows, FINE_KERNEL);
    for (let c = 0; c < 3; c++) {
      boxBlur(planeFA[c]!, width, rows, FINE_KERNEL);
      boxBlur(planeBA[c]!, width, rows, FINE_KERNEL);
    }

    carryStart = Math.max(y0, y1 - halo);
    carry.set(rgba.subarray(carryStart * width * 4, y1 * width * 4));

    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const j = (y - top) * width + x;
        const a = (alpha[i] ?? 0) / 255;
        const blurredA = planeA[j] ?? 0;
        for (let c = 0; c < 3; c++) {
          const image = (rgba[i * 4 + c] ?? 0) / 255;
          const bF = (planeFA[c]![j] ?? 0) / (blurredA + EPS);
          const bB = (planeBA[c]![j] ?? 0) / (1 - blurredA + EPS);
          rgba[i * 4 + c] = Math.round(clamp01(bF + a * (image - a * bF - (1 - a) * bB)) * 255);
        }
        rgba[i * 4 + 3] = Math.round(((rgba[i * 4 + 3] ?? 255) * (alpha[i] ?? 0)) / 255);
      }
    }
  }
}
