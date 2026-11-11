/**
 * Erros do app com mensagem em português para o usuário e detalhe técnico separado.
 * Este módulo roda tanto na página quanto nos workers (não usa DOM).
 */

export type ErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'worker-crashed'
  | 'empty-file'
  | 'unsupported-type'
  | 'file-too-large'
  | 'too-many-megapixels'
  | 'too-many-pages'
  | 'unexpected';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  cancelled: 'Operação cancelada.',
  timeout: 'O processamento demorou demais e foi interrompido.',
  'worker-crashed':
    'O processamento parou inesperadamente. O arquivo pode ser grande demais para a memória disponível.',
  'empty-file': 'O arquivo está vazio.',
  'unsupported-type': 'Tipo de arquivo não suportado por esta ferramenta.',
  'file-too-large': 'O arquivo é maior que o limite permitido.',
  'too-many-megapixels': 'A imagem tem resolução maior que o limite permitido.',
  'too-many-pages': 'O PDF tem mais páginas que o limite permitido.',
  unexpected: 'Ocorreu um erro inesperado.',
};

/** Forma serializável de um erro, usada para atravessar a fronteira página ↔ worker. */
export interface SerializedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly detail?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Detalhe técnico, mostrado ao usuário apenas numa área recolhível. */
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }

  toJSON(): SerializedError {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }

  static fromJSON(data: SerializedError): AppError {
    return new AppError(data.code, data.message, data.detail);
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(DEFAULT_MESSAGES, value);
}

/** Converte qualquer valor lançado em AppError, preservando o detalhe técnico. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    const detail = error.stack ?? `${error.name}: ${error.message}`;
    return new AppError('unexpected', undefined, detail);
  }
  return new AppError('unexpected', undefined, String(error));
}

/** Valida dados recebidos de um worker antes de confiar neles. */
export function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isErrorCode(record['code']) &&
    typeof record['message'] === 'string' &&
    (record['detail'] === undefined || typeof record['detail'] === 'string')
  );
}
