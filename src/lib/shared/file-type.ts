/**
 * Detecção do tipo de arquivo pelo CONTEÚDO (assinatura), nunca pela extensão.
 */

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'psd' | 'psb';

/** Quantos bytes do início do arquivo são necessários para detectar o tipo. */
export const SIGNATURE_BYTES = 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const PDF_HEADER = ascii('%PDF-');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const PSD = ascii('8BPS');

/** Procura o cabeçalho do PDF. A especificação tolera bytes antes dele, dentro do 1º KiB. */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SIGNATURE_BYTES) - PDF_HEADER.length;
  for (let offset = 0; offset <= limit; offset++) {
    if (startsWith(bytes, PDF_HEADER, offset)) return true;
  }
  return false;
}

/**
 * Identifica o tipo a partir dos primeiros bytes do arquivo.
 * Retorna `null` quando o tipo não é reconhecido.
 */
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp';
  if (startsWith(bytes, PSD)) {
    if (startsWith(bytes, [0x00, 0x01], 4)) return 'psd';
    if (startsWith(bytes, [0x00, 0x02], 4)) return 'psb';
    return null;
  }
  if (hasPdfHeader(bytes)) return 'pdf';
  return null;
}

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  pdf: 'PDF',
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  psd: 'PSD',
  psb: 'PSB',
};
