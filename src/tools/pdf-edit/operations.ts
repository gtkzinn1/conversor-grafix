import { AppError } from '../../lib/shared/errors';
import { assertPageCount } from '../../lib/shared/limits';
import { listPages } from '../pdf-corel/pages';
import type { Qpdf, QpdfRun } from '../pdf-corel/qpdf';
import { isQpdfJson, PdfJsonDocument } from '../pdf-corel/qpdf-json';
import { displayRectToBox, type DisplayRect } from './crop';

/**
 * Ferramentas de PDF (juntar, separar, extrair, girar, cortar, comprimir) sobre o qpdf.
 * Rodam no worker (app) e no Node (testes). Nada é rasterizado: vetores, textos e imagens
 * passam como estão. A saída vai sem object streams, como no "Corrigir PDF", para o Corel.
 */

export interface PdfSource {
  readonly data: Uint8Array;
  readonly password?: string;
}

/** Ângulo de giro, no sentido horário. */
export type Rotation = 90 | 180 | 270;

export type CompressMode = 'lossless' | 'images';

const IN = '/entrada.pdf';
const OUT = '/saida.pdf';
const STRUCTURE = '/estrutura.json';
const UPDATE = '/atualizacao.json';
const WRITE_ARGS = ['--object-streams=disable', '--compress-streams=y'];

/** qpdf: 0 = ok, 3 = ok com avisos, 2 = erro. */
const succeeded = (run: QpdfRun) => run.code === 0 || run.code === 3;

/** "1-3,5,8-9" a partir de números de página (1 = primeira). */
export function toPageRange(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let end = start;
  for (const page of [...sorted.slice(1), undefined]) {
    if (page !== undefined && end !== undefined && page === end + 1) {
      end = page;
      continue;
    }
    if (start !== undefined && end !== undefined) {
      parts.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
    }
    start = page;
    end = page;
  }
  return parts.join(',');
}

/** Grava a entrada no sistema de arquivos do qpdf e devolve os argumentos de senha. */
function open(qpdf: Qpdf, source: PdfSource, path: string, label?: string): string[] {
  qpdf.writeFile(path, source.data);
  // --requires-password: 0 = precisa de senha, 2 = sem criptografia, 3 = criptografado sem senha de abertura.
  const encryption = qpdf.run(['--requires-password', path]);
  if (encryption.code === 0 && source.password === undefined) {
    throw new AppError(
      'password-required',
      label === undefined
        ? undefined
        : `"${label}" tem senha de abertura. Tire a senha antes de juntar.`,
    );
  }
  return source.password === undefined ? [] : [`--password=${source.password}`];
}

/** Número de páginas (e confere se o PDF abre). */
function countPages(qpdf: Qpdf, path: string, password: readonly string[]): number {
  const run = qpdf.run([...password, '--show-npages', path]);
  if (!succeeded(run)) {
    if (/invalid password/i.test(run.stderr)) throw new AppError('wrong-password');
    throw new AppError('invalid-pdf', undefined, run.stderr);
  }
  const pages = Number.parseInt(run.stdout.trim(), 10);
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new AppError('invalid-pdf', 'Este PDF não tem páginas.');
  }
  assertPageCount(pages);
  return pages;
}

function assertPages(pages: readonly number[], total: number): void {
  if (pages.length === 0) throw new AppError('invalid-options', 'Escolha pelo menos uma página.');
  if (pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > total)) {
    throw new AppError('invalid-options', `O PDF tem ${String(total)} páginas.`);
  }
}

/** Roda a gravação, confere o resultado (--check e número de páginas) e devolve os bytes. */
function write(qpdf: Qpdf, args: readonly string[], expectedPages: number): Uint8Array {
  const run = qpdf.run([...args, OUT]);
  if (!succeeded(run)) {
    if (/invalid password/i.test(run.stderr)) throw new AppError('wrong-password');
    throw new AppError('invalid-pdf', undefined, run.stderr);
  }
  const check = qpdf.run(['--check', OUT]);
  const pages = qpdf.run(['--show-npages', OUT]);
  if (!succeeded(check) || Number.parseInt(pages.stdout.trim(), 10) !== expectedPages) {
    throw new AppError(
      'validation-failed',
      'O PDF gerado não passou na conferência final, por isso não foi liberado.',
      check.stderr || check.stdout,
    );
  }
  const pdf = qpdf.readFile(OUT);
  qpdf.remove(OUT);
  return pdf;
}

/** Junta os PDFs na ordem recebida. */
export function mergePdfs(
  qpdf: Qpdf,
  sources: readonly (PdfSource & { readonly name: string })[],
): Uint8Array {
  if (sources.length < 2) throw new AppError('invalid-options', 'Escolha pelo menos dois PDFs.');
  const pageArgs: string[] = [];
  let total = 0;
  sources.forEach((source, index) => {
    const path = `/juntar-${String(index)}.pdf`;
    const password = open(qpdf, source, path, source.name);
    total += countPages(qpdf, path, password);
    pageArgs.push(`--file=${path}`, ...password);
  });
  assertPageCount(total);
  const pdf = write(qpdf, ['--empty', '--pages', ...pageArgs, '--', ...WRITE_ARGS], total);
  sources.forEach((_, index) => {
    qpdf.remove(`/juntar-${String(index)}.pdf`);
  });
  return pdf;
}

/** Um PDF por página, na ordem do documento. */
export function splitPdf(
  qpdf: Qpdf,
  source: PdfSource,
  onPage?: (done: number, total: number) => void,
): Uint8Array[] {
  const password = open(qpdf, source, IN);
  const total = countPages(qpdf, IN, password);
  const pages: Uint8Array[] = [];
  for (let page = 1; page <= total; page++) {
    pages.push(
      write(
        qpdf,
        [...password, '--decrypt', IN, '--pages', '.', String(page), '--', ...WRITE_ARGS],
        1,
      ),
    );
    onPage?.(page, total);
  }
  qpdf.remove(IN);
  return pages;
}

/** Um PDF só com as páginas escolhidas, na ordem do documento. */
export function extractPages(qpdf: Qpdf, source: PdfSource, pages: readonly number[]): Uint8Array {
  const password = open(qpdf, source, IN);
  assertPages(pages, countPages(qpdf, IN, password));
  const range = toPageRange(pages);
  const pdf = write(
    qpdf,
    [...password, '--decrypt', IN, '--pages', '.', range, '--', ...WRITE_ARGS],
    new Set(pages).size,
  );
  qpdf.remove(IN);
  return pdf;
}

/** Gira páginas (somando ao giro que elas já têm). `rotations`: página → ângulo. */
export function rotatePages(
  qpdf: Qpdf,
  source: PdfSource,
  rotations: ReadonlyMap<number, Rotation>,
): Uint8Array {
  const password = open(qpdf, source, IN);
  const total = countPages(qpdf, IN, password);
  assertPages([...rotations.keys()], total);
  const byAngle = new Map<Rotation, number[]>();
  for (const [page, angle] of rotations) byAngle.set(angle, [...(byAngle.get(angle) ?? []), page]);
  const rotateArgs = [...byAngle].map(
    ([angle, pages]) => `--rotate=+${String(angle)}:${toPageRange(pages)}`,
  );
  const pdf = write(qpdf, [...password, '--decrypt', IN, ...rotateArgs, ...WRITE_ARGS], total);
  qpdf.remove(IN);
  return pdf;
}

/**
 * Corta redefinindo as caixas da página (MediaBox e CropBox, e TrimBox, BleedBox e ArtBox
 * quando existirem). O conteúdo fora da área fica escondido, não apagado.
 * `pages`: páginas a cortar (1 = primeira); a área é a mesma, na posição de cada página.
 */
export function cropPages(
  qpdf: Qpdf,
  source: PdfSource,
  rect: DisplayRect,
  pages: readonly number[] | 'all',
): Uint8Array {
  const password = open(qpdf, source, IN);
  const total = countPages(qpdf, IN, password);
  const targets = pages === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : pages;
  assertPages(targets, total);

  const run = qpdf.run([...password, IN, '--json-output', '--json-stream-data=none', STRUCTURE]);
  if (!succeeded(run)) throw new AppError('invalid-pdf', undefined, run.stderr);
  const parsed: unknown = JSON.parse(qpdf.readText(STRUCTURE));
  qpdf.remove(STRUCTURE);
  if (!isQpdfJson(parsed)) throw new AppError('invalid-pdf', undefined, 'JSON inesperado.');
  const doc = new PdfJsonDocument(parsed);
  const pageList = listPages(doc);

  let cropped = 0;
  for (const number of new Set(targets)) {
    const page = pageList[number - 1];
    if (page === undefined) continue;
    const box = displayRectToBox(page, rect);
    if (box === undefined) continue;
    const rounded = box.map((value) => Math.round(value * 1000) / 1000);
    doc.edit(page.key, (dict) => {
      dict['/MediaBox'] = rounded;
      dict['/CropBox'] = rounded;
      for (const name of ['/TrimBox', '/BleedBox', '/ArtBox']) {
        if (name in dict) dict[name] = rounded;
      }
    });
    cropped++;
  }
  if (cropped === 0) {
    throw new AppError('invalid-options', 'A área de corte ficou fora da página.');
  }

  qpdf.writeFile(UPDATE, doc.toUpdateJson());
  const pdf = write(
    qpdf,
    [...password, '--decrypt', IN, `--update-from-json=${UPDATE}`, ...WRITE_ARGS],
    total,
  );
  qpdf.remove(UPDATE);
  qpdf.remove(IN);
  return pdf;
}

/**
 * Comprime sem mudar a aparência ("lossless": recomprime os dados e tira o que não é usado)
 * ou também regrava imagens em JPEG ("images", com perda; só quando a imagem fica menor).
 */
export function compressPdf(
  qpdf: Qpdf,
  source: PdfSource,
  mode: CompressMode,
  jpegQuality = 75,
): Uint8Array {
  const password = open(qpdf, source, IN);
  const total = countPages(qpdf, IN, password);
  const quality = Math.round(Math.min(95, Math.max(30, jpegQuality)));
  const imageArgs =
    mode === 'images' ? ['--optimize-images', `--jpeg-quality=${String(quality)}`] : [];
  const pdf = write(
    qpdf,
    [
      ...password,
      '--decrypt',
      IN,
      '--recompress-flate',
      '--compression-level=9',
      '--remove-unreferenced-resources=yes',
      ...imageArgs,
      ...WRITE_ARGS,
    ],
    total,
  );
  qpdf.remove(IN);
  return pdf;
}
