import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  clearGpuFailed,
  gpuFailed,
  onGpuFailedChange,
  readPreference,
  writePreference,
} from '../../lib/storage';
import { toAppError, type AppError } from '../../lib/shared/errors';
import { downloadAiModel } from '../../lib/tasks';
import { cachedModelIds, deleteCachedModels } from './model-cache';
import { defaultModel, modelsFor, type DeviceSupport, type ModelVariant } from './models';

const PREFERENCE_KEY = 'modelo-ia';

/** WebGPU disponível e, para os modelos fp16, com o recurso `shader-f16`. */
async function detectDevice(): Promise<DeviceSupport> {
  try {
    if (gpuFailed() || !('gpu' in navigator)) return { webGpu: false, shaderF16: false };
    // Com a placa num estado ruim, o pedido pode demorar muito: depois de 10 s, segue sem WebGPU.
    const adapter = await Promise.race([
      navigator.gpu.requestAdapter(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          resolve(null);
        }, 10_000),
      ),
    ]);
    return { webGpu: adapter !== null, shaderF16: adapter?.features.has('shader-f16') ?? false };
  } catch {
    return { webGpu: false, shaderF16: false };
  }
}

export type AiModelState =
  | { readonly status: 'detecting' }
  | { readonly status: 'needs-download'; readonly model: ModelVariant; readonly error?: AppError }
  | { readonly status: 'downloading'; readonly model: ModelVariant; readonly fraction: number }
  | { readonly status: 'ready'; readonly model: ModelVariant };

export interface AiModel {
  readonly state: AiModelState;
  readonly device: DeviceSupport | null;
  /** Modelos que este computador pode usar. */
  readonly choices: readonly ModelVariant[];
  readonly download: () => void;
  readonly cancelDownload: () => void;
  readonly choose: (id: string) => void;
  /** A placa de vídeo travou antes neste computador e foi desligada para o recorte. */
  readonly gpuDisabled: boolean;
  /** Volta a oferecer os modelos de placa de vídeo. */
  readonly enableGpu: () => void;
  /** Apaga os modelos baixados; o próximo uso pede o download de novo. */
  readonly clear: () => Promise<void>;
}

export function useAiModel(): AiModel {
  const [device, setDevice] = useState<DeviceSupport | null>(null);
  const [preferred, setPreferred] = useState(readPreference(PREFERENCE_KEY));
  const [state, setState] = useState<AiModelState>({ status: 'detecting' });
  const [gpuDisabled, setGpuDisabled] = useState(gpuFailed());
  const controller = useRef<AbortController | null>(null);

  const choices = device ? modelsFor(device) : [];
  const model = device
    ? (choices.find((variant) => variant.id === preferred) ?? defaultModel())
    : undefined;

  const refresh = useCallback(async (target: ModelVariant) => {
    const cached = await cachedModelIds([target]).catch(() => new Set<string>());
    setState(
      cached.has(target.id)
        ? { status: 'ready', model: target }
        : { status: 'needs-download', model: target },
    );
  }, []);

  useEffect(() => {
    let active = true;
    const detect = () => {
      setGpuDisabled(gpuFailed());
      void detectDevice().then((found) => {
        if (active) setDevice(found);
      });
    };
    detect();
    // A placa travou num recorte (ou foi religada em "Sobre"): refaz a lista de modelos.
    const stop = onGpuFailedChange(detect);
    return () => {
      active = false;
      stop();
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (model) void refresh(model);
  }, [model, refresh]);

  const download = useCallback(() => {
    if (!model) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: 'downloading', model, fraction: 0 });
    downloadAiModel(
      { modelId: model.id },
      {
        signal: current.signal,
        onProgress: ({ fraction }) => {
          if (!current.signal.aborted) {
            setState({ status: 'downloading', model, fraction: fraction ?? 0 });
          }
        },
      },
    )
      .then(async () => {
        // Pede ao navegador para não apagar o modelo quando faltar espaço.
        await navigator.storage.persist().catch(() => false);
        setState({ status: 'ready', model });
      })
      .catch((caught: unknown) => {
        const error = toAppError(caught);
        setState(
          error.code === 'cancelled'
            ? { status: 'needs-download', model }
            : { status: 'needs-download', model, error },
        );
      });
  }, [model]);

  const cancelDownload = useCallback(() => {
    controller.current?.abort();
  }, []);

  const choose = useCallback((id: string) => {
    writePreference(PREFERENCE_KEY, id);
    setPreferred(id);
  }, []);

  const clear = useCallback(async () => {
    controller.current?.abort();
    await deleteCachedModels();
    if (model) await refresh(model);
  }, [model, refresh]);

  const enableGpu = useCallback(() => {
    clearGpuFailed();
  }, []);

  return {
    state,
    device,
    choices,
    download,
    cancelDownload,
    choose,
    clear,
    gpuDisabled,
    enableGpu,
  };
}
