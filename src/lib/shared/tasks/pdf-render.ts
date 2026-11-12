/** Contrato da tarefa "renderizar páginas de PDF" (miniaturas, prévia do corte, PDF → imagem). */

export type RenderScale =
  /** Largura máxima em pixels (miniaturas e prévia). */
  | { readonly kind: 'width'; readonly px: number }
  /** Resolução de saída (PDF → imagem). */
  | { readonly kind: 'dpi'; readonly dpi: number };

export type ImageFormat = 'png' | 'jpeg';

export interface PdfRenderInput {
  readonly file: Blob;
  readonly password?: string;
  /** Páginas a renderizar (1 = primeira); `null` = todas. */
  readonly pages: readonly number[] | null;
  readonly scale: RenderScale;
  readonly format: ImageFormat;
  /** Qualidade do JPEG, entre 0 e 1. */
  readonly quality?: number;
  /** Quando presente (e houver mais de uma página), as imagens vão num ZIP, com este nome base. */
  readonly archiveBaseName?: string;
}

export interface RenderedPage {
  readonly number: number;
  /** Tamanho da página como aparece (já girada), em pontos. */
  readonly widthPt: number;
  readonly heightPt: number;
  /** Imagem da página (ausente quando as imagens vão no ZIP). */
  readonly image?: Blob;
}

export interface PdfRenderOutput {
  readonly pageCount: number;
  readonly pages: readonly RenderedPage[];
  readonly archive?: Blob;
}

/** Limites de entrada: DPI e largura razoáveis, lista de páginas finita. */
export const RENDER_LIMITS = { minDpi: 36, maxDpi: 1200, maxWidthPx: 4000 } as const;

function isScale(value: unknown): value is RenderScale {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'width') {
    const px = record['px'];
    return typeof px === 'number' && px >= 16 && px <= RENDER_LIMITS.maxWidthPx;
  }
  if (record['kind'] === 'dpi') {
    const dpi = record['dpi'];
    return typeof dpi === 'number' && dpi >= RENDER_LIMITS.minDpi && dpi <= RENDER_LIMITS.maxDpi;
  }
  return false;
}

export function isPdfRenderInput(value: unknown): value is PdfRenderInput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const pages = record['pages'];
  const quality = record['quality'];
  return (
    record['file'] instanceof Blob &&
    (record['password'] === undefined || typeof record['password'] === 'string') &&
    (pages === null ||
      (Array.isArray(pages) &&
        pages.every((page) => Number.isSafeInteger(page) && (page as number) >= 1))) &&
    isScale(record['scale']) &&
    (record['format'] === 'png' || record['format'] === 'jpeg') &&
    (quality === undefined || (typeof quality === 'number' && quality > 0 && quality <= 1)) &&
    (record['archiveBaseName'] === undefined || typeof record['archiveBaseName'] === 'string')
  );
}

export function isPdfRenderOutput(value: unknown): value is PdfRenderOutput {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const pages = record['pages'];
  return (
    typeof record['pageCount'] === 'number' &&
    (record['archive'] === undefined || record['archive'] instanceof Blob) &&
    Array.isArray(pages) &&
    pages.every((page: unknown) => {
      if (typeof page !== 'object' || page === null) return false;
      const p = page as Record<string, unknown>;
      return (
        typeof p['number'] === 'number' &&
        typeof p['widthPt'] === 'number' &&
        typeof p['heightPt'] === 'number' &&
        (p['image'] === undefined || p['image'] instanceof Blob)
      );
    })
  );
}
