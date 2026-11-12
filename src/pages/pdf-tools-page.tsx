import { useState } from 'preact/hooks';
import { Dropzone } from '../components/dropzone';
import { FileList } from '../components/file-list';
import { Icon } from '../components/icon';
import { PdfCropEditor } from '../components/pdf-crop-editor';
import { PdfMergeList } from '../components/pdf-merge-list';
import { PdfPagesEditor } from '../components/pdf-pages-editor';
import { pdfBatchProcessor, type PdfBatchSettings } from '../tools/processors';
import type { ToolDefinition } from '../tools/registry';
import { MAX_QUEUE_SIZE, useFileQueue } from '../tools/use-file-queue';

type BatchOption = 'separar' | 'comprimir' | 'para-imagem';

const DEFAULT_SETTINGS: PdfBatchSettings = {
  compressMode: 'images',
  jpegQuality: 75,
  imageFormat: 'png',
  dpi: 300,
};

/** Grupo de opções em botões (mesmo visual da escolha de operação). */
function Segmented<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="choices choices--small">
      <legend class="choices__legend">{legend}</legend>
      {options.map(([id, label]) => (
        <label key={String(id)} class="choice">
          <input
            type="radio"
            name={name}
            checked={value === id}
            onChange={() => {
              onChange(id);
            }}
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Separar, comprimir e PDF para imagem: vários arquivos, um resultado por arquivo. */
function BatchView({ option, tool }: { option: BatchOption; tool: ToolDefinition }) {
  const queue = useFileQueue(tool.accepts);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const set = (change: Partial<PdfBatchSettings>) => {
    setSettings({ ...settings, ...change });
  };

  return (
    <>
      {option === 'comprimir' && (
        <div class="settings">
          <Segmented
            legend="Como comprimir"
            name="comprimir-modo"
            value={settings.compressMode}
            options={[
              ['images', 'Reduzir imagens (JPEG)'],
              ['lossless', 'Sem perda de qualidade'],
            ]}
            onChange={(compressMode) => {
              set({ compressMode });
            }}
          />
          {settings.compressMode === 'images' && (
            <Segmented
              legend="Qualidade das imagens"
              name="comprimir-qualidade"
              value={settings.jpegQuality}
              options={[
                [85, 'Alta'],
                [75, 'Média'],
                [55, 'Baixa'],
              ]}
              onChange={(jpegQuality) => {
                set({ jpegQuality });
              }}
            />
          )}
        </div>
      )}

      {option === 'para-imagem' && (
        <div class="settings">
          <Segmented
            legend="Formato"
            name="imagem-formato"
            value={settings.imageFormat}
            options={[
              ['png', 'PNG'],
              ['jpeg', 'JPG'],
            ]}
            onChange={(imageFormat) => {
              set({ imageFormat });
            }}
          />
          <Segmented
            legend="Resolução"
            name="imagem-dpi"
            value={settings.dpi}
            options={[
              [150, '150 DPI'],
              [300, '300 DPI'],
              [600, '600 DPI'],
            ]}
            onChange={(dpi) => {
              set({ dpi });
            }}
          />
        </div>
      )}

      <Dropzone
        label={tool.dropLabel}
        acceptsText="PDF"
        accept=".pdf,application/pdf"
        onFiles={(files) => {
          queue.add(files, pdfBatchProcessor(option, settings));
        }}
      />

      {queue.overflow > 0 && (
        <p class="notice notice--warning" role="alert">
          <Icon name="alert" size={18} />
          {`${String(queue.overflow)} arquivo(s) ficaram de fora: a lista aceita até ${String(MAX_QUEUE_SIZE)} arquivos.`}
        </p>
      )}

      <FileList items={queue.items} onRemove={queue.remove} onPassword={queue.submitPassword} />
    </>
  );
}

/** Editar PDF: as sete operações, cada uma com a interface que pede. */
export function PdfToolsPage({ tool }: { tool: ToolDefinition }) {
  const [option, setOption] = useState(tool.options?.[0]?.id ?? 'juntar');

  return (
    <section class="tool" aria-labelledby="tool-title">
      <header class="tool__header">
        <h1 id="tool-title">{tool.name}</h1>
        <p class="tool__description">{tool.description}</p>
      </header>

      <fieldset class="choices">
        <legend class="visually-hidden">Operação</legend>
        {tool.options?.map((choice) => (
          <label key={choice.id} class="choice">
            <input
              type="radio"
              name="editar-pdf-opcao"
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

      {option === 'juntar' && <PdfMergeList />}
      {(option === 'extrair' || option === 'girar') && (
        <PdfPagesEditor key={option} mode={option} />
      )}
      {option === 'cortar' && <PdfCropEditor />}
      {(option === 'separar' || option === 'comprimir' || option === 'para-imagem') && (
        <BatchView key={option} option={option} tool={tool} />
      )}
    </section>
  );
}
