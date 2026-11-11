import { AppError } from '../../lib/shared/errors';
import { assertPageCount } from '../../lib/shared/limits';
import type { PdfCorelReport } from '../../lib/shared/tasks/pdf-corel';
import { applyBasicFix } from './basic-fix';
import { listPages, samePageGeometry } from './pages';
import type { Qpdf, QpdfRun } from './qpdf';
import { isQpdfJson, isStream, PdfJsonDocument } from './qpdf-json';
import { applyShadingFix, streamsNeededForShadings } from './shading-fix';

/**
 * Sequência completa de "Corrigir PDF para o Corel". Roda no worker (app) e no Node (testes).
 *
 * 1. normaliza com o qpdf (decripta, repara, tira object streams);
 * 2. lê a estrutura em JSON e aplica as correções (básica e, se pedido, degradês);
 * 3. grava em PDF 1.4 com xref clássica;
 * 4. confere o resultado antes de liberar (seção 9.3).
 */

export interface PipelineOptions {
  readonly fixShadings: boolean;
  readonly password?: string;
  readonly progress?: (fraction: number | null, label: string) => void;
}

export interface PipelineResult {
  readonly pdf: Uint8Array;
  readonly report: PdfCorelReport;
}

const IN = '/entrada.pdf';
const NORMALIZED = '/normalizado.pdf';
const STRUCTURE = '/estrutura.json';
const STREAMS = '/streams.json';
const UPDATE = '/atualizacao.json';
const OUT = '/saida.pdf';

/** qpdf: 0 = ok, 3 = ok com avisos, 2 = erro. */
const succeeded = (run: QpdfRun) => run.code === 0 || run.code === 3;

function readJson(qpdf: Qpdf, path: string): PdfJsonDocument {
  const parsed: unknown = JSON.parse(qpdf.readText(path));
  qpdf.remove(path);
  if (!isQpdfJson(parsed)) throw new Error('JSON do qpdf em formato inesperado.');
  return new PdfJsonDocument(parsed);
}

/** Estrutura do PDF em JSON (sem dados de streams). */
function exportStructure(
  qpdf: Qpdf,
  pdfPath: string,
  failure: 'invalid-pdf' | 'validation-failed',
) {
  const run = qpdf.run([pdfPath, '--json-output', '--json-stream-data=none', STRUCTURE]);
  if (!succeeded(run)) throw new AppError(failure, undefined, run.stderr);
  return readJson(qpdf, STRUCTURE);
}

/** Dados decodificados dos streams pedidos (ex.: conteúdo de páginas e funções). */
function exportStreams(
  qpdf: Qpdf,
  pdfPath: string,
  keys: readonly string[],
): Map<string, Uint8Array> {
  const streams = new Map<string, Uint8Array>();
  if (keys.length === 0) return streams;
  const selectors = keys.map((key) => {
    const [id = '', generation = '0'] = key.replace(/^obj:/, '').replace(/ R$/, '').split(' ');
    return `--json-object=${id},${generation}`;
  });
  const run = qpdf.run([
    pdfPath,
    '--json-output',
    '--json-stream-data=inline',
    '--decode-level=generalized',
    '--json-object=trailer',
    ...selectors,
    STREAMS,
  ]);
  if (!succeeded(run)) throw new AppError('invalid-pdf', undefined, run.stderr);
  const doc = readJson(qpdf, STREAMS);
  for (const key of keys) {
    const entry = doc.entry(key);
    // Só usa dados realmente decodificados: se sobrou /Filter, o qpdf não conseguiu decodificar.
    if (!isStream(entry) || entry.stream.data === undefined || '/Filter' in entry.stream.dict)
      continue;
    streams.set(
      key,
      Uint8Array.from(atob(entry.stream.data), (char) => char.charCodeAt(0)),
    );
  }
  return streams;
}

export function fixPdfForCorel(
  qpdf: Qpdf,
  input: Uint8Array,
  options: PipelineOptions,
): PipelineResult {
  const progress = options.progress ?? (() => undefined);
  const password = options.password === undefined ? [] : [`--password=${options.password}`];

  progress(0.1, 'Lendo o PDF');
  qpdf.writeFile(IN, input);

  // --requires-password: 0 = precisa de senha, 2 = sem criptografia, 3 = criptografado sem senha de abertura.
  const encryption = qpdf.run(['--requires-password', IN]);
  const wasEncrypted = encryption.code === 0 || encryption.code === 3;
  if (encryption.code === 0 && options.password === undefined)
    throw new AppError('password-required');

  progress(0.2, 'Reparando a estrutura');
  const normalized = qpdf.run([
    ...password,
    '--decrypt',
    '--object-streams=disable',
    // Imagens embutidas no conteúdo (BI…EI) fazem o CorelDRAW 27 recusar o arquivo
    // (teste da rodada 7, 2026-11-11): viram imagens normais, sem mudar a aparência.
    '--externalize-inline-images',
    '--ii-min-bytes=0',
    IN,
    NORMALIZED,
  ]);
  if (!succeeded(normalized)) {
    if (/invalid password/i.test(normalized.stderr)) throw new AppError('wrong-password');
    throw new AppError('invalid-pdf', undefined, normalized.stderr);
  }
  qpdf.remove(IN);

  progress(0.35, 'Analisando o conteúdo');
  const doc = exportStructure(qpdf, NORMALIZED, 'invalid-pdf');
  const pagesBefore = listPages(doc);
  if (pagesBefore.length === 0) throw new AppError('invalid-pdf', 'Este PDF não tem páginas.');
  assertPageCount(pagesBefore.length);
  const fix = applyBasicFix(doc);

  let shadingsReplaced = 0;
  let warnings: readonly string[] = [];
  if (options.fixShadings) {
    progress(0.5, 'Trocando degradês por cor sólida');
    const streams = exportStreams(qpdf, NORMALIZED, streamsNeededForShadings(doc));
    const shadings = applyShadingFix(doc, streams);
    shadingsReplaced = shadings.replaced;
    warnings = shadings.warnings;
  }

  progress(0.7, 'Gravando o PDF corrigido');
  const writeArgs = ['--object-streams=disable', '--force-version=1.4', '--compress-streams=y'];
  if (doc.changeCount > 0) {
    qpdf.writeFile(UPDATE, doc.toUpdateJson());
    writeArgs.unshift(`--update-from-json=${UPDATE}`);
  }
  const write = qpdf.run([NORMALIZED, ...writeArgs, OUT]);
  if (!succeeded(write)) throw new AppError('invalid-pdf', undefined, write.stderr);
  qpdf.remove(UPDATE);
  qpdf.remove(NORMALIZED);

  progress(0.85, 'Conferindo o resultado');
  const check = qpdf.run(['--check', OUT]);
  if (!succeeded(check))
    throw new AppError('validation-failed', undefined, check.stderr || check.stdout);
  const result = exportStructure(qpdf, OUT, 'validation-failed');
  const pagesAfter = listPages(result);
  if (!samePageGeometry(pagesBefore, pagesAfter)) {
    throw new AppError('validation-failed', undefined, 'Número ou tamanho das páginas mudou.');
  }
  if (result.header.pdfversion !== '1.4') {
    throw new AppError(
      'validation-failed',
      undefined,
      `Versão gravada: ${result.header.pdfversion}`,
    );
  }
  const catalog = result.dict(result.rootKey) ?? {};
  for (const key of ['/StructTreeRoot', '/OpenAction', '/AA']) {
    if (key in catalog)
      throw new AppError('validation-failed', undefined, `${key} ainda presente.`);
  }

  const pdf = qpdf.readFile(OUT);
  qpdf.remove(OUT);
  progress(1, 'PDF gravado');
  return {
    pdf,
    report: {
      pages: pagesAfter.length,
      originalVersion: doc.header.pdfversion,
      wasEncrypted,
      shadingsReplaced,
      warnings,
      ...fix,
    },
  };
}
