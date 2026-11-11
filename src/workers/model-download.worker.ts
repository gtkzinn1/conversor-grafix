import {
  isModelDownloadInput,
  type ModelDownloadInput,
  type ModelDownloadOutput,
} from '../lib/shared/tasks/remove-bg';
import { AppError } from '../lib/shared/errors';
import { downloadModel } from '../tools/remove-bg/model-cache';
import { findModel } from '../tools/remove-bg/models';
import { defineWorkerTask } from './runtime';

/** Baixa o modelo de IA, confere o SHA-256 e guarda no cache (fora da página, sem travar a tela). */
defineWorkerTask<ModelDownloadInput, ModelDownloadOutput>(
  isModelDownloadInput,
  async (input, context) => {
    const model = findModel(input.modelId);
    if (!model)
      throw new AppError('unexpected', undefined, `Modelo desconhecido: ${input.modelId}`);
    context.progress(0, 'Baixando o modelo de IA');
    await downloadModel(model, (fraction) => {
      // A conferência do SHA-256 vem depois; o download fica com 98% da barra.
      context.progress(fraction * 0.98, 'Baixando o modelo de IA');
    });
    context.progress(1, 'Modelo pronto');
    return { output: { saved: true } };
  },
);
