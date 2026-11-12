import type { FileKind } from '../lib/shared/file-type';
import type { IconName } from '../components/icon-paths';

/** Grupos do menu lateral, na ordem em que aparecem. */
export const TOOL_GROUPS = ['Corel', 'Imagem', 'PDF'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface ToolOption {
  readonly id: string;
  readonly label: string;
}

export interface ToolDefinition {
  /** Usado na URL (#/id). */
  readonly id: string;
  readonly group: ToolGroup;
  /** Título da tela. */
  readonly name: string;
  /** Nome curto no menu lateral. */
  readonly menuLabel: string;
  /** Uma linha dizendo o que a ferramenta faz, do ponto de vista de quem usa. */
  readonly description: string;
  readonly icon: IconName;
  /** Tipos aceitos, conferidos pelo conteúdo do arquivo. */
  readonly accepts: readonly FileKind[];
  /** Variações da ferramenta (ex.: tipo de correção). A primeira é a padrão. */
  readonly options?: readonly ToolOption[];
  /** Texto da área de soltar. */
  readonly dropLabel: string;
  /** Etapa do projeto em que a ferramenta passa a funcionar; `null` quando já funciona. */
  readonly availableInStage: number | null;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'corrigir-pdf',
    group: 'Corel',
    name: 'Corrigir PDF para o Corel',
    menuLabel: 'Corrigir PDF',
    description: 'Reescreve o PDF para o CorelDRAW 27 abrir sem perder vetores, textos e imagens.',
    icon: 'file-check',
    accepts: ['pdf'],
    options: [
      { id: 'basica', label: 'Correção básica' },
      { id: 'degrades', label: 'Básica + degradês' },
    ],
    dropLabel: 'Solte os PDFs aqui',
    availableInStage: null,
  },
  {
    id: 'remover-fundo',
    group: 'Imagem',
    name: 'Remover fundo',
    menuLabel: 'Remover fundo',
    description: 'Recorta o fundo da imagem e gera um PNG transparente na resolução original.',
    icon: 'scissors',
    accepts: ['png', 'jpeg', 'webp'],
    dropLabel: 'Solte as imagens aqui',
    availableInStage: null,
  },
  {
    id: 'converter-imagens',
    group: 'Imagem',
    name: 'Converter imagens',
    menuLabel: 'Converter imagens',
    description: 'Troca o formato, muda o tamanho ou junta várias imagens num PDF.',
    icon: 'photo',
    accepts: ['png', 'jpeg', 'webp'],
    options: [
      { id: 'converter', label: 'Converter' },
      { id: 'para-pdf', label: 'Imagens para PDF' },
    ],
    dropLabel: 'Solte as imagens aqui',
    availableInStage: null,
  },
  {
    id: 'editar-pdf',
    group: 'PDF',
    name: 'Editar PDF',
    menuLabel: 'Editar PDF',
    description: 'Junta, separa, gira, corta ou comprime PDFs, ou transforma páginas em imagem.',
    icon: 'files',
    accepts: ['pdf'],
    options: [
      { id: 'juntar', label: 'Juntar' },
      { id: 'separar', label: 'Separar' },
      { id: 'extrair', label: 'Extrair páginas' },
      { id: 'girar', label: 'Girar' },
      { id: 'cortar', label: 'Cortar' },
      { id: 'comprimir', label: 'Comprimir' },
      { id: 'para-imagem', label: 'PDF para imagem' },
    ],
    dropLabel: 'Solte os PDFs aqui',
    availableInStage: null,
  },
];

export const DEFAULT_TOOL_ID = 'corrigir-pdf';

export function findTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
