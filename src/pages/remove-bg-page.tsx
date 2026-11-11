import { useState } from 'preact/hooks';
import { BgEditor } from '../components/bg-editor';
import { Dropzone } from '../components/dropzone';
import { FileList } from '../components/file-list';
import { Icon } from '../components/icon';
import { downloadBlob } from '../lib/download';
import { formatBytes } from '../lib/shared/limits';
import { acceptAttribute, describeKinds } from '../tools/accept-file';
import { processorFor } from '../tools/processors';
import type { ToolDefinition } from '../tools/registry';
import { useAiModel, type AiModel } from '../tools/remove-bg/use-ai-model';
import { MAX_QUEUE_SIZE, useFileQueue } from '../tools/use-file-queue';

/** Confirmação do primeiro download do modelo (seção 6.4). */
function ModelCard({ ai }: { ai: AiModel }) {
  const { state } = ai;
  if (state.status === 'detecting') {
    return <p class="notice">Verificando este computador…</p>;
  }
  if (state.status === 'ready') return null;
  const size = formatBytes(state.model.bytes);

  if (state.status === 'downloading') {
    const percent = Math.floor(state.fraction * 100);
    return (
      <div class="model-card" aria-live="polite">
        <h2>Baixando o modelo de IA</h2>
        <p class="model-card__text">
          {state.fraction >= 0.98
            ? 'Conferindo o arquivo…'
            : `${String(percent)}% de ${size}. Mantenha esta tela aberta até terminar.`}
        </p>
        <progress class="model-card__progress" max={1} value={state.fraction} />
        <div class="model-card__actions">
          <button type="button" class="button" onClick={ai.cancelDownload}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="model-card">
      <h2>Baixar o modelo de IA</h2>
      <p class="model-card__text">
        Para remover fundos, o app precisa baixar o modelo {state.model.label} ({size}) do Hugging
        Face. É feito uma vez por computador; depois funciona sem internet. Suas imagens não saem do
        computador.
      </p>
      {ai.device?.webGpu === false && (
        <p class="model-card__text">
          Este computador não oferece aceleração pela placa de vídeo (WebGPU) no navegador. O
          recorte roda no processador: mais devagar e com um pouco menos de detalhe na borda.
        </p>
      )}
      {state.error && (
        <p class="file-row__error" role="alert">
          {state.error.message}
        </p>
      )}
      <div class="model-card__actions">
        <button type="button" class="button button--primary" onClick={ai.download}>
          <Icon name="download" size={18} />
          Baixar {size}
        </button>
      </div>
    </div>
  );
}

/** "Remover fundo": modelo de IA, fila de imagens e editor de ajuste (direção A). */
export function RemoveBgPage({ tool }: { tool: ToolDefinition }) {
  const ai = useAiModel();
  const queue = useFileQueue(tool.accepts);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = queue.items.find((item) => item.id === editingId);
  if (editing?.status === 'done') {
    return (
      <BgEditor
        original={editing.file}
        result={editing.result.blob}
        fileName={editing.result.fileName}
        onClose={() => {
          setEditingId(null);
        }}
        onSave={(png, download) => {
          const result = { ...editing.result, blob: png };
          queue.replaceResult(editing.id, result);
          if (download) downloadBlob(png, result.fileName);
          setEditingId(null);
        }}
      />
    );
  }

  const ready = ai.state.status === 'ready' ? ai.state.model : null;

  return (
    <section class="tool" aria-labelledby="tool-title">
      <header class="tool__header">
        <h1 id="tool-title">{tool.name}</h1>
        <p class="tool__description">{tool.description}</p>
      </header>

      <ModelCard ai={ai} />

      {ready && (
        <Dropzone
          label={tool.dropLabel}
          acceptsText={describeKinds(tool.accepts)}
          accept={acceptAttribute(tool.accepts)}
          onFiles={(files) => {
            queue.add(files, processorFor(tool.id, ready.id));
          }}
        />
      )}

      {queue.overflow > 0 && (
        <p class="notice notice--warning" role="alert">
          <Icon name="alert" size={18} />
          {`${String(queue.overflow)} arquivo(s) ficaram de fora: a lista aceita até ${String(MAX_QUEUE_SIZE)} arquivos.`}
        </p>
      )}

      <FileList
        items={queue.items}
        onRemove={queue.remove}
        onPassword={queue.submitPassword}
        onEdit={setEditingId}
      />
    </section>
  );
}
