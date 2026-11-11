import { describe, expect, it } from 'vitest';
import { AppError, isSerializedError, toAppError } from '../../src/lib/shared/errors';

describe('AppError', () => {
  it('usa mensagem padrão em português', () => {
    expect(new AppError('cancelled').message).toBe('Operação cancelada.');
  });

  it('serializa e reconstrói (fronteira página ↔ worker)', () => {
    const original = new AppError('timeout', 'Demorou.', 'detalhe');
    const copy = AppError.fromJSON(structuredClone(original.toJSON()));
    expect(copy).toBeInstanceOf(AppError);
    expect(copy.code).toBe('timeout');
    expect(copy.message).toBe('Demorou.');
    expect(copy.detail).toBe('detalhe');
  });

  it('converte erros desconhecidos sem perder o detalhe', () => {
    const converted = toAppError(new TypeError('x is undefined'));
    expect(converted.code).toBe('unexpected');
    expect(converted.message).toBe('Ocorreu um erro inesperado.');
    expect(converted.detail).toContain('x is undefined');
    expect(toAppError('texto').detail).toBe('texto');
  });

  it('valida erros serializados recebidos', () => {
    expect(isSerializedError({ code: 'timeout', message: 'a' })).toBe(true);
    expect(isSerializedError({ code: 'inventado', message: 'a' })).toBe(false);
    expect(isSerializedError({ code: 'timeout', message: 1 })).toBe(false);
    expect(isSerializedError({ code: 'toString', message: 'a' })).toBe(false);
    expect(isSerializedError(null)).toBe(false);
  });
});
