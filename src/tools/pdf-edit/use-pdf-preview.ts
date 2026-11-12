import { useEffect, useState } from 'preact/hooks';
import type { TaskProgress } from '../../lib/run-worker-task';
import { toAppError, type AppError } from '../../lib/shared/errors';
import { inspectFile, renderPdf } from '../../lib/tasks';
import { assertAccepted } from '../accept-file';

export interface PreviewPage {
  readonly number: number;
  readonly widthPt: number;
  readonly heightPt: number;
  /** URL temporária da imagem (liberada quando a prévia muda ou some). */
  readonly url: string;
}

export type PdfPreview =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly progress: TaskProgress }
  | { readonly status: 'needs-password'; readonly error?: AppError }
  | { readonly status: 'ready'; readonly pageCount: number; readonly pages: readonly PreviewPage[] }
  | { readonly status: 'error'; readonly error: AppError };

export interface PreviewRequest {
  readonly file: File | null;
  readonly password: string | undefined;
  /** Páginas (1 = primeira); `null` = todas. */
  readonly pages: readonly number[] | null;
  /** Largura máxima das imagens, em pixels. */
  readonly widthPx: number;
}

/**
 * Renderiza páginas do PDF num worker (o arquivo do cliente nunca é aberto na página).
 * Confere o tipo pelo conteúdo antes. Trocar o pedido cancela a renderização anterior.
 */
export function usePdfPreview({ file, password, pages, widthPx }: PreviewRequest): PdfPreview {
  const [state, setState] = useState<PdfPreview>({ status: 'idle' });
  const pagesKey = pages === null ? 'todas' : pages.join(',');

  useEffect(() => {
    if (file === null) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const urls: string[] = [];
    setState({ status: 'loading', progress: { fraction: null, label: 'Conferindo o arquivo' } });

    void (async () => {
      try {
        assertAccepted(['pdf'], await inspectFile(file, { signal }));
        const output = await renderPdf(
          {
            file,
            ...(password === undefined ? {} : { password }),
            pages,
            scale: { kind: 'width', px: widthPx },
            format: 'jpeg',
            quality: 0.85,
          },
          {
            signal,
            onProgress: (progress) => {
              if (!signal.aborted) setState({ status: 'loading', progress });
            },
          },
        );
        if (signal.aborted) return;
        const rendered = output.pages.map((page) => {
          const url = page.image ? URL.createObjectURL(page.image) : '';
          if (url) urls.push(url);
          return { number: page.number, widthPt: page.widthPt, heightPt: page.heightPt, url };
        });
        setState({ status: 'ready', pageCount: output.pageCount, pages: rendered });
      } catch (caught) {
        if (signal.aborted) return;
        const error = toAppError(caught);
        if (error.code === 'password-required') setState({ status: 'needs-password' });
        else if (error.code === 'wrong-password') setState({ status: 'needs-password', error });
        else setState({ status: 'error', error });
      }
    })();

    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // `pagesKey` representa `pages`: um array novo a cada render não deve refazer a prévia.
  }, [file, password, pagesKey, widthPx]);

  return state;
}
