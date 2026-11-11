/** Tempo até liberar a URL do Blob (o download já começou bem antes disso). */
const REVOKE_AFTER_MS = 60_000;

/**
 * Baixa um Blob com o nome informado (já sanitizado por `deriveOutputName`).
 * A URL temporária é sempre liberada depois.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_AFTER_MS);
  }
}
