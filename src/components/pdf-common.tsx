import { useState } from 'preact/hooks';
import type { AppError } from '../lib/shared/errors';
import type { PdfPreview } from '../tools/pdf-edit/use-pdf-preview';
import { Dropzone } from './dropzone';
import { Icon } from './icon';

/** Peças comuns das telas de PDF que trabalham com um arquivo só (extrair, girar, cortar). */

export interface Feedback {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

export function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (feedback === null) return null;
  return (
    <p
      class={feedback.kind === 'ok' ? 'notice' : 'notice notice--warning'}
      role={feedback.kind === 'ok' ? 'status' : 'alert'}
    >
      <Icon name={feedback.kind === 'ok' ? 'check' : 'alert'} size={18} />
      {feedback.text}
    </p>
  );
}

/** Área de soltar (sem arquivo) ou barra com o nome do arquivo e "Trocar arquivo". */
export function SinglePdfPicker({
  file,
  pageCount,
  onFile,
}: {
  file: File | null;
  pageCount: number | undefined;
  onFile: (file: File | null) => void;
}) {
  if (file === null) {
    return (
      <Dropzone
        label="Solte o PDF aqui"
        acceptsText="PDF"
        accept=".pdf,application/pdf"
        onFiles={(files) => {
          onFile(files[0] ?? null);
        }}
      />
    );
  }
  return (
    <div class="pdf-file-bar">
      <Icon name="files" size={18} />
      <span class="pdf-file-bar__name" title={file.name}>
        {file.name}
      </span>
      {pageCount !== undefined && (
        <span class="pdf-file-bar__meta">
          {pageCount === 1 ? '1 página' : `${String(pageCount)} páginas`}
        </span>
      )}
      <button
        type="button"
        class="button"
        onClick={() => {
          onFile(null);
        }}
      >
        Trocar arquivo
      </button>
    </div>
  );
}

function PasswordPrompt({
  error,
  onPassword,
}: {
  error: AppError | undefined;
  onPassword: (password: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      class="password-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== '') onPassword(value);
      }}
    >
      <span class={error ? 'file-row__error' : undefined}>
        {error ? error.message : 'Este PDF tem senha de abertura.'}
      </span>
      <label>
        <span class="visually-hidden">Senha do PDF</span>
        <input
          type="password"
          autocomplete="off"
          placeholder="Senha"
          value={value}
          onInput={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </label>
      <button type="submit" class="button">
        Abrir
      </button>
    </form>
  );
}

/** Andamento, senha ou erro da prévia; nada quando pronta ou sem arquivo. */
export function PreviewStatus({
  preview,
  onPassword,
}: {
  preview: PdfPreview;
  onPassword: (password: string) => void;
}) {
  switch (preview.status) {
    case 'loading':
      return (
        <p class="notice" aria-live="polite">
          {preview.progress.label ?? 'Carregando'}…
        </p>
      );
    case 'needs-password':
      return <PasswordPrompt error={preview.error} onPassword={onPassword} />;
    case 'error':
      return <FeedbackLine feedback={{ kind: 'error', text: preview.error.message }} />;
    default:
      return null;
  }
}

/** "páginas 1, 3 e 5" / "página 2". */
export function describePages(pages: readonly number[]): string {
  const sorted = [...pages].sort((a, b) => a - b).map(String);
  if (sorted.length <= 1) return `página ${sorted[0] ?? ''}`;
  const shown =
    sorted.length > 8 ? [...sorted.slice(0, 7), `mais ${String(sorted.length - 7)}`] : sorted;
  return `páginas ${shown.slice(0, -1).join(', ')} e ${shown.at(-1) ?? ''}`;
}
