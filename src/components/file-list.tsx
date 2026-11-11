import { useState } from 'preact/hooks';
import { downloadBlob } from '../lib/download';
import { FILE_KIND_LABELS } from '../lib/shared/file-type';
import { formatBytes } from '../lib/shared/limits';
import type { QueueItem } from '../tools/use-file-queue';
import { Icon, type IconName } from './icon';

interface FileListProps {
  readonly items: readonly QueueItem[];
  readonly onRemove: (id: string) => void;
  readonly onPassword: (id: string, password: string) => void;
}

const STATUS_ICON: Record<QueueItem['status'], IconName> = {
  checking: 'files',
  ready: 'check',
  processing: 'files',
  'needs-password': 'lock',
  done: 'check',
  rejected: 'alert',
};

function PasswordForm({
  item,
  onPassword,
}: {
  item: QueueItem;
  onPassword: FileListProps['onPassword'];
}) {
  const [password, setPassword] = useState('');
  return (
    <form
      class="password-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== '') onPassword(item.id, password);
      }}
    >
      <label>
        <span class="visually-hidden">Senha de {item.file.name}</span>
        <input
          type="password"
          autocomplete="off"
          placeholder="Senha de abertura"
          value={password}
          onInput={(event) => {
            setPassword(event.currentTarget.value);
          }}
        />
      </label>
      <button type="submit" class="button">
        Abrir
      </button>
    </form>
  );
}

function Status({
  item,
  onPassword,
}: {
  item: QueueItem;
  onPassword: FileListProps['onPassword'];
}) {
  switch (item.status) {
    case 'checking':
      return <span class="file-row__meta">Conferindo…</span>;
    case 'ready':
      return (
        <span class="file-row__meta">
          {FILE_KIND_LABELS[item.kind]} · {formatBytes(item.file.size)}
        </span>
      );
    case 'processing': {
      const { fraction, label } = item.progress;
      return (
        <span class="file-row__meta">
          {label ?? 'Processando'}…
          <progress
            class="file-row__progress"
            max={1}
            value={fraction ?? undefined}
            aria-label={`Progresso de ${item.file.name}`}
          />
        </span>
      );
    }
    case 'needs-password':
      return (
        <span class="file-row__meta">
          <span class={item.error ? 'file-row__error' : undefined}>
            {item.error?.message ?? 'Este PDF tem senha de abertura.'}
          </span>
          <PasswordForm item={item} onPassword={onPassword} />
        </span>
      );
    case 'done':
      return (
        <span class="file-row__meta">
          {item.result.summary.join(' · ')}
          {item.result.warnings.map((warning) => (
            <span key={warning} class="file-row__warning">
              {warning}
            </span>
          ))}
        </span>
      );
    case 'rejected':
      return (
        <span class="file-row__meta file-row__error">
          {item.error.message}
          {item.error.detail !== undefined && (
            <details class="file-row__detail">
              <summary>Detalhes técnicos</summary>
              {item.error.detail}
            </details>
          )}
        </span>
      );
  }
}

export function FileList({ items, onRemove, onPassword }: FileListProps) {
  if (items.length === 0) return null;
  return (
    <ul class="file-list" aria-label="Arquivos">
      {items.map((item) => (
        <li key={item.id} class={`file-row file-row--${item.status}`} data-testid="file-row">
          <span class="file-row__icon">
            <Icon name={STATUS_ICON[item.status]} size={18} />
          </span>
          <span class="file-row__body" aria-live="polite">
            <span class="file-row__name" title={item.file.name}>
              {item.status === 'done' ? item.result.fileName : item.file.name}
            </span>
            <Status item={item} onPassword={onPassword} />
          </span>
          <span class="file-row__actions">
            {item.status === 'done' && (
              <button
                type="button"
                class="button button--primary"
                onClick={() => {
                  downloadBlob(item.result.blob, item.result.fileName);
                }}
              >
                <Icon name="download" size={18} />
                Baixar
              </button>
            )}
            <button
              type="button"
              class="icon-button"
              aria-label={`Remover ${item.file.name}`}
              title={item.status === 'processing' ? 'Cancelar e remover' : 'Remover da lista'}
              onClick={() => {
                onRemove(item.id);
              }}
            >
              <Icon name="x" size={18} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
