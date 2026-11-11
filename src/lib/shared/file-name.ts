/**
 * Nomes de arquivo de saída seguros para o Windows.
 * Nunca confiar no nome recebido: ele vem do arquivo do cliente.
 */

/** Tamanho máximo do nome final (em caracteres), deixando folga para a pasta no Windows. */
export const MAX_FILE_NAME_LENGTH = 180;
const FALLBACK_BASE_NAME = 'arquivo';

// Caracteres proibidos no Windows: \ / : * ? " < > |
const WINDOWS_FORBIDDEN = /[\\/:*?"<>|]/g;
// Caracteres de controle (C0, DEL e C1).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
// Controles de direção de texto: permitem disfarçar a extensão ("fotogpj.exe" → "fotoexe.jpg").
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// Nomes reservados do Windows (com ou sem extensão).
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Remove caracteres proibidos, de controle e de direção de texto, sem mexer em espaços. */
function removeUnsafeChars(value: string): string {
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_CONTROLS, '')
    .replace(WINDOWS_FORBIDDEN, '');
}

/** Remove o que não pode existir num nome de arquivo do Windows. Pode devolver string vazia. */
export function sanitizeFileNamePart(value: string): string {
  return removeUnsafeChars(value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/** Nome do arquivo sem a última extensão ("a.b.pdf" → "a.b"; ".pdf" → ".pdf"). */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Corta por pontos de código (não quebra emojis/acentos combinados ao meio). */
function truncateCodePoints(value: string, maxLength: number): string {
  const codePoints = Array.from(value);
  return codePoints.length <= maxLength ? value : codePoints.slice(0, maxLength).join('');
}

export interface OutputNameOptions {
  /** Texto adicionado ao nome, ex.: " (corel)". */
  readonly suffix?: string;
  /** Extensão sem ponto, ex.: "pdf". */
  readonly extension: string;
}

/**
 * Deriva o nome do arquivo de saída a partir do original.
 * Ex.: deriveOutputName('logo.pdf', { suffix: ' (corel)', extension: 'pdf' }) → 'logo (corel).pdf'
 */
export function deriveOutputName(originalName: string, options: OutputNameOptions): string {
  // A extensão vem do código do app: validar como veio, sem "consertar" (erro de programação).
  const extension = options.extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) {
    throw new Error(`Extensão de saída inválida: "${options.extension}"`);
  }
  // O sufixo é do próprio app (ex.: " (corel)"); mantém o espaço inicial, mas passa pelo mesmo filtro.
  const suffix = removeUnsafeChars(options.suffix ?? '').replace(/\s+/g, ' ');

  // Nome sem caminho: alguns sistemas mandam "C:\pasta\arquivo.pdf".
  const withoutPath = originalName.split(/[\\/]/).pop() ?? '';
  let base = sanitizeFileNamePart(stripExtension(withoutPath));
  if (base === '') base = FALLBACK_BASE_NAME;

  const reservedLength = Array.from(suffix).length + extension.length + 1;
  base = truncateCodePoints(base, MAX_FILE_NAME_LENGTH - reservedLength).replace(/[. ]+$/, '');
  if (base === '') base = FALLBACK_BASE_NAME;
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;

  return `${base}${suffix}.${extension}`;
}
