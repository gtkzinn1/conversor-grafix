import {
  isDict,
  isRef,
  keyOf,
  type PdfDict,
  type PdfJsonDocument,
  type PdfValue,
} from './qpdf-json';

/**
 * Correção básica para o CorelDRAW (seção 2.1a da especificação):
 * - remove a árvore de estrutura de acessibilidade ("tags"). Causa confirmada do erro
 *   "O arquivo está danificado" com PDFs do Canva (ver docs/ESPECIFICACAO.md, seção 11);
 * - remove conteúdo ativo: JavaScript, ações automáticas, ações perigosas, arquivos embutidos.
 *
 * A reescrita em PDF 1.4 com xref clássica e sem object streams é feita pelo qpdf.
 */

/** Ações que executam algo ou abrem/enviam arquivos. Links comuns (/URI, /GoTo) são mantidos. */
const DANGEROUS_ACTIONS = new Set([
  '/JavaScript',
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToE',
  '/GoToR',
  '/Rendition',
  '/RichMediaExecute',
  '/Sound',
  '/Movie',
]);

/** Anotações que embutem arquivos ou mídia. São retiradas das páginas. */
const MEDIA_ANNOTATIONS = new Set(['/FileAttachment', '/Screen', '/Movie', '/Sound', '/RichMedia']);

export interface BasicFixReport {
  /** Havia árvore de estrutura (tags) e ela foi removida. */
  structureRemoved: boolean;
  /** JavaScript encontrado e removido. */
  javascriptRemoved: boolean;
  /** Ações automáticas (/OpenAction, /AA) removidas. */
  automaticActionsRemoved: number;
  /** Ações perigosas em links, marcadores ou campos removidas. */
  dangerousActionsRemoved: number;
  /** Arquivos embutidos (anexos) removidos. */
  embeddedFilesRemoved: boolean;
  /** Anotações de anexo/mídia retiradas das páginas. */
  mediaAnnotationsRemoved: number;
}

function actionType(doc: PdfJsonDocument, action: PdfValue | undefined): string | undefined {
  const resolved = doc.resolve(action);
  if (!isDict(resolved)) return undefined;
  const type = resolved['/S'];
  return typeof type === 'string' ? type : undefined;
}

export function applyBasicFix(doc: PdfJsonDocument): BasicFixReport {
  const report: BasicFixReport = {
    structureRemoved: false,
    javascriptRemoved: false,
    automaticActionsRemoved: 0,
    dangerousActionsRemoved: 0,
    embeddedFilesRemoved: false,
    mediaAnnotationsRemoved: 0,
  };

  // 1. Catálogo (raiz do documento).
  const rootKey = doc.rootKey;
  const root = doc.dict(rootKey) ?? {};
  const namesRef = root['/Names'];
  doc.edit(rootKey, (catalog) => {
    if ('/StructTreeRoot' in catalog) report.structureRemoved = true;
    delete catalog['/StructTreeRoot'];
    delete catalog['/MarkInfo'];
    // A versão final é definida pelo qpdf (1.4); /Version no catálogo a sobrescreveria.
    delete catalog['/Version'];
    if ('/OpenAction' in catalog) {
      report.automaticActionsRemoved++;
      if (actionType(doc, catalog['/OpenAction']) === '/JavaScript')
        report.javascriptRemoved = true;
      delete catalog['/OpenAction'];
    }
    if ('/AA' in catalog) {
      report.automaticActionsRemoved++;
      delete catalog['/AA'];
    }
    // Arquivos associados (PDF 2.0).
    delete catalog['/AF'];
    const form = catalog['/AcroForm'];
    if (isDict(form)) delete form['/XFA'];
    if (isDict(catalog['/Names'])) cleanNames(catalog['/Names'], report);
  });
  if (isRef(namesRef)) {
    doc.edit(keyOf(namesRef), (names) => {
      cleanNames(names, report);
    });
  }
  const formRef = root['/AcroForm'];
  if (isRef(formRef) && isDict(doc.resolve(formRef))) {
    doc.edit(keyOf(formRef), (form) => {
      delete form['/XFA'];
    });
  }

  // 2. Todos os objetos: tags, ações automáticas e perigosas, anexos de mídia.
  const mediaAnnotationRefs = new Set<string>();
  for (const key of doc.keys()) {
    const dict = doc.dict(key);
    if (dict === undefined || !needsCleaning(doc, dict)) continue;
    const subtype = dict['/Subtype'];
    if (typeof subtype === 'string' && MEDIA_ANNOTATIONS.has(subtype) && '/Rect' in dict) {
      mediaAnnotationRefs.add(key.slice('obj:'.length));
    }
    doc.edit(key, (target) => {
      cleanDict(doc, target, report);
    });
  }

  // 3. Retira as anotações de mídia/anexo das páginas.
  if (mediaAnnotationRefs.size > 0) {
    for (const key of doc.keys()) {
      const page = doc.dict(key);
      if (page?.['/Type'] !== '/Page') continue;
      const annots = page['/Annots'];
      if (Array.isArray(annots)) {
        const kept = annots.filter((ref) => !(isRef(ref) && mediaAnnotationRefs.has(ref)));
        if (kept.length !== annots.length) {
          report.mediaAnnotationsRemoved += annots.length - kept.length;
          doc.edit(key, (target) => {
            target['/Annots'] = kept;
          });
        }
      } else if (isRef(annots)) {
        const list = doc.resolve(annots);
        if (Array.isArray(list)) {
          const kept = list.filter((ref) => !(isRef(ref) && mediaAnnotationRefs.has(ref)));
          if (kept.length !== list.length) {
            report.mediaAnnotationsRemoved += list.length - kept.length;
            doc.replaceValue(keyOf(annots), kept);
          }
        }
      }
    }
  }

  return report;
}

function cleanNames(names: PdfDict, report: BasicFixReport): void {
  if ('/JavaScript' in names) report.javascriptRemoved = true;
  if ('/EmbeddedFiles' in names) report.embeddedFilesRemoved = true;
  delete names['/JavaScript'];
  delete names['/EmbeddedFiles'];
}

const CLEANABLE_KEYS = ['/StructParent', '/StructParents', '/AA', '/A', '/AF', '/JS'] as const;

/** Verificação rápida (sem copiar) se o dicionário, ou um dicionário direto dentro dele, tem algo a limpar. */
function needsCleaning(doc: PdfJsonDocument, dict: PdfDict): boolean {
  if (dict['/Tabs'] === '/S') return true;
  for (const key of CLEANABLE_KEYS) {
    if (!(key in dict)) continue;
    if (key !== '/A') return true;
    if (isDangerous(doc, dict['/A'])) return true;
  }
  return Object.values(dict).some(
    (value) =>
      (isDict(value) && needsCleaning(doc, value)) ||
      (Array.isArray(value) && value.some((item) => isDict(item) && needsCleaning(doc, item))),
  );
}

function isDangerous(doc: PdfJsonDocument, action: PdfValue | undefined): boolean {
  const type = actionType(doc, action);
  return type !== undefined && DANGEROUS_ACTIONS.has(type);
}

function cleanDict(doc: PdfJsonDocument, dict: PdfDict, report: BasicFixReport): void {
  delete dict['/StructParent'];
  delete dict['/StructParents'];
  if (dict['/Tabs'] === '/S') delete dict['/Tabs'];
  delete dict['/AF'];
  if ('/AA' in dict) {
    report.automaticActionsRemoved++;
    delete dict['/AA'];
  }
  if ('/A' in dict && isDangerous(doc, dict['/A'])) {
    if (actionType(doc, dict['/A']) === '/JavaScript') report.javascriptRemoved = true;
    report.dangerousActionsRemoved++;
    delete dict['/A'];
  }
  // O próprio dicionário de ação JavaScript (quando é um objeto separado).
  if (dict['/S'] === '/JavaScript' && '/JS' in dict) {
    report.javascriptRemoved = true;
    delete dict['/JS'];
  }
  for (const value of Object.values(dict)) {
    if (isDict(value)) cleanDict(doc, value, report);
    else if (Array.isArray(value)) {
      for (const item of value) if (isDict(item)) cleanDict(doc, item, report);
    }
  }
}
