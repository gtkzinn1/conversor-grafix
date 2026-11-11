/**
 * Modelo do JSON v2 do qpdf (qpdf --json-output). Referência:
 * https://qpdf.readthedocs.io/en/stable/json.html
 *
 * Representação dos valores PDF:
 *   dicionário → objeto JS com chaves "/Nome"     nome   → "/Nome"
 *   array      → array JS                          ref    → "12 0 R"
 *   texto      → "u:texto"                         binário → "b:hex"
 *   número, booleano, null → iguais em JS
 */

export type PdfValue = null | boolean | number | string | PdfValue[] | PdfDict;
export interface PdfDict {
  [key: string]: PdfValue;
}

export interface StreamEntry {
  readonly stream: { dict: PdfDict; data?: string; datafile?: string };
}
export interface ValueEntry {
  readonly value: PdfValue;
}
export type ObjectEntry = StreamEntry | ValueEntry;

export interface QpdfJsonHeader {
  readonly jsonversion: number;
  readonly pdfversion: string;
  readonly maxobjectid: number;
  readonly [key: string]: unknown;
}

export interface QpdfJson {
  readonly qpdf: readonly [QpdfJsonHeader, Readonly<Record<string, ObjectEntry>>];
}

const REF = /^(\d+) (\d+) R$/;

export const isRef = (value: PdfValue | undefined): value is string =>
  typeof value === 'string' && REF.test(value);

export const isDict = (value: PdfValue | undefined): value is PdfDict =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isStream = (entry: ObjectEntry | undefined): entry is StreamEntry =>
  entry !== undefined && 'stream' in entry;

/** "12 0 R" → "obj:12 0 R" (chave do objeto no JSON). */
export const keyOf = (ref: string) => `obj:${ref}`;

export function isQpdfJson(value: unknown): value is QpdfJson {
  if (typeof value !== 'object' || value === null) return false;
  const qpdf = (value as Record<string, unknown>)['qpdf'];
  if (!Array.isArray(qpdf) || qpdf.length !== 2) return false;
  const [header, objects] = qpdf as unknown[];
  return (
    typeof header === 'object' &&
    header !== null &&
    (header as Record<string, unknown>)['jsonversion'] === 2 &&
    typeof objects === 'object' &&
    objects !== null &&
    'trailer' in objects
  );
}

/**
 * Documento PDF em JSON com edição "copy-on-write": as alterações ficam em `changes`
 * e viram o JSON de atualização (--update-from-json) só com os objetos modificados.
 */
export class PdfJsonDocument {
  readonly header: QpdfJsonHeader;
  private readonly original: Readonly<Record<string, ObjectEntry>>;
  private readonly changed = new Map<string, ObjectEntry>();

  constructor(json: QpdfJson) {
    [this.header, this.original] = json.qpdf;
  }

  /** Chaves dos objetos ("obj:N G R"), sem o trailer. */
  keys(): string[] {
    return Object.keys(this.original).filter((key) => key.startsWith('obj:'));
  }

  entry(key: string): ObjectEntry | undefined {
    return this.changed.get(key) ?? this.original[key];
  }

  /** Dicionário do objeto (o próprio valor, ou o dicionário do stream). */
  dict(key: string): PdfDict | undefined {
    const entry = this.entry(key);
    if (entry === undefined) return undefined;
    if (isStream(entry)) return entry.stream.dict;
    return isDict(entry.value) ? entry.value : undefined;
  }

  /** Segue uma referência; valores diretos são devolvidos como estão. */
  resolve(value: PdfValue | undefined): PdfValue | undefined {
    if (!isRef(value)) return value;
    const entry = this.entry(keyOf(value));
    if (entry === undefined) return undefined;
    return isStream(entry) ? entry.stream.dict : entry.value;
  }

  get trailer(): PdfDict {
    const trailer = (this.original['trailer'] as ValueEntry | undefined)?.value;
    if (!isDict(trailer)) throw new Error('JSON do qpdf sem trailer.');
    return trailer;
  }

  get rootKey(): string {
    const root = this.trailer['/Root'];
    if (!isRef(root)) throw new Error('PDF sem catálogo (/Root).');
    return keyOf(root);
  }

  /** Edita o objeto numa cópia; `edit` recebe o dicionário (ou o valor) editável. */
  edit(key: string, edit: (target: PdfDict) => void): void {
    const current = this.entry(key);
    if (current === undefined) throw new Error(`Objeto inexistente: ${key}`);
    const copy = structuredClone<ObjectEntry>(current);
    const target = isStream(copy) ? copy.stream.dict : copy.value;
    if (!isDict(target)) throw new Error(`Objeto não é dicionário: ${key}`);
    edit(target);
    this.changed.set(key, copy);
  }

  /** Substitui o valor de um objeto não-stream (ex.: um array de anotações). */
  replaceValue(key: string, value: PdfValue): void {
    this.changed.set(key, { value });
  }

  /** Substitui os dados (e opcionalmente o dicionário) de um stream. */
  replaceStream(key: string, dataBase64: string, dict?: PdfDict): void {
    const current = this.entry(key);
    if (!isStream(current)) throw new Error(`Objeto não é stream: ${key}`);
    const nextDict = structuredClone(dict ?? current.stream.dict);
    // O qpdf recalcula /Length; filtros antigos não valem para os dados novos (sem compressão).
    delete nextDict['/Length'];
    delete nextDict['/Filter'];
    delete nextDict['/DecodeParms'];
    this.changed.set(key, { stream: { dict: nextDict, data: dataBase64 } });
  }

  get changeCount(): number {
    return this.changed.size;
  }

  /** JSON para `qpdf --update-from-json`, só com os objetos alterados. */
  toUpdateJson(): string {
    const objects: Record<string, ObjectEntry> = {};
    for (const [key, entry] of this.changed) objects[key] = entry;
    return JSON.stringify({ qpdf: [this.header, objects] });
  }
}
