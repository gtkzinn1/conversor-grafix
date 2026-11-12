/**
 * Gerador de ZIP mínimo (sem compressão, método "store"), para entregar vários arquivos num
 * download só. PDFs e imagens já vêm comprimidos; comprimir de novo quase não reduz.
 * Roda na página e nos workers (não usa DOM).
 */

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Limite do formato ZIP clássico (sem ZIP64). */
const MAX_ZIP_BYTES = 0xffff_ffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Data e hora no formato do MS-DOS usado pelo ZIP. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Monta o ZIP. Nomes em UTF-8 (bit 11), aceitos pelo Explorador do Windows. */
export function createZip(entries: readonly ZipEntry[], modified = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modified);
  const names = entries.map((entry) => encoder.encode(entry.name));
  const localSize = entries.reduce(
    (sum, entry, i) => sum + 30 + (names[i]?.length ?? 0) + entry.data.length,
    0,
  );
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > MAX_ZIP_BYTES || entries.length > 0xffff) {
    throw new RangeError('Conteúdo grande demais para um ZIP.');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const crcs = entries.map((entry) => crc32(entry.data));
  let at = 0;

  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array();
    offsets.push(at);
    view.setUint32(at, 0x0403_4b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 0x0800, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, stamp.time, true);
    view.setUint16(at + 12, stamp.date, true);
    view.setUint32(at + 14, crcs[i] ?? 0, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(entry.data, at + 30 + name.length);
    at += 30 + name.length + entry.data.length;
  });

  const centralStart = at;
  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array();
    view.setUint32(at, 0x0201_4b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, crcs[i] ?? 0, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, name.length, true);
    // Campos extras, comentário, disco, atributos internos e externos: zero.
    view.setUint32(at + 42, offsets[i] ?? 0, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, 0x0605_4b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
