import { FILE_KIND_LABELS } from '../lib/shared/file-type';
import { formatBytes } from '../lib/shared/limits';
import type { QueueItem } from '../tools/use-file-queue';
import { Icon } from './icon';

interface FileListProps {
  readonly items: readonly QueueItem[];
  readonly onRemove: (id: string) => void;
}

function Status({ item }: { item: QueueItem }) {
  switch (item.status) {
    case 'checking':
      return <span class="file-row__meta">Conferindo…</span>;
    case 'ready':
      return (
        <span class="file-row__meta">
          {FILE_KIND_LABELS[item.kind]} · {formatBytes(item.file.size)}
        </span>
      );
    case 'rejected':
      return (
        <span class="file-row__meta file-row__meta--error">
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

const STATUS_ICON = { checking: 'files', ready: 'check', rejected: 'alert' } as const;

export function FileList({ items, onRemove }: FileListProps) {
  if (items.length === 0) return null;
  return (
    <ul class="file-list" aria-label="Arquivos" aria-live="polite">
      {items.map((item) => (
        <li key={item.id} class={`file-row file-row--${item.status}`} data-testid="file-row">
          <span class="file-row__icon">
            <Icon name={STATUS_ICON[item.status]} size={18} />
          </span>
          <span class="file-row__body">
            <span class="file-row__name" title={item.file.name}>
              {item.file.name}
            </span>
            <Status item={item} />
          </span>
          <button
            type="button"
            class="icon-button"
            aria-label={`Remover ${item.file.name}`}
            title="Remover da lista"
            onClick={() => {
              onRemove(item.id);
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}
