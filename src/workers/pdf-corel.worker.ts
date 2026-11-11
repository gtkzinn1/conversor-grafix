import { AppError } from '../lib/shared/errors';
import { assertPageCount } from '../lib/shared/limits';
import {
  isPdfCorelInput,
  type PdfCorelInput,
  type PdfCorelOutput,
} from '../lib/shared/tasks/pdf-corel';
import { applyBasicFix } from '../tools/pdf-corel/basic-fix';
import { listPages, samePageGeometry } from '../tools/pdf-corel/pages';
import { isQpdfJson, PdfJsonDocument } from '../tools/pdf-corel/qpdf-json';
import { loadQpdf, type Qpdf, type QpdfRun } from './qpdf';
import { defineWorkerTask } from './runtime';

const IN = '/entrada.pdf';
const NORMALIZED = '/normalizado.pdf';
const JSON_FILE = '/estrutura.json';
const UPDATE = '/atualizacao.json';
const OUT = '/saida.pdf';
const CHECK_JSON = '/conferencia.json';

/** qpdf: 0 = ok, 3 = ok com avisos, 2 = erro. */
const succeeded = (run: QpdfRun) => run.code === 0 || run.code === 3;

function readJson(qpdf: Qpdf, path: string): PdfJsonDocument {
  const parsed: unknown = JSON.parse(qpdf.readText(path));
  if (!isQpdfJson(parsed)) throw new Error('JSON do qpdf em formato inesperado.');
  return new PdfJsonDocument(parsed);
}

/** Exporta a estrutura do PDF em JSON (sem os dados dos streams). */
function exportJson(
  qpdf: Qpdf,
  pdfPath: string,
  jsonPath: string,
  failure: 'invalid-pdf' | 'validation-failed',
): PdfJsonDocument {
  qpdf.remove(jsonPath);
  const run = qpdf.run([pdfPath, '--json-output', '--json-stream-data=none', jsonPath]);
  if (!succeeded(run)) throw new AppError(failure, undefined, run.stderr);
  const doc = readJson(qpdf, jsonPath);
  qpdf.remove(jsonPath);
  return doc;
}

defineWorkerTask<PdfCorelInput, PdfCorelOutput>(isPdfCorelInput, async (input, context) => {
  context.progress(null, 'Carregando o motor de PDF');
  const qpdf = await loadQpdf();

  context.progress(0.1, 'Lendo o PDF');
  qpdf.writeFile(IN, new Uint8Array(await input.file.arrayBuffer()));
  const password = input.password === undefined ? [] : [`--password=${input.password}`];

  // --requires-password: 0 = precisa de senha, 2 = sem criptografia, 3 = criptografado sem senha de abertura.
  const encryption = qpdf.run(['--requires-password', IN]);
  const wasEncrypted = encryption.code === 0 || encryption.code === 3;
  if (encryption.code === 0 && input.password === undefined)
    throw new AppError('password-required');

  // 1. Normaliza: decripta (remove restrições), tira object streams, repara a xref.
  context.progress(0.25, 'Reparando a estrutura');
  const normalized = qpdf.run([
    ...password,
    '--decrypt',
    '--object-streams=disable',
    IN,
    NORMALIZED,
  ]);
  if (!succeeded(normalized)) {
    if (/invalid password/i.test(normalized.stderr)) throw new AppError('wrong-password');
    throw new AppError('invalid-pdf', undefined, normalized.stderr);
  }
  qpdf.remove(IN);

  // 2. Lê a estrutura e aplica as correções.
  context.progress(0.45, 'Analisando o conteúdo');
  const doc = exportJson(qpdf, NORMALIZED, JSON_FILE, 'invalid-pdf');
  const pagesBefore = listPages(doc);
  assertPageCount(pagesBefore.length);
  const fix = applyBasicFix(doc);

  // 3. Grava em PDF 1.4 com xref clássica.
  context.progress(0.65, 'Gravando o PDF corrigido');
  const writeArgs = ['--object-streams=disable', '--force-version=1.4', '--compress-streams=y'];
  if (doc.changeCount > 0) {
    qpdf.writeFile(UPDATE, doc.toUpdateJson());
    writeArgs.unshift(`--update-from-json=${UPDATE}`);
  }
  const write = qpdf.run([NORMALIZED, ...writeArgs, OUT]);
  if (!succeeded(write)) throw new AppError('invalid-pdf', undefined, write.stderr);

  // 4. Conferência antes de liberar (seção 9.3).
  context.progress(0.85, 'Conferindo o resultado');
  const check = qpdf.run(['--check', OUT]);
  if (!succeeded(check))
    throw new AppError('validation-failed', undefined, check.stderr || check.stdout);
  const result = exportJson(qpdf, OUT, CHECK_JSON, 'validation-failed');
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

  const bytes = qpdf.readFile(OUT);
  const pdf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  context.progress(1, 'Pronto');
  return {
    output: {
      pdf,
      report: {
        pages: pagesAfter.length,
        originalVersion: doc.header.pdfversion,
        wasEncrypted,
        shadingsReplaced: 0,
        warnings: [],
        ...fix,
      },
    },
    transfer: [pdf],
  };
});
