/**
 * Ajuste do grafo ONNX para placas de vídeo com poucos buffers por shader.
 *
 * O BiRefNet divide a imagem em blocos: tem nós `Split` com 16 e 32 saídas e `Concat` com até
 * 1024 entradas. No WebGPU cada entrada/saída ocupa um buffer, e muitas placas aceitam só 16
 * por shader (`maxStorageBuffersPerShaderStage`). Aqui esses nós viram uma árvore de nós menores,
 * com o mesmo resultado. O ajuste é feito na memória, depois de conferido o SHA-256 do arquivo.
 *
 * Só lê e escreve o mínimo de protobuf necessário (ModelProto → GraphProto → NodeProto).
 * Campos não tocados são copiados byte a byte.
 */

// Números de campo do onnx.proto.
const MODEL_GRAPH = 7;
const GRAPH_NODE = 1;
const GRAPH_INITIALIZER = 5;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const NODE_NAME = 3;
const NODE_OP_TYPE = 4;
const NODE_ATTRIBUTE = 5;
const NODE_DOMAIN = 7;
const ATTRIBUTE_NAME = 1;
const ATTRIBUTE_TENSOR = 5;
const TENSOR_DIMS = 1;
const TENSOR_DATA_TYPE = 2;
const TENSOR_INT64_DATA = 7;
const TENSOR_NAME = 8;
const TENSOR_RAW_DATA = 9;
const INT64 = 7;

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

interface Field {
  readonly number: number;
  readonly wire: number;
  /** Byte inicial do campo inteiro (chave incluída) e final. */
  readonly start: number;
  readonly end: number;
  /** Para campos de tamanho variável: início e fim do conteúdo. */
  readonly valueStart: number;
  /** Valor de varint (só para `WIRE_VARINT`). */
  readonly varint: number;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readVarint(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let scale = 1;
  let position = offset;
  for (;;) {
    if (position >= bytes.length) throw new Error('Protobuf truncado.');
    const byte = bytes[position++] ?? 0;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, position];
    scale *= 128;
    if (scale > 2 ** 63) throw new Error('Varint longo demais.');
  }
}

function* fields(bytes: Uint8Array, start: number, end: number): Generator<Field> {
  let position = start;
  while (position < end) {
    const fieldStart = position;
    const [key, afterKey] = readVarint(bytes, position);
    const number = Math.floor(key / 8);
    const wire = key % 8;
    let valueStart = afterKey;
    let varint = 0;
    switch (wire) {
      case WIRE_VARINT:
        [varint, position] = readVarint(bytes, afterKey);
        break;
      case WIRE_64BIT:
        position = afterKey + 8;
        break;
      case WIRE_32BIT:
        position = afterKey + 4;
        break;
      case WIRE_LENGTH: {
        const [length, afterLength] = readVarint(bytes, afterKey);
        valueStart = afterLength;
        position = afterLength + length;
        break;
      }
      default:
        throw new Error(`Tipo de campo protobuf não suportado: ${String(wire)}`);
    }
    if (position > end) throw new Error('Protobuf truncado.');
    yield { number, wire, start: fieldStart, end: position, valueStart, varint };
  }
}

const text = (bytes: Uint8Array, field: Field) =>
  decoder.decode(bytes.subarray(field.valueStart, field.end));

// ---------- Escrita ----------

function varintBytes(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 128) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function lengthField(number: number, content: Uint8Array): Uint8Array {
  const header = [...varintBytes(number * 8 + WIRE_LENGTH), ...varintBytes(content.length)];
  const out = new Uint8Array(header.length + content.length);
  out.set(header);
  out.set(content, header.length);
  return out;
}

function varintField(number: number, value: number): Uint8Array {
  return Uint8Array.from([...varintBytes(number * 8 + WIRE_VARINT), ...varintBytes(value)]);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const stringField = (number: number, value: string) => lengthField(number, encoder.encode(value));

function nodeBytes(
  op: string,
  name: string,
  inputs: readonly string[],
  outputs: readonly string[],
  attributes: readonly Uint8Array[],
): Uint8Array {
  return lengthField(
    GRAPH_NODE,
    concatBytes([
      ...inputs.map((input) => stringField(NODE_INPUT, input)),
      ...outputs.map((output) => stringField(NODE_OUTPUT, output)),
      stringField(NODE_NAME, name),
      stringField(NODE_OP_TYPE, op),
      ...attributes,
    ]),
  );
}

function int64TensorBytes(name: string, values: readonly number[]): Uint8Array {
  const raw = new Uint8Array(values.length * 8);
  const view = new DataView(raw.buffer);
  values.forEach((value, index) => {
    view.setBigInt64(index * 8, BigInt(value), true);
  });
  return lengthField(
    GRAPH_INITIALIZER,
    concatBytes([
      varintField(TENSOR_DIMS, values.length),
      varintField(TENSOR_DATA_TYPE, INT64),
      stringField(TENSOR_NAME, name),
      lengthField(TENSOR_RAW_DATA, raw),
    ]),
  );
}

// ---------- Leitura de nós e tensores ----------

interface NodeInfo {
  readonly field: Field;
  readonly op: string;
  readonly name: string;
  readonly domain: string;
  readonly inputs: string[];
  readonly outputs: string[];
  /** Atributos copiados como estão (ex.: `axis`). */
  readonly attributes: Uint8Array[];
  /** Tensor do atributo `value` (nós `Constant`). */
  readonly valueTensor?: Field;
}

function readNode(bytes: Uint8Array, field: Field): NodeInfo {
  const inputs: string[] = [];
  const outputs: string[] = [];
  const attributes: Uint8Array[] = [];
  let op = '';
  let name = '';
  let domain = '';
  let valueTensor: Field | undefined;
  for (const inner of fields(bytes, field.valueStart, field.end)) {
    if (inner.number === NODE_INPUT) inputs.push(text(bytes, inner));
    else if (inner.number === NODE_OUTPUT) outputs.push(text(bytes, inner));
    else if (inner.number === NODE_NAME) name = text(bytes, inner);
    else if (inner.number === NODE_OP_TYPE) op = text(bytes, inner);
    else if (inner.number === NODE_DOMAIN) domain = text(bytes, inner);
    else if (inner.number === NODE_ATTRIBUTE) {
      attributes.push(bytes.subarray(inner.start, inner.end));
      let attributeName = '';
      let tensor: Field | undefined;
      for (const part of fields(bytes, inner.valueStart, inner.end)) {
        if (part.number === ATTRIBUTE_NAME) attributeName = text(bytes, part);
        else if (part.number === ATTRIBUTE_TENSOR) tensor = part;
      }
      if (attributeName === 'value' && tensor) valueTensor = tensor;
    }
  }
  return valueTensor
    ? { field, op, name, domain, inputs, outputs, attributes, valueTensor }
    : { field, op, name, domain, inputs, outputs, attributes };
}

/** Valores de um tensor int64 pequeno (os tamanhos de um `Split`). */
function readInt64Tensor(bytes: Uint8Array, tensor: Field): { name: string; values: number[] } {
  let name = '';
  let dataType = 0;
  const values: number[] = [];
  for (const part of fields(bytes, tensor.valueStart, tensor.end)) {
    if (part.number === TENSOR_NAME) name = text(bytes, part);
    else if (part.number === TENSOR_DATA_TYPE) dataType = part.varint;
    else if (part.number === TENSOR_RAW_DATA) {
      const raw = bytes.subarray(part.valueStart, part.end);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let offset = 0; offset + 8 <= raw.length; offset += 8) {
        values.push(Number(view.getBigInt64(offset, true)));
      }
    } else if (part.number === TENSOR_INT64_DATA) {
      if (part.wire === WIRE_LENGTH) {
        let position = part.valueStart;
        while (position < part.end) {
          const [value, next] = readVarint(bytes, position);
          values.push(value);
          position = next;
        }
      } else values.push(part.varint);
    }
  }
  return { name, values: dataType === INT64 ? values : [] };
}

/** Divide uma lista em grupos de no máximo `size` itens, mantendo a ordem. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export interface PatchResult {
  readonly model: Uint8Array;
  readonly splitsPatched: number;
  readonly concatsPatched: number;
}

/**
 * Reescreve `Split` e `Concat` que passam de `maxBuffers` buffers (entradas + saídas).
 * Se nada precisar mudar, devolve o próprio buffer recebido.
 */
export function limitNodeBuffers(model: Uint8Array, maxBuffers: number): PatchResult {
  const maxParts = maxBuffers - 1;
  if (maxParts < 2) throw new RangeError('Limite de buffers baixo demais.');

  const graph = [...fields(model, 0, model.length)].find(
    (field) => field.number === MODEL_GRAPH && field.wire === WIRE_LENGTH,
  );
  if (!graph) throw new Error('Modelo ONNX sem grafo.');
  const graphFields = [...fields(model, graph.valueStart, graph.end)];

  // Tamanhos de Split vêm de inicializadores ou de nós Constant.
  const int64Values = new Map<string, number[]>();
  const nodes = new Map<Field, NodeInfo>();
  for (const field of graphFields) {
    if (field.number === GRAPH_INITIALIZER && field.wire === WIRE_LENGTH) {
      const tensor = readInt64Tensor(model, field);
      if (tensor.values.length > 0) int64Values.set(tensor.name, tensor.values);
    } else if (field.number === GRAPH_NODE && field.wire === WIRE_LENGTH) {
      const node = readNode(model, field);
      nodes.set(field, node);
      const output = node.outputs[0];
      if (node.op === 'Constant' && node.valueTensor && output !== undefined) {
        const tensor = readInt64Tensor(model, node.valueTensor);
        if (tensor.values.length > 0) int64Values.set(output, tensor.values);
      }
    }
  }

  let splitsPatched = 0;
  let concatsPatched = 0;
  const newInitializers: Uint8Array[] = [];
  const graphParts: Uint8Array[] = [];

  const replaceSplit = (node: NodeInfo): Uint8Array[] | null => {
    const [data, splitName] = node.inputs;
    const sizes = splitName === undefined ? undefined : int64Values.get(splitName);
    if (data === undefined || sizes?.length !== node.outputs.length) return null;
    const out: Uint8Array[] = [];
    let counter = 0;
    // Cada nível agrupa as saídas em até `maxParts` pedaços.
    const emit = (input: string, outputs: string[], parts: number[]) => {
      const level = counter++;
      if (outputs.length <= maxParts) {
        const sizeName = `${node.name}__tamanhos${String(level)}`;
        newInitializers.push(int64TensorBytes(sizeName, parts));
        out.push(
          nodeBytes(
            'Split',
            `${node.name}__parte${String(level)}`,
            [input, sizeName],
            outputs,
            node.attributes,
          ),
        );
        return;
      }
      const groupSize = Math.ceil(outputs.length / maxParts);
      const outputGroups = chunk(outputs, groupSize);
      const sizeGroups = chunk(parts, groupSize);
      const groupNames = outputGroups.map(
        (_, index) => `${node.name}__grupo${String(level)}_${String(index)}`,
      );
      emit(
        input,
        groupNames,
        sizeGroups.map((group) => group.reduce((sum, size) => sum + size, 0)),
      );
      outputGroups.forEach((group, index) => {
        emit(groupNames[index] ?? '', group, sizeGroups[index] ?? []);
      });
    };
    emit(data, node.outputs, sizes);
    return out;
  };

  const replaceConcat = (node: NodeInfo): Uint8Array[] => {
    const out: Uint8Array[] = [];
    let counter = 0;
    const reduce = (inputs: string[], output: string) => {
      const level = counter++;
      if (inputs.length <= maxParts) {
        out.push(
          nodeBytes(
            'Concat',
            `${node.name}__parte${String(level)}`,
            inputs,
            [output],
            node.attributes,
          ),
        );
        return;
      }
      const groups = chunk(inputs, Math.ceil(inputs.length / maxParts));
      const names = groups.map(
        (_, index) => `${node.name}__grupo${String(level)}_${String(index)}`,
      );
      groups.forEach((group, index) => {
        reduce(group, names[index] ?? '');
      });
      reduce(names, output);
    };
    reduce(node.inputs, node.outputs[0] ?? '');
    return out;
  };

  for (const field of graphFields) {
    const node = nodes.get(field);
    const tooMany = node?.domain === '' && node.inputs.length + node.outputs.length > maxBuffers;
    if (node && tooMany && node.op === 'Split' && node.outputs.length > maxParts) {
      const replacement = replaceSplit(node);
      if (replacement) {
        graphParts.push(...replacement);
        splitsPatched++;
        continue;
      }
    } else if (node && tooMany && node.op === 'Concat' && node.outputs.length === 1) {
      graphParts.push(...replaceConcat(node));
      concatsPatched++;
      continue;
    }
    graphParts.push(model.subarray(field.start, field.end));
  }

  if (splitsPatched === 0 && concatsPatched === 0) {
    return { model, splitsPatched, concatsPatched };
  }

  // Monta o modelo novo com uma única cópia (o arquivo pode ter quase 1 GB).
  const graphContent = [...graphParts, ...newInitializers];
  const graphLength = graphContent.reduce((sum, part) => sum + part.length, 0);
  const graphHeader = Uint8Array.from([
    ...varintBytes(MODEL_GRAPH * 8 + WIRE_LENGTH),
    ...varintBytes(graphLength),
  ]);
  const modelParts: Uint8Array[] = [];
  for (const field of fields(model, 0, model.length)) {
    if (field.start === graph.start) modelParts.push(graphHeader, ...graphContent);
    else modelParts.push(model.subarray(field.start, field.end));
  }
  return { model: concatBytes(modelParts), splitsPatched, concatsPatched };
}
