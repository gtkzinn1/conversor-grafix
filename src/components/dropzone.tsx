import { useRef, useState } from 'preact/hooks';
import { Icon } from './icon';

interface DropzoneProps {
  /** Texto principal, ex.: "Solte os PDFs aqui". */
  readonly label: string;
  /** Tipos aceitos em texto, ex.: "PDF" ou "PNG, JPEG ou WebP". */
  readonly acceptsText: string;
  /** Filtro da janela de escolha de arquivos (ex.: ".pdf"). */
  readonly accept: string;
  readonly onFiles: (files: File[]) => void;
}

/** Arquivos soltos, sem pastas (pastas chegam como "arquivos" de 0 bytes). */
function droppedFiles(transfer: DataTransfer): File[] {
  const files: File[] = [];
  const items = Array.from(transfer.items);
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return items.length > 0 ? files : Array.from(transfer.files);
}

export function Dropzone({ label, acceptsText, accept, onFiles }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;

  return (
    <div
      class={dragging ? 'dropzone dropzone--active' : 'dropzone'}
      data-testid="dropzone"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (event.dataTransfer) {
          const files = droppedFiles(event.dataTransfer);
          if (files.length > 0) onFiles(files);
        }
      }}
    >
      <span class="dropzone__icon">
        <Icon name="upload" size={28} />
      </span>
      <p class="dropzone__label">{label}</p>
      <p class="dropzone__hint">
        ou{' '}
        <button
          type="button"
          class="link-button"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          escolha no computador
        </button>{' '}
        · {acceptsText}
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        hidden
        data-testid="file-input"
        onChange={(event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);
          input.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}
