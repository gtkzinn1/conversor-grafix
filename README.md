<p align="center">
  <img src="src/assets/logo-grafix-light.png" alt="Grafix – Gráfica e Comunicação Visual" width="360" />
</p>

<h1 align="center">Conversor</h1>

<p align="center">
  Ferramentas de PDF e imagem para a rotina de uma gráfica,<br />
  rodando <strong>100% no navegador</strong>: nenhum arquivo sai do computador.
</p>

<p align="center">
  <img alt="Licença" src="https://img.shields.io/badge/uso-privado-555" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-offline-5a0fc8" />
</p>

---

## Por que existe

Na Grafix chegam todo dia arquivos de clientes que o CorelDRAW recusa ou importa faltando partes e imagens que precisam de recorte. O **Conversor** reúne essas correções num app instalável, que funciona offline e trata cada arquivo como potencialmente hostil.

## Ferramentas

| Ferramenta                                                                                                                                                                               | Situação             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Corrigir PDF para o CorelDRAW 27**: resolve o "arquivo danificado" dos PDFs do Canva, reescreve em PDF 1.4, remove conteúdo ativo e troca degradês que o Corel descarta por cor sólida | **Pronta** (Etapa 2) |
| **Remover fundo de imagem** com IA (BiRefNet, local, WebGPU/WASM) e editor de ajuste                                                                                                     | **Pronta** (Etapa 3) |
| **Editar PDF**: juntar, separar, extrair, girar, cortar por área, comprimir, PDF → imagem                                                                                                | **Pronta** (Etapa 5) |
| **Converter imagens**: JPG/PNG/WebP com qualidade e tamanho (px, %, cm + DPI); imagens → PDF sem recomprimir JPEG                                                                        | **Pronta** (Etapa 6) |

**Concluído.** As Etapas 1 a 3, 5, 6 e 8 estão prontas; as Etapas 4 (PSD → PDF) e 7 (CMYK) saíram do escopo. Publicado em https://grafix-conversor.pages.dev.

### Como funciona a correção para o Corel

1. O **qpdf** (compilado para WebAssembly) lê o PDF, repara a estrutura e remove proteções.
2. A estrutura vira JSON; o app remove a **árvore de acessibilidade do Canva** (a causa do "arquivo danificado"), o conteúdo ativo e, se pedido, troca degradês por cor sólida, lendo o conteúdo das páginas com um leitor próprio (sem regex).
3. O qpdf grava em **PDF 1.4** com tabela xref clássica.
4. Antes de liberar o download, o app confere o arquivo com o qpdf e **compara a aparência** do original e do corrigido com o PDF.js.

## Arquitetura

```
Página (Preact)                         Web Worker (um por tarefa)
──────────────                          ──────────────────────────
arquivo do cliente ──► runWorkerTask ──► defineWorkerTask ──► processa bytes
        ▲                  │  progresso / cancelar / tempo-limite      │
        └──── resultado ◄──┴──────────── mensagem validada ◄───────────┘
```

- **Tudo local.** O app é só um conjunto de arquivos estáticos; o processamento acontece no navegador.
- **Um worker por tarefa**, encerrado ao final: isola cada arquivo, libera memória e permite cancelar na hora.
- **Mensagens validadas** nos dois sentidos da fronteira página ↔ worker.
- **PWA** com atualização sob aviso ("Nova versão disponível"), nunca silenciosa.

Detalhes, requisitos e decisões: [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md). Segurança: [`SECURITY.md`](SECURITY.md).

## Stack

[Vite](https://vite.dev) · [TypeScript](https://www.typescriptlang.org) (strict) · [Preact](https://preactjs.com) · [vite-plugin-pwa](https://vite-pwa-org.netlify.app) / Workbox · [Vitest](https://vitest.dev) · [Playwright](https://playwright.dev) · ESLint (com regras de segurança) · Prettier

## Estrutura

```
├─ .github/            CI (GitHub Actions) e Dependabot
├─ docs/               especificação e registro de decisões
├─ public/             _headers (segurança), ícones do PWA
├─ scripts/            ícones, cabeçalhos no preview, compilação do qpdf, PDFs de teste
├─ vendor/qpdf/        qpdf compilado para WebAssembly (hashes em BUILD-INFO)
├─ src/
│  ├─ assets/          logos e símbolos
│  ├─ components/      menu lateral, área de soltar, lista de arquivos
│  ├─ pages/           tela de ferramenta e tela "Sobre"
│  ├─ lib/             tema, download, PWA, execução de workers
│  │  └─ shared/       código que roda na página e nos workers (erros, nomes, tipos, limites)
│  ├─ styles/          tokens de cor (temas escuro e claro)
│  ├─ tools/           registro das ferramentas e fila de arquivos
│  └─ workers/         tarefas pesadas, uma por arquivo
└─ tests/
   ├─ unit/            Vitest
   └─ e2e/             Playwright (Google Chrome)
```

## Desenvolvimento

Requisitos: **Node.js 24** e **Google Chrome**.

```bash
npm ci              # instala as versões exatas do package-lock
npm run dev         # servidor de desenvolvimento
npm run check       # formatação, lint, testes, build e testes ponta a ponta
```

| Comando                           | O que faz                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run build`                   | Checa tipos e gera a build de produção em `dist/`           |
| `npm run preview`                 | Serve `dist/` com os mesmos cabeçalhos do Cloudflare Pages  |
| `npm test`                        | Testes unitários                                            |
| `npm run test:e2e`                | Testes ponta a ponta no Chrome (rode `npm run build` antes) |
| `npm run lint` / `npm run format` | ESLint / Prettier                                           |

Ícones e a versão clara do logo são gerados a partir do logo original:

```bash
python -I scripts/generate-brand-assets.py   # requer Pillow
```

As amostras de teste em `tests/samples/` são sintéticas: `scripts/samples/generate_samples.py` (PDFs, requer pikepdf) e `scripts/samples/generate_images.py` (imagens, requer Pillow).

## Publicação e instalação

Hospedado no **Cloudflare Pages** em `https://grafix-conversor.pages.dev`, a partir da branch `main` (build `npm ci && npm run build`, saída `dist`). A hospedagem serve apenas os arquivos do app.

Para instalar: abrir o endereço no Chrome → ícone de instalar na barra de endereço → **Instalar**. O app abre em janela própria, funciona offline e avisa quando há versão nova.

## Licença

Projeto privado da Grafix – Gráfica e Comunicação Visual. Todos os direitos reservados. Componentes de terceiros: [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
