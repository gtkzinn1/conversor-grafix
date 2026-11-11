# Segurança

O Conversor processa arquivos de clientes da Grafix (PDF, PSD, imagens). Esses arquivos são tratados como **não confiáveis**: o app é construído como se recebesse arquivos hostis.

O modelo de segurança completo está em [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md) (seção 3). Este é o resumo.

## Princípios

- **Nenhum arquivo sai do computador.** Todo o processamento é feito no navegador. Não há servidor de processamento, analytics, telemetria, nem fontes ou scripts de CDN.
- **Única conexão externa permitida:** o download do modelo de IA de remoção de fundo, a partir de uma revisão fixa do Hugging Face, com conferência de SHA-256 (Etapa 3).
- **Arquivos de clientes são lidos em Web Workers**, um worker por tarefa, encerrado ao final, com limites de tamanho, resolução, páginas e tempo.
- **Dados de arquivos nunca viram HTML.** Nomes e metadados são exibidos como texto (JSX escapa automaticamente). O lint proíbe `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` e `dangerouslySetInnerHTML`.
- **Nomes de arquivo de saída são sanitizados** (caracteres proibidos no Windows, caracteres de controle, controles de direção de texto que disfarçam extensões, nomes reservados como `CON`).

## PDFs de clientes (Corrigir PDF para o Corel)

- Todo PDF é aberto num worker próprio, encerrado ao final; o qpdf roda em WebAssembly (sandbox do navegador), num sistema de arquivos em memória.
- O PDF corrigido sai **sem conteúdo ativo**: JavaScript, ações automáticas (`/OpenAction`, `/AA`), ações que executam ou abrem arquivos (`/Launch`, `/SubmitForm`, `/GoToR`…), anexos e anotações de mídia.
- Senha de abertura: o app pede ao usuário; nunca tenta adivinhar. Proteção contra edição (sem senha de abertura) é removida.
- O leitor de conteúdo de página tem limites de tamanho de token, aninhamento e número de instruções; a calculadora PostScript das funções de degradê tem limite de passos e de pilha. Sintaxe inválida mantém o conteúdo original, com aviso.
- A conferência visual usa o PDF.js num worker aninhado, sem fontes do sistema, sem busca na rede e sem scripts.

## Cabeçalhos HTTP

Definidos em [`public/_headers`](public/_headers) (Cloudflare Pages) e aplicados também no `vite preview`, de modo que os testes ponta a ponta rodem com as regras de produção.

- **CSP estrita:** sem `unsafe-inline` e sem `unsafe-eval`. Apenas `wasm-unsafe-eval` (necessário para WebAssembly). `connect-src` limitado ao próprio site e ao Hugging Face.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` negando câmera, microfone, localização etc.
- **Isolamento de origem** (`COOP: same-origin` + `COEP: credentialless`), necessário para WebAssembly com várias threads.

Os testes ponta a ponta reprovam qualquer erro de console, violação de CSP ou requisição para outro domínio.

## Cadeia de suprimentos

- Poucas dependências em tempo de execução: Preact, workbox-window, a fonte Exo 2 e o PDF.js (sem dependências indiretas no app).
- **qpdf compilado por nós** (`scripts/qpdf-wasm/build.sh`, workflow `qpdf-wasm`): fonte oficial conferida pelo SHA-256 publicado no arquivo assinado do release, imagem do Emscripten fixada por digest, saída sem `eval`. O CI confere o SHA-256 de `vendor/qpdf/qpdf.js` e `qpdf.wasm` contra `BUILD-INFO`.
- Versões **exatas** (`save-exact`), `package-lock.json` versionado e `npm ci` no CI.
- Política de adoção: só versões estáveis publicadas há pelo menos **14 dias**; o Dependabot espera 7 dias (`cooldown`) antes de sugerir atualização.
- **Scripts de instalação desativados** (`ignore-scripts=true` em `.npmrc`).
- GitHub Actions fixadas por **SHA de commit**, com permissão somente leitura.
- `npm audit --audit-level=high` no CI.

### Alertas conhecidos (aceitos)

| Pacote                                                                                         | Gravidade | Onde                                                                | Por que é aceito                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepmerge` ≤ 4.3.1 ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)) | Baixa     | `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-node-resolve` | Só roda durante a build, com a configuração do próprio projeto; nada dele vai para o app. Ainda não existe versão corrigida. Reavaliar a cada atualização do `vite-plugin-pwa`. |

Correções aplicadas via `overrides` no `package.json`: `minimatch` 11.0.8 e `glob` 14.0.4 (vulnerabilidades moderadas em dependências de ferramentas de build).

## Contas

GitHub e Cloudflare com verificação em duas etapas, repositório privado, branch `main` protegida (CI verde obrigatório, sem _force push_), deploy apenas a partir da `main`.

## Como reportar um problema

Este é um projeto privado. Problemas de segurança devem ser comunicados diretamente ao responsável pelo repositório, e não em issues públicas.
