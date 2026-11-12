import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../../src/lib/shared/zip';

describe('zip', () => {
  it('calcula o CRC-32 padrão', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('grava cabeçalhos locais, diretório central e fim', () => {
    const data = new TextEncoder().encode('olá');
    const zip = createZip([
      { name: 'página 1.txt', data },
      { name: 'b.txt', data: new Uint8Array() },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(view.getUint32(centralStart + 16, true)).toBe(crc32(data));
  });
});
