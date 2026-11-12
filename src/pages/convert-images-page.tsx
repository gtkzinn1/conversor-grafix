import { useState } from 'preact/hooks';
import { Dropzone } from '../components/dropzone';
import { FileList } from '../components/file-list';
import { Icon } from '../components/icon';
import { ImagesPdfList } from '../components/images-pdf-list';
import { Segmented } from '../components/segmented';
import {
  RESIZE_LIMITS,
  type ConvertSettings,
  type ImageTarget,
  type ResizeMode,
} from '../lib/shared/tasks/convert-image';
import { acceptAttribute, describeKinds } from '../tools/accept-file';
import { imageConvertProcessor } from '../tools/processors';
import type { ToolDefinition } from '../tools/registry';
import { MAX_QUEUE_SIZE, useFileQueue } from '../tools/use-file-queue';

type SizeKind = ResizeMode['kind'];

interface Form {
  readonly format: ImageTarget;
  readonly quality: number;
  readonly size: SizeKind;
  readonly width: string;
  readonly percent: string;
  readonly widthCm: string;
  readonly dpi: string;
  readonly background: 'white' | 'black';
}

const DEFAULT_FORM: Form = {
  format: 'jpeg',
  quality: 90,
  size: 'original',
  width: '1920',
  percent: '50',
  widthCm: '10',
  dpi: '300',
  background: 'white',
};

const parse = (text: string) => Number.parseFloat(text.replace(',', '.'));

const within = (value: number, [min, max]: readonly [number, number]) =>
  Number.isFinite(value) && value >= min && value <= max;

/** Opções da tela → opções da tarefa, ou a mensagem do que está errado. */
function toSettings(form: Form): ConvertSettings | string {
  let resize: ResizeMode;
  switch (form.size) {
    case 'original':
      resize = { kind: 'original' };
      break;
    case 'width': {
      const width = Math.round(parse(form.width));
      if (!within(width, RESIZE_LIMITS.width)) return 'A largura vai de 1 a 20.000 px.';
      resize = { kind: 'width', width };
      break;
    }
    case 'percent': {
      const percent = parse(form.percent);
      if (!within(percent, RESIZE_LIMITS.percent)) return 'A porcentagem vai de 1 a 1.000%.';
      resize = { kind: 'percent', percent };
      break;
    }
    case 'print': {
      const widthCm = parse(form.widthCm);
      const dpi = Math.round(parse(form.dpi));
      if (!within(widthCm, RESIZE_LIMITS.widthCm)) return 'A largura vai de 0,1 a 500 cm.';
      if (!within(dpi, RESIZE_LIMITS.dpi)) return 'A resolução vai de 10 a 2.400 DPI.';
      resize = { kind: 'print', widthCm, dpi };
      break;
    }
  }
  return { format: form.format, quality: form.quality, resize, background: form.background };
}

function NumberField({
  label,
  unit,
  value,
  onInput,
}: {
  label: string;
  unit: string;
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <label class="number-field">
      <span class="choices__legend">{label}</span>
      <span class="number-field__row">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${label} em ${unit}`}
          value={value}
          onInput={(event) => {
            onInput(event.currentTarget.value);
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

/** Converter: formato, qualidade e tamanho; um resultado por arquivo. */
function ConvertView({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue(tool.accepts);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<Form>) => {
    setError(null);
    setForm({ ...form, ...change });
  };

  return (
    <>
      <div class="settings">
        <Segmented
          legend="Formato"
          name="converter-formato"
          value={form.format}
          options={[
            ['keep', 'Manter'],
            ['jpeg', 'JPG'],
            ['png', 'PNG'],
            ['webp', 'WebP'],
          ]}
          onChange={(format) => {
            set({ format });
          }}
        />
        {form.format !== 'png' && (
          <label class="range-field">
            <span class="choices__legend">Qualidade (JPG e WebP)</span>
            <span class="range-field__row">
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={form.quality}
                onInput={(event) => {
                  set({ quality: Number(event.currentTarget.value) });
                }}
              />
              <output>{`${String(form.quality)}%`}</output>
            </span>
          </label>
        )}
        {form.format === 'jpeg' && (
          <Segmented
            legend="Fundo do transparente"
            name="converter-fundo"
            value={form.background}
            options={[
              ['white', 'Branco'],
              ['black', 'Preto'],
            ]}
            onChange={(background) => {
              set({ background });
            }}
          />
        )}
      </div>

      <div class="settings">
        <Segmented
          legend="Tamanho"
          name="converter-tamanho"
          value={form.size}
          options={[
            ['original', 'Original'],
            ['width', 'Largura (px)'],
            ['percent', 'Porcentagem'],
            ['print', 'cm + DPI'],
          ]}
          onChange={(size) => {
            set({ size });
          }}
        />
        {form.size === 'width' && (
          <NumberField
            label="Largura"
            unit="px"
            value={form.width}
            onInput={(width) => {
              set({ width });
            }}
          />
        )}
        {form.size === 'percent' && (
          <NumberField
            label="Escala"
            unit="%"
            value={form.percent}
            onInput={(percent) => {
              set({ percent });
            }}
          />
        )}
        {form.size === 'print' && (
          <>
            <NumberField
              label="Largura"
              unit="cm"
              value={form.widthCm}
              onInput={(widthCm) => {
                set({ widthCm });
              }}
            />
            <NumberField
              label="Resolução"
              unit="DPI"
              value={form.dpi}
              onInput={(dpi) => {
                set({ dpi });
              }}
            />
          </>
        )}
      </div>
      {form.size !== 'original' && (
        <p class="settings__hint">A altura acompanha a largura (a proporção é mantida).</p>
      )}

      <Dropzone
        label={tool.dropLabel}
        acceptsText={describeKinds(tool.accepts)}
        accept={acceptAttribute(tool.accepts)}
        onFiles={(files) => {
          const settings = toSettings(form);
          if (typeof settings === 'string') {
            setError(settings);
            return;
          }
          queue.add(files, imageConvertProcessor(settings));
        }}
      />

      {error !== null && (
        <p class="notice notice--warning" role="alert">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}

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

/** Converter imagens: "Converter" (formato e tamanho) e "Imagens para PDF". */
export function ConvertImagesPage({ tool }: { tool: ToolDefinition }) {
  const [option, setOption] = useState(tool.options?.[0]?.id ?? 'converter');

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
              name="converter-imagens-opcao"
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

      {option === 'para-pdf' ? <ImagesPdfList /> : <ConvertView tool={tool} />}
    </section>
  );
}
