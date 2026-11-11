import { useState } from 'preact/hooks';
import { Dropzone } from '../components/dropzone';
import { FileList } from '../components/file-list';
import { Icon } from '../components/icon';
import { acceptAttribute, describeKinds } from '../tools/accept-file';
import { processorFor } from '../tools/processors';
import type { ToolDefinition } from '../tools/registry';
import { MAX_QUEUE_SIZE, useFileQueue } from '../tools/use-file-queue';

/** Tela de uma ferramenta: título, opções, área de soltar e lista de arquivos. */
export function ToolPage({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue(tool.accepts);
  const [option, setOption] = useState(tool.options?.[0]?.id ?? '');

  return (
    <section class="tool" aria-labelledby="tool-title">
      <header class="tool__header">
        <h1 id="tool-title">{tool.name}</h1>
        <p class="tool__description">{tool.description}</p>
      </header>

      {tool.availableInStage !== null && (
        <p class="notice" role="note">
          <Icon name="info" size={18} />
          Em construção. Por enquanto o app só confere se os arquivos servem para esta ferramenta.
        </p>
      )}

      {tool.options && (
        <fieldset class="choices">
          <legend class="visually-hidden">Tipo de operação</legend>
          {tool.options.map((choice) => (
            <label key={choice.id} class="choice">
              <input
                type="radio"
                name={`${tool.id}-opcao`}
                value={choice.id}
                checked={option === choice.id}
                onChange={() => {
                  setOption(choice.id);
                }}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Dropzone
        label={tool.dropLabel}
        acceptsText={describeKinds(tool.accepts)}
        accept={acceptAttribute(tool.accepts)}
        onFiles={(files) => {
          queue.add(files, processorFor(tool.id, option));
        }}
      />

      {queue.overflow > 0 && (
        <p class="notice notice--warning" role="alert">
          <Icon name="alert" size={18} />
          {queue.overflow === 1
            ? `1 arquivo ficou de fora: a lista aceita até ${MAX_QUEUE_SIZE} arquivos.`
            : `${queue.overflow} arquivos ficaram de fora: a lista aceita até ${MAX_QUEUE_SIZE} arquivos.`}
        </p>
      )}

      <FileList items={queue.items} onRemove={queue.remove} onPassword={queue.submitPassword} />
    </section>
  );
}
