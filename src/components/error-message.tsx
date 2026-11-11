import type { AppError } from '../lib/shared/errors';

/** Mensagem de erro em português, com o detalhe técnico recolhível. Texto sempre escapado. */
export function ErrorMessage({ error }: { error: AppError }) {
  return (
    <div class="error" role="alert">
      <p>{error.message}</p>
      {error.detail !== undefined && (
        <details>
          <summary>Detalhes técnicos</summary>
          {error.detail}
        </details>
      )}
    </div>
  );
}
