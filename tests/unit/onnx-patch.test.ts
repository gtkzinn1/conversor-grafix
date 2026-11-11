import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { limitNodeBuffers } from '../../src/tools/remove-bg/onnx-patch';

// Montagem mínima de um modelo ONNX (protobuf) para o teste.
const encoder = new TextEncoder();
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 128) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}
const bytes = (...parts: (number[] | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const len = (field: number, content: Uint8Array) =>
  bytes(varint(field * 8 + 2), varint(content.length), content);
const num = (field: number, value: number) => bytes(varint(field * 8), varint(value));
const str = (field: number, value: string) => len(field, encoder.encode(value));

/** ValueInfo float [1, width]. */
const valueInfo = (name: string, width: number) =>
  bytes(
    str(1, name),
    len(2, len(1, bytes(num(1, 1), len(2, bytes(len(1, num(1, 1)), len(1, num(1, width))))))),
  );

const attributeInt = (name: string, value: number) =>
  len(5, bytes(str(1, name), num(3, value), num(20, 2)));

function node(
  op: string,
  name: string,
  inputs: string[],
  outputs: string[],
  extra: Uint8Array[] = [],
) {
  return len(
    1,
    bytes(
      ...inputs.map((i) => str(1, i)),
      ...outputs.map((o) => str(2, o)),
      str(3, name),
      str(4, op),
      ...extra,
    ),
  );
}

function int64Initializer(name: string, values: number[]) {
  const raw = new Uint8Array(values.length * 8);
  const view = new DataView(raw.buffer);
  values.forEach((value, index) => {
    view.setBigInt64(index * 8, BigInt(value), true);
  });
  return len(5, bytes(num(1, values.length), num(2, 7), str(8, name), len(9, raw)));
}

/** X [1, 40] → Split (20 partes, a 1ª com 21 colunas) → Concat em ordem invertida → Y. */
function buildModel() {
  const parts = 20;
  const sizes = [21, ...Array.from({ length: parts - 1 }, () => 1)];
  const outputs = sizes.map((_, index) => `p${String(index)}`);
  const graph = bytes(
    node('Split', 'divide', ['X', 'tamanhos'], outputs, [attributeInt('axis', 1)]),
    node('Concat', 'junta', [...outputs].reverse(), ['Y'], [attributeInt('axis', 1)]),
    str(2, 'teste'),
    int64Initializer('tamanhos', sizes),
    len(11, valueInfo('X', 40)),
    len(12, valueInfo('Y', 40)),
  );
  return bytes(num(1, 8), len(8, bytes(str(1, ''), num(2, 17))), len(7, graph));
}

async function run(model: Uint8Array) {
  const session = await ort.InferenceSession.create(model);
  const input = Float32Array.from({ length: 40 }, (_, index) => index);
  const result = await session.run({ X: new ort.Tensor('float32', input, [1, 40]) });
  await session.release();
  return Array.from(result['Y']?.data as Float32Array);
}

describe('limitNodeBuffers', () => {
  it('quebra Split e Concat grandes sem mudar o resultado', async () => {
    const original = buildModel();
    const patched = limitNodeBuffers(original, 4);
    expect(patched.splitsPatched).toBe(1);
    expect(patched.concatsPatched).toBe(1);
    expect(await run(patched.model)).toEqual(await run(original));
  });

  it('não mexe no modelo quando os nós cabem no limite', () => {
    const original = buildModel();
    const result = limitNodeBuffers(original, 64);
    expect(result.model).toBe(original);
    expect(result.splitsPatched + result.concatsPatched).toBe(0);
  });

  it('recusa limite baixo demais', () => {
    expect(() => limitNodeBuffers(buildModel(), 2)).toThrow(RangeError);
  });
});
