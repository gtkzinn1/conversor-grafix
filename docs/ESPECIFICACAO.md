# Conversor (Grafix) — Especificação e passo a passo do projeto

App privado da **Grafix – Gráfica e Comunicação Visual**, usado em 3 computadores Windows com Chrome. Este documento é a **fonte da verdade** do projeto: decisões, requisitos, segurança e o passo a passo completo de construção.

---

## 0. Regras do projeto (obrigatórias)

Estas regras valem para **todo** o desenvolvimento, sem exceção.

1. **Aguardar o comando do usuário** antes de iniciar cada etapa. Não fazer nada além do que foi pedido. Ao terminar uma etapa, apresentar o resultado e esperar.
2. **Segurança em primeiro lugar.** Mesmo processando tudo localmente, o app deve ser construído como se recebesse arquivos hostis (PDFs e PSDs de clientes são considerados **não confiáveis**). Nenhuma etapa é concluída sem passar pelo checklist de segurança dela.
3. **Qualidade antes de velocidade.** Cada etapa só termina quando:
   - o código foi **analisado e revisado** (revisão própria, linha a linha, antes de entregar);
   - os **testes automáticos** da etapa passam;
   - o **checklist de aceite** da etapa foi cumprido e apresentado ao usuário;
   - não há erros nem avisos de TypeScript, lint ou console.
4. **Nada de suposições sobre bibliotecas.** Antes de adotar qualquer dependência: conferir manutenção recente, licença, vulnerabilidades conhecidas, tamanho e se faz o que promete. Registrar a decisão (seção 11).
5. **Nenhum dado sai do computador.** Nada de analytics, telemetria, fontes ou scripts de CDN em tempo de execução, nem envio de arquivos. A única conexão externa permitida é o download do modelo de IA (seção 6.4).
6. **Mudanças pequenas e rastreáveis.** Commits pequenos, com mensagem clara, um assunto por commit (padrão _Conventional Commits_). Cada etapa é feita numa **branch própria** e entra na `main` por **pull request**, com CI verde, só depois da aprovação do usuário.
7. **Documentar o que for decidido** neste arquivo (atualizar a seção correspondente) quando algo mudar.
8. **Interface definida junto com o usuário.** Antes de implementar qualquer tela, apresentar mockups (2–3 direções) para escolha. Interface enxuta: só o que tem função clara.

---

## 1. Resumo das decisões

| Item          | Decisão                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| Nome          | **Conversor** (provisório)                                                             |
| Tipo          | Aplicativo web instalável (**PWA**), instalado pelo Chrome                             |
| Onde roda     | 3 computadores Windows, **Google Chrome** atualizado                                   |
| Processamento | **100% local**, no navegador. Nenhum arquivo é enviado a servidor                      |
| Hospedagem    | **Cloudflare Pages** (plano gratuito), ligado ao GitHub                                |
| Repositório   | GitHub **privado**: `gtkzinn1/conversor-grafix`                                        |
| Idioma        | Português (Brasil)                                                                     |
| Visual        | **Tema escuro por padrão**, botão para alternar para o claro                           |
| Marca         | Logo da Grafix (seção 7)                                                               |
| Offline       | Funciona sem internet depois de instalado (o modelo de IA precisa ser baixado uma vez) |
| Cores         | Mantém as originais; opção de converter para **CMYK (FOGRA39)**                        |

A hospedagem serve **apenas para entregar os arquivos do app** e permitir instalação e atualização automática. Toda conversão acontece no computador.

---

## 2. Ferramentas (escopo)

### 2.1 Corrigir PDF para o CorelDRAW 27 — prioridade 1

**Problema:** PDFs recebidos que o CorelDRAW 27 recusa ("arquivo danificado") ou importa faltando partes. Hoje o usuário abre no Photoshop, o que **rasteriza os vetores**. Objetivo: **PDF entra → PDF sai**, com vetores, textos e imagens preservados.

Duas opções na interface:

**a) "Corrigir PDF" (correção básica)**

- Reescrever em versão compatível (alvo **PDF 1.4**).
- Desativar _object streams_ e gravar tabela xref clássica.
- Remover restrições de permissão (PDF protegido contra edição, sem senha de abertura). Se o PDF exigir **senha de abertura**, pedir a senha ao usuário; nunca tentar quebrar.
- Reparar estrutura (xref, comprimentos de stream).
- Opcional (configurável): recomprimir imagens em formatos que o Corel lê mal (JPEG2000/`JPXDecode`, `JBIG2Decode`) para JPEG ou Flate, **sem reduzir resolução**.
- **Remover conteúdo ativo** do PDF de saída: JavaScript, `/OpenAction`, `/AA`, ações `/Launch`, `/URI` automáticas e arquivos embutidos (o Corel não precisa disso e reduz risco).
- Saída: `nome (corel).pdf`, sem sobrescrever o original.

**b) "Corrigir PDF + degradês" (correção estendida)**
Correção básica **mais** a troca dos degradês que o Corel não importa por cor sólida.

**Diagnóstico real** (arquivo de teste `PÃO DE QUEIJO MARIAS - LOGO.pdf`):

- PDF 1.3, PDF/X-1:2001, gerado pelo CorelDRAW 2021. Íntegro, 100% vetorial, sem imagens.
- **133 degradês** (`ShadingType 3` radiais e `ShadingType 2` lineares; funções `FunctionType 3` de costura; CMYK).
- Cada degradê é pintado como **recorte + operador `sh`**:
  ```
  q
  [cm opcional]
  <caminho: m / l / c / v / y / re / h>
  W   (ou W*)
  n
  [cm opcional]
  /ShNN sh
  Q
  ```
- O Corel cria o recorte, mas **descarta o preenchimento `sh`**, deixando o objeto vazio. Nesse logo, os desenhos são formados por esses degradês, por isso "somem". **Mudar só a versão não resolve.**

**Técnica validada** (testada com sucesso no boneco da direita do arquivo):

- Trocar `caminho W|W* n [cm] /ShNN sh` por: **cor sólida + mesmo caminho + preenchimento** (`W`→`f`, `W*`→`f*`).
- A cor vai **antes do caminho** (depois de eventuais `cm` iniciais), pois operadores de cor são proibidos no meio da construção de um caminho.
- Cor = **média da função do degradê** amostrada de t=0 a 1, no mesmo espaço de cor (`k` para CMYK, `rg` para RGB, `g` para cinza).

**Requisitos para a versão do app (mais robusta que o teste):**

- Usar um **tokenizador real de content stream** (ler operandos e operadores, strings, arrays, dicionários, imagens inline `BI…ID…EI`). **Proibido** usar regex sobre o stream no app final: regex quebra com formatação diferente.
- Rastrear a pilha de estado gráfico (`q`/`Q`, `cm`) para manter a geometria correta.
- Percorrer **todas as páginas**, recursos herdados e **Form XObjects** (`Do`) recursivamente, com proteção contra referência circular.
- Content stream pode ser um array de streams; concatenar corretamente.
- Tratar também degradês usados como **padrão de preenchimento** (`/Pattern` com `PatternType 2`, via `scn`/`SCN`).
- Espaços de cor: DeviceCMYK, DeviceRGB, DeviceGray; para `ICCBased`, `Separation`, `DeviceN` e `Indexed`, usar o espaço alternativo e documentar a aproximação.
- Funções: suportar `FunctionType 0` (amostrada), `2`, `3` e `4` (PostScript calculadora, com limite de passos para evitar loop infinito). Se não suportar, **manter o degradê original** e avisar, nunca gerar arquivo quebrado.
- **Todo degradê vira cor sólida** (decisão do usuário em 2026-11-11, após teste no Corel): `sh` sem recorte logo antes vira o preenchimento da área inteira (página ou Form, desfazendo a CTM) com a cor média, isolado em `q…Q`; tipo 1 usa média numa grade 2D; malhas (tipos 4–7) e espaços de cor sem conversão usam `/Background` ou cinza 50%, com aviso de cor aproximada. As definições de degradê que ficam sem uso são retiradas dos recursos.
- **Página de amostras no fim:** cada degradê linear ou radial original (sem repetir, até 200) vira um quadrado numa página extra, do tamanho da 1ª página, com a página de origem na legenda. Formato `caminho W n /SwN sh`, que o Corel 27 importa como degradê editável (rodada 8); `/Coords` refeitas para caber no quadrado. Degradês em padrão (`/Pattern cs … scn`) são recusados pelo Corel e nunca são gravados.
- **Imagens embutidas no conteúdo** (`BI…EI`) viram imagens normais nas duas opções (`--externalize-inline-images`): o Corel 27 recusa o arquivo com elas (rodada 7).
- Validar a saída (seção 9.3) antes de liberar o download.

### 2.2 Remover fundo de imagem — prioridade 2

- Recorte **normal** (cortesia para clientes). Prioridade: **qualidade**; o tempo não importa.
- **Motor: BiRefNet** (licença MIT, `ZhengPeng7/BiRefNet`). Existem versões ONNX prontas na organização `onnx-community` do Hugging Face (ex.: `BiRefNet-ONNX`, `BiRefNet_lite-ONNX`). Testar as variantes e escolher a de **maior qualidade que rode de forma estável** nos 3 computadores; registrar a escolha e o motivo.
- **Não usar RMBG-2.0** (licença só não comercial) nem modelos sem licença clara.
- **Escolha (Etapa 3):** padrão **`BiRefNet_512x512` fp32 no processador (WASM)**, 897 MB. Os modelos de 1024 px não cabem nos 4 GB de memória do WASM (`bad_alloc`), e o WebGPU travou a placa AMD GCN-4 de um dos computadores (TDR do Windows). Os modelos de 1024 px na placa de vídeo (BiRefNet e BiRefNet lite, fp16 ou fp32) ficam como opção em “Sobre”.
- Execução: **ONNX Runtime Web** 1.31.1 (build JSPI) em **Web Worker**; WASM por padrão, WebGPU opcional. Se a placa cair durante um recorte (dispositivo perdido, worker encerrado ou tempo esgotado), o app volta sozinho para o processador e lembra isso naquele computador; dá para religar em “Sobre”.
- Modelo carregado do Hugging Face (é maior que o limite de 25 MiB por arquivo do Cloudflare Pages), com as regras de segurança da seção 6.4.
- Processamento:
  - Inferência na resolução do modelo; **máscara redimensionada para a resolução original**.
  - Refinamento das cores de borda (equivalente ao `refine_foreground` do BiRefNet) para evitar halo.
  - Limitar tamanho de entrada (ex.: até 50 megapixels; configurável) e avisar em vez de travar.
- **Editor de ajuste:** pincéis **Apagar** e **Restaurar** (a partir do original), tamanho e suavidade, zoom e pan, fundo xadrez ou cor sólida para conferir, **desfazer/refazer**.
- Saída: **PNG transparente** na resolução original. Desejável: fila de várias imagens.

### 2.3 PSD → PDF — prioridade 3

- Converter sem abrir o Photoshop, usando a **imagem composta** do PSD, mesma resolução e DPI.
- Melhor resultado com PSD salvo com **"Maximizar compatibilidade"**. Sem a imagem composta, montar pelas camadas e **avisar** que efeitos/ajustes podem diferir.
- Biblioteca candidata: **ag-psd** (MIT). PDF gerado com **pdf-lib** (MIT).
- Página do PDF = tamanho físico do documento (pixels ÷ DPI).
- **Cores:** manter o modo original. Se o PSD for CMYK, embutir em **DeviceCMYK** sem passar por RGB (verificar na Etapa 4 se a biblioteca expõe os dados CMYK crus; se não expuser, documentar e escolher alternativa).
- Suportar PSB (arquivos grandes) apenas se a biblioteca suportar com segurança; caso contrário, avisar.

### 2.4 Ferramentas extras

PDF: juntar, separar, extrair páginas, girar, **cortar**, comprimir, PDF → imagem (PNG/JPG, DPI escolhido).

**Cortar PDF** (pedido do usuário em 2026-11-11):

- Mostrar a página (renderizada com pdf.js) e deixar o usuário **desenhar a área de corte** com o mouse, com ajuste fino pelas bordas e campos numéricos (mm).
- Escolher onde aplicar: **só nesta página** ou **em todas as páginas** do documento.
- O corte redefine as caixas da página (`MediaBox` e `CropBox`, e `TrimBox`/`BleedBox` quando existirem), **sem rasterizar**: vetores, textos e imagens continuam como estão.
- Limitação a deixar clara na interface: o conteúdo fora da área fica **escondido, não apagado** (continua dentro do arquivo). Apagar de verdade exigiria reescrever o conteúdo da página; fica como possível melhoria.
- Conferir no CorelDRAW 27 se a importação respeita o corte (teste manual da Etapa 5).
  Imagens: converter JPG/PNG/WebP, redimensionar, imagens → PDF.

### 2.5 Cores e CMYK

- Padrão: **manter cores originais**.
- Opção **"Converter para CMYK"** quando fizer sentido.
- Perfil: **FOGRA39**, usando o **ISO Coated v2 (ECI)** (baseado em FOGRA39, distribuição livre; o "Coated FOGRA39" da Adobe tem restrições de redistribuição). Conferir a licença do perfil e guardar o texto dela no repositório.
- Motor: **Little CMS (lcms2)** em WebAssembly. Intenção de renderização padrão: colorimétrica relativa com compensação de ponto preto (configurável).

### 2.6 Fora do escopo

Arquivos `.cdr` (inclusive salvar `.cdr` em versão mais antiga: formato fechado, sem biblioteca livre que grave; alternativa avaliada é uma macro do próprio CorelDRAW, como projeto à parte); Word → PDF fiel; PDF → Word editável.

---

## 3. Modelo de segurança

### 3.1 O que estamos protegendo

- Os **arquivos dos clientes** (não podem vazar).
- Os **3 computadores** (nenhum arquivo malicioso pode executar código).
- A **conta GitHub e Cloudflare** (ninguém pode publicar uma versão adulterada do app).

### 3.2 Riscos e defesas

| Risco                                                             | Defesa                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquivo malicioso (PDF/PSD/imagem) explorando falha de biblioteca | Processar em **Web Workers** (um por tarefa, encerrado ao final); bibliotecas atualizadas; WASM (sandbox); limites de tamanho/tempo; pdf.js com `isEvalSupported: false` e versão ≥ 4.2.67 (corrige CVE-2024-4367); nunca executar JavaScript de PDF |
| Injeção de HTML pelo nome do arquivo ou metadados                 | Nunca usar `innerHTML` com dados de arquivo; usar `textContent`/JSX; CSP estrita; regras de lint que proíbem HTML montado com string                                                                                                                 |
| Dependência npm adulterada (cadeia de suprimentos)                | Poucas dependências; versões **fixas** com `package-lock.json`; `npm ci`; scripts de instalação desativados; só versões com ≥ 14 dias; `npm audit` e Dependabot (com espera de 7 dias); Actions fixadas por SHA                                      |
| Modelo de IA adulterado                                           | Baixar de **revisão fixa (commit)** do Hugging Face; conferir **SHA-256** antes de usar e guardar; usar só formato **ONNX** (nunca `.pt`/pickle, que pode executar código)                                                                           |
| Alguém publicar versão adulterada do app                          | GitHub e Cloudflare com **2FA**; repositório privado; branch principal protegida; deploy só pela branch principal                                                                                                                                    |
| Vazamento de arquivos para a internet                             | Sem analytics/CDN; CSP com `connect-src` restrito; nenhum `fetch` para fora exceto o modelo; testes ponta a ponta reprovam qualquer requisição externa                                                                                               |
| Terceiros usando o app pelo link                                  | Sem risco aos dados (tudo é local), mas opcionalmente proteger com **Cloudflare Access** (seção 8.4)                                                                                                                                                 |
| Versão antiga presa em cache (bugs "fantasmas")                   | Service worker com aviso "Nova versão disponível"; limpeza de caches antigos; arquivos com hash no nome; `sw.js` sem cache HTTP                                                                                                                      |
| Travamento por arquivo enorme                                     | Limites configuráveis, leitura em streaming quando possível, avisos claros, botão cancelar, tempo-limite por tarefa                                                                                                                                  |

### 3.3 Cabeçalhos de segurança (arquivo `public/_headers` do Cloudflare Pages)

Em vigor desde a Etapa 1 (ver o arquivo). Aplicados também no `vite preview` por `scripts/vite-plugin-headers.ts`, e verificados por testes unitários e ponta a ponta.

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://huggingface.co https://*.hf.co; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
  Cross-Origin-Resource-Policy: same-origin

/sw.js
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Notas:

- `COOP` + `COEP` habilitam _cross-origin isolation_ (`crossOriginIsolated === true`, conferido nos testes), necessária para WASM com múltiplas threads (ONNX Runtime). Verificar na Etapa 3 que o download do modelo continua funcionando com `credentialless`; se não, ajustar e documentar.
- `connect-src` (Etapa 3): `https://huggingface.co` (endereço do modelo) e `https://*.hf.co` (o Hugging Face redireciona os arquivos grandes para a CDN, ex.: `us.aws.cdn.hf.co`, que muda por região). `*.huggingface.co` foi retirado. O download funciona com `credentialless` (sem cookies: `credentials: 'omit'`).
- Sem `unsafe-inline` e sem `unsafe-eval`. Fontes, ícones e estilos ficam **dentro do projeto**.

---

## 4. Stack técnica

| Função                  | Escolha                                                                            | Versão                            | Licença                   | Situação                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| Base                    | **Vite + TypeScript (strict)**                                                     | 8.3.5 / 6.0.3                     | MIT / Apache 2.0          | Em uso (Etapa 1)                                                     |
| Interface               | **Preact** (JSX pelo próprio Vite, sem Babel)                                      | 11.1.0                            | MIT                       | Em uso                                                               |
| PWA                     | `vite-plugin-pwa` (Workbox) + `workbox-window`                                     | 2.0.0 / 7.4.1                     | MIT                       | Em uso                                                               |
| Fonte                   | Exo 2 (`@fontsource-variable/exo-2`), embutida                                     | 5.3.0                             | OFL 1.1                   | Em uso (provisória até o design)                                     |
| Testes                  | **Vitest** + **Playwright** (Google Chrome)                                        | 5.0.5 / 1.64.1                    | MIT / Apache 2.0          | Em uso                                                               |
| Qualidade               | **ESLint** + typescript-eslint + no-unsanitized + **Prettier**                     | 10.13.0 / 8.72.1 / 4.1.5 / 3.9.10 | MIT / MIT / MPL 2.0 / MIT | Em uso                                                               |
| Reparo/reescrita de PDF | **qpdf** compilado por nós para WASM (`scripts/qpdf-wasm/`, workflow `qpdf-wasm`)  | 12.4.2 (Emscripten 6.0.13)        | Apache 2.0                | Em uso (Etapa 2). Binário em `vendor/qpdf/`, SHA-256 conferido no CI |
| Manipular PDF           | **pdf-lib**                                                                        | —                                 | MIT                       | Etapas 4–5                                                           |
| Renderizar PDF          | **pdf.js** (`pdfjs-dist`), em worker aninhado, sem fontes do sistema e sem scripts | 6.4.299                           | Apache 2.0                | Em uso (Etapa 2: conferência visual)                                 |
| Ler PSD                 | **ag-psd**                                                                         | —                                 | MIT                       | Etapa 4                                                              |
| IA                      | **ONNX Runtime Web** + BiRefNet ONNX                                               | —                                 | MIT                       | Etapa 3                                                              |
| CMYK                    | **lcms2 em WASM**                                                                  | —                                 | MIT                       | Etapa 7                                                              |

**Evitar** bibliotecas **AGPL** (ex.: MuPDF.js, Ghostscript WASM), a não ser que o usuário aprove depois de entender as obrigações da licença.

---

## 5. Estrutura de pastas

```
conversor-grafix/
├─ .github/
│  ├─ workflows/ci.yml         # audit, formatação, lint, testes, build, e2e
│  └─ dependabot.yml
├─ docs/
│  └─ ESPECIFICACAO.md         # este documento
├─ public/
│  ├─ _headers                 # cabeçalhos de segurança (Cloudflare Pages)
│  ├─ icons/                   # ícones do PWA (gerados por scripts/)
│  └─ profiles/                # perfil ICC + licença (Etapa 7)
├─ scripts/                    # ícones, cabeçalhos no preview, compilação do qpdf WASM, PDFs de teste
├─ vendor/qpdf/                # qpdf compilado (gerado pelo workflow qpdf-wasm; hashes em BUILD-INFO)
├─ src/
│  ├─ assets/                  # logos e símbolos oficiais (tema escuro e claro)
│  ├─ styles/                  # tokens de cor, temas claro/escuro
│  ├─ components/              # menu lateral, área de soltar, lista de arquivos, ícones
│  ├─ pages/                   # tela de ferramenta e tela "Sobre"
│  ├─ tools/                   # registro das ferramentas, fila de arquivos; uma pasta por ferramenta (Etapa 2+)
│  ├─ workers/                 # um worker por tarefa pesada + runtime comum
│  ├─ lib/                     # código da página (tema, download, PWA, execução de workers)
│  │  └─ shared/               # código que roda na página E nos workers (sem DOM)
│  ├─ app.tsx
│  └─ main.tsx
├─ tests/
│  ├─ unit/
│  ├─ e2e/
│  └─ samples/                 # arquivos de teste (sem dados sensíveis de clientes)
├─ THIRD_PARTY_LICENSES.md
├─ SECURITY.md
├─ README.md
├─ index.html
├─ vite.config.ts
├─ playwright.config.ts
├─ eslint.config.js
├─ tsconfig*.json              # app (DOM), worker (WebWorker), node (ferramentas)
└─ package.json
```

---

## 6. Requisitos gerais (valem para todas as ferramentas)

### 6.1 Arquivos de entrada

- Validar o tipo pelo **conteúdo** (assinatura do arquivo), não só pela extensão. _(Etapa 1: `src/lib/shared/file-type.ts`.)_
- Limites configuráveis (tamanho em MB, megapixels, número de páginas) com mensagem clara. _(Etapa 1: `src/lib/shared/limits.ts`.)_
- Nunca modificar o original; saída sempre em arquivo novo.

### 6.2 Arquivos de saída

- Nome derivado do original, **sanitizado** (remover caracteres inválidos no Windows: `\ / : * ? " < > |`, caracteres de controle, controles de direção de texto, nomes reservados; limitar tamanho). _(Etapa 1: `src/lib/shared/file-name.ts`.)_
- Download via `Blob` + `URL.createObjectURL`, sempre com `URL.revokeObjectURL` depois. _(Etapa 1: `src/lib/download.ts`.)_

### 6.3 Desempenho e estabilidade

- Todo processamento pesado em **Web Worker**, com **progresso** e **cancelar**. _(Etapa 1: `src/lib/run-worker-task.ts` + `src/workers/runtime.ts`.)_
- Transferir buffers (`Transferable`) em vez de copiar.
- Liberar memória entre arquivos; testar com arquivos grandes.
- Erros sempre tratados e mostrados em português claro, com detalhe técnico recolhível. Nenhum erro silencioso. _(Etapa 1: `src/lib/shared/errors.ts`; mensagem na linha do arquivo em `src/components/file-list.tsx`.)_

### 6.4 Modelo de IA (única conexão externa)

- URL com **revisão fixa** (commit) do Hugging Face, nunca `main`.
- Conferir **SHA-256** do arquivo baixado contra o valor gravado no código; se não bater, descartar e avisar.
- Guardar em cache local (Cache API ou OPFS) para baixar uma vez por computador.
- Botão em "Configurações" para **apagar o modelo** do cache e baixar de novo.
- Mostrar o tamanho do download e pedir confirmação no primeiro uso.

### 6.5 Interface

- Acessível por teclado, foco visível, contraste adequado nos dois temas.
- Nada de bloquear a interface durante o processamento.

---

## 7. Interface e identidade visual

- **Tema escuro padrão**, botão para o claro, escolha salva no navegador (com `try/catch`).
- **Logo da Grafix** (fornecido pelo usuário): "G" preto com lateral 3D branca e rastros ciano, magenta e amarelo; "GRAFIX DIGITAL" em **branco**; subtítulo "GRÁFICA E COMUNICAÇÃO VISUAL" em ciano.
  - `src/assets/logo-grafix-dark.png`: original, para o tema escuro.
  - `src/assets/logo-grafix-light.png`: versão **oficial** para fundo claro, fornecida pelo usuário.
  - `src/assets/symbol-grafix-dark.png` e `symbol-grafix-light.png`: só o símbolo ("G" com rastros), oficiais, para fundo escuro e claro. Usados para gerar os ícones do PWA.
- **Paleta** (do logo): ciano `#00B9F2` (destaque principal), magenta `#EC008C`, amarelo `#FFF200`, preto `#000000`. Definida em `src/styles/tokens.css`, com tons neutros para fundos e textos nos dois temas.
- Layout **escolhido pelo usuário (direção A, "bancada")**: menu lateral fixo com o nome de cada ferramenta, agrupadas por assunto (Corel, Imagem, PDF); no topo da área principal, título e uma linha explicando o que a ferramenta faz; opções da ferramenta logo abaixo; área grande de arrastar e soltar (vários arquivos); abaixo dela, a lista de arquivos com progresso, cancelar e baixar. Motivo da escolha: "simples, não é complicado e qualquer um consegue entender".
- Visual com identidade própria, sem cara de site genérico, sem excesso de elementos.
- Ícone do PWA: símbolo oficial para fundo escuro sobre fundo escuro, gerado por `scripts/generate-brand-assets.py`.
- Tela "Sobre" com versão do app, licenças de terceiros e o aviso de que nenhum arquivo sai do computador.

---

## 8. Contas, repositório e hospedagem

### 8.1 Antes de começar (feito pelo usuário)

1. Ativar **verificação em duas etapas (2FA)** no GitHub e na Cloudflare.
2. Criar repositório **privado** `conversor-grafix` no GitHub. ✅ (`gtkzinn1/conversor-grafix`)

### 8.2 Repositório

- Branch principal `main` **protegida**: exigir CI verde antes de mesclar; proibir _force push_.
- Ativar **Dependabot alerts**, **Dependabot security updates** e **secret scanning**.
- O projeto **não usa segredos** (sem chaves de API). Nunca commitar `.env` com dados reais.
- Commits assinados como `gtkzinn1 <344027690+gtkzinn1@users.noreply.github.com>` (e-mail "noreply" do GitHub, para não expor o e-mail pessoal no histórico).

### 8.3 Cloudflare Pages

- Projeto ligado ao repositório: build `npm ci && npm run build`, saída `dist`, versão de Node fixada em `.node-version` (24).
- Limites do plano gratuito (conferir em https://developers.cloudflare.com/pages/platform/limits): até 100 projetos por conta, 500 builds/mês, 20.000 arquivos por site, **25 MiB por arquivo**.
- **Previews** de outras branches: desativar ou proteger com Access, para não ficarem públicas.
- Endereço: `conversor-grafix.pages.dev` (ou subdomínio próprio).

### 8.4 Acesso restrito (opcional, recomendado)

- **Cloudflare Access** (Zero Trust, plano gratuito) para permitir só o e-mail do usuário, com código por e-mail. Testar se a instalação do PWA e o uso offline continuam funcionando; documentar o resultado.

### 8.5 Instalação nos 3 computadores

Abrir o endereço no Chrome → ícone de instalar na barra de endereço → **Instalar**. O app abre em janela própria e se atualiza com aviso quando houver versão nova.

---

## 9. Testes e verificação

### 9.1 Automáticos (rodam no CI a cada envio)

- `tsc` (três projetos: app, workers, ferramentas), ESLint, Prettier (verificação).
- **Vitest**: tokenizador de content stream, avaliação de funções de degradê, sanitização de nomes, detecção de tipo, limites, erros, execução de workers, cabeçalhos, conversões de cor.
- **Playwright** (Google Chrome, contra a build de produção com os cabeçalhos reais): abrir o app, arrastar arquivo de teste, baixar resultado, conferir tema, conferir offline, conferir que não há erros nem violações de CSP no console e que **nenhuma requisição externa** acontece (exceto o modelo, quando testado).
- `npm audit --audit-level=high` sem falhas.
- Build de produção sem avisos.

### 9.2 Conjunto de arquivos de teste (`tests/samples/`)

Gerados por `scripts/samples/generate_samples.py` (sintéticos, sem dados de clientes). Arquivos reais de clientes são testados só localmente e nunca entram no repositório.

- O logo do pão de queijo (degradês com recorte).
- PDFs com: object streams (PDF 1.5+), protegido sem senha, com senha de abertura, JPEG2000, JBIG2, várias páginas, Form XObjects, padrões de degradê, fontes embutidas, transparência, arquivo corrompido, arquivo vazio, arquivo que não é PDF com extensão `.pdf`.
- PSDs: RGB, CMYK, com e sem "Maximizar compatibilidade", grande.
- Imagens: JPG, PNG com transparência, WebP, muito grande, cabelo/pelo para recorte.
- Usar apenas arquivos sem dados sensíveis, ou com autorização.

### 9.3 Validação do PDF corrigido (antes de liberar o download)

- Abre sem erro no verificador do qpdf (`--check`).
- Mesmo número de páginas e mesmas dimensões.
- **Comparação visual**: renderizar original e corrigido com pdf.js (360 px de largura, até 50 páginas) e comparar pixels; diferença acima do limite gera aviso. Limites em `src/tools/pdf-corel/pixel-diff.ts`: 0,5% dos pixels na correção básica; 95% na de degradês (fundos inteiros em degradê viram cor sólida, então a diferença pode ser grande; só uma página quase toda diferente indica problema). Se a renderização falhar, o arquivo é liberado com aviso, pois já passou nas conferências do qpdf.
- Versão do PDF e ausência de JavaScript/ações conferidas.

### 9.4 Testes manuais (com o usuário)

- Importar os PDFs corrigidos no **CorelDRAW 27** e conferir vetores, textos e cores.
- Instalar o app nos 3 computadores, testar offline, testar atualização.

---

## 10. Passo a passo de construção

Cada etapa segue o mesmo ciclo: **planejar → implementar → testar → revisar (código e segurança) → apresentar ao usuário → aguardar o próximo comando.**

### Etapa 1 — Fundação

1. Criar projeto Vite + TypeScript strict; configurar ESLint, Prettier, Vitest, Playwright.
2. Configurar `vite-plugin-pwa` (manifest, ícones, service worker com aviso de atualização e limpeza de caches antigos).
3. Criar `public/_headers` (seção 3.3) e testar no navegador que a CSP não bloqueia nada do app.
4. Layout base: menu lateral, área de soltar arquivos, temas escuro/claro, logos (incluindo a versão clara criada), tela "Sobre". **Depende da escolha do usuário entre mockups.**
5. Infraestrutura comum: workers, progresso, cancelar, tratamento de erros, sanitização de nomes, limites de arquivo.
6. CI no GitHub Actions + Dependabot; README, SECURITY.md, THIRD_PARTY_LICENSES.md.

**Aceite:** app abre, instala no Chrome, funciona offline (casca), temas funcionam, CI verde, zero erros no console, cabeçalhos de segurança ativos.

### Etapa 2 — Corrigir PDF para o Corel

1. Avaliar e integrar qpdf WASM (preferir build próprio reprodutível).
2. Correção básica (seção 2.1a), incluindo remoção de conteúdo ativo.
3. Tokenizador de content stream + avaliador de funções + substituição de degradês (seção 2.1b).
4. Validação da saída (seção 9.3).
5. Testes com todo o conjunto da seção 9.2.

**Aceite:** todos os PDFs de teste processados sem travar; logo do pão de queijo com todos os desenhos visíveis no Corel 27 (teste manual do usuário); vetores preservados.

### Etapa 3 — Remover fundo

1. Testar variantes BiRefNet ONNX nos computadores do usuário; escolher e registrar.
2. Download com revisão fixa + SHA-256 + cache; tela de confirmação do download.
3. Inferência em worker (WebGPU → WASM), máscara em resolução original, refinamento de borda.
4. Editor de pincel com desfazer/refazer; exportar PNG.
5. Ajustar `connect-src` com os domínios exatos necessários.

**Aceite:** recorte funciona com e sem WebGPU; hash verificado; offline após o primeiro download; editor estável com imagens grandes.

### Etapa 4 — PSD → PDF

1. Validar ag-psd (CMYK, memória, imagem composta).
2. Conversão mantendo modo de cor e DPI; avisos quando faltar imagem composta.

**Aceite:** PSD RGB e CMYK geram PDF correto, com tamanho físico certo; CMYK mantido.

### Etapa 5 — Ferramentas de PDF

Juntar, separar, extrair, girar, cortar (seção 2.4), comprimir, PDF → imagem. **Aceite:** testes automáticos para cada uma; resultado abre no Corel e em leitores comuns.

### Etapa 6 — Ferramentas de imagem

JPG/PNG/WebP, redimensionar, imagens → PDF. **Aceite:** transparência preservada onde o formato permite; qualidade configurável.

### Etapa 7 — CMYK (FOGRA39)

Integrar lcms2 WASM e o perfil ISO Coated v2 (ECI) nas ferramentas aplicáveis. **Aceite:** conversões conferidas com valores de referência.

### Etapa 8 — Revisão final e publicação

1. Revisão completa de código e de segurança (checklist da seção 12).
2. Publicar no Cloudflare Pages; configurar Access (se aprovado).
3. Instalar nos 3 computadores; teste offline; teste de atualização.

**Aceite:** checklist 100% cumprido e aprovado pelo usuário.

---

## 11. Registro de decisões

Atualizar a cada decisão técnica relevante.

| Data       | Decisão                                                                                                     | Motivo                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-10 | PWA hospedado no Cloudflare Pages                                                                           | Instalação simples, atualização automática, sem alerta de antivírus                                                                                                                                                                                                      |
| 2026-11-10 | BiRefNet (MIT) para remover fundo; RMBG-2.0 descartado                                                      | Melhor gratuito com licença livre; RMBG-2.0 é só não comercial                                                                                                                                                                                                           |
| 2026-11-10 | Degradês com recorte + `sh` trocados por cor média                                                          | Causa confirmada do sumiço de desenhos no Corel                                                                                                                                                                                                                          |
| 2026-11-10 | CMYK com ISO Coated v2 (ECI) / FOGRA39                                                                      | Padrão comum no Brasil e perfil de distribuição livre                                                                                                                                                                                                                    |
| 2026-11-11 | Política de versões: só versões estáveis com ≥ 14 dias de publicadas; versões exatas; `ignore-scripts=true` | Reduz risco de pacote adulterado recém-publicado e de scripts de instalação maliciosos                                                                                                                                                                                   |
| 2026-11-11 | Preact 11 para a interface, com JSX compilado pelo próprio Vite (sem `@preact/preset-vite`)                 | Componentes sem `innerHTML` (texto escapado por padrão); o preset traria Babel e +10 dependências sem necessidade                                                                                                                                                        |
| 2026-11-11 | TypeScript 6.0.3 (e não 7.x)                                                                                | typescript-eslint 8.72 só suporta TypeScript < 6.1                                                                                                                                                                                                                       |
| 2026-11-11 | Três `tsconfig` (app/DOM, workers/WebWorker, ferramentas/Node)                                              | Os tipos de DOM e de Worker conflitam; código comum fica em `src/lib/shared`, sem DOM                                                                                                                                                                                    |
| 2026-11-11 | `overrides`: `minimatch` 11.0.8 e `glob` 14.0.4                                                             | Corrigem alertas moderados em ferramentas de build (ESLint, workbox-build); build e testes conferidos                                                                                                                                                                    |
| 2026-11-11 | Alerta baixo do `deepmerge` aceito e documentado em SECURITY.md                                             | Só na build, com configuração própria; ainda sem correção publicada. Alternativa (service worker escrito à mão) avaliada e preterida                                                                                                                                     |
| 2026-11-11 | Um worker por tarefa, encerrado ao final; mensagens validadas nos dois sentidos                             | Isolamento por arquivo, memória liberada, cancelamento imediato (`terminate`)                                                                                                                                                                                            |
| 2026-11-11 | `_headers` aplicado também no `vite preview`                                                                | Testes ponta a ponta rodam com a CSP real de produção                                                                                                                                                                                                                    |
| 2026-11-11 | Testes ponta a ponta no Google Chrome instalado (`channel: 'chrome'`)                                       | É o navegador usado na Grafix; dispensa baixar navegadores do Playwright                                                                                                                                                                                                 |
| 2026-11-11 | Fonte Exo 2 embutida (só latim no cache offline)                                                            | Identidade próxima ao logo, sem CDN; provisória até a definição do design                                                                                                                                                                                                |
| 2026-11-11 | Logo claro e ícones gerados por script (provisórios)                                                        | Reprodutível; o usuário enviará a versão oficial do logo para fundo branco                                                                                                                                                                                               |
| 2026-11-11 | `bluetooth=()` removido do `Permissions-Policy`                                                             | O Chrome para Linux não reconhece o recurso e emite aviso no console (reprovava o CI). O app não usa Bluetooth e a CSP já impede scripts injetados                                                                                                                       |
| 2026-11-11 | Fluxo de trabalho: uma branch e um PR por etapa                                                             | Testes rodam antes de entrar na `main`; histórico organizado (portfólio). No plano gratuito do GitHub a proteção de branch não é aplicada em repositório privado, então a regra é seguida por disciplina                                                                 |
| 2026-11-11 | Layout A ("bancada"): menu lateral com nomes + área de soltar + lista de arquivos                           | Escolhido pelo usuário entre 3 mockups (bancada, marcas de registro, fila)                                                                                                                                                                                               |
| 2026-11-11 | Nova ferramenta: cortar PDF por área, na página atual ou no documento inteiro                               | Pedido do usuário; feito redefinindo as caixas da página, sem rasterizar                                                                                                                                                                                                 |
| 2026-11-11 | Logo claro e símbolos oficiais substituem os gerados                                                        | Fornecidos pelo usuário; o script passa a gerar só os ícones, a partir do símbolo                                                                                                                                                                                        |
| 2026-11-11 | Causa do "arquivo danificado" com PDFs do Canva: árvore de estrutura de acessibilidade                      | Teste no CorelDRAW 27 com variantes isoladas: só importaram as que removiam `/StructTreeRoot` (suspeita: `/Limits` na raiz do `ParentTree`, proibido pela especificação PDF). Retângulos com opacidade 0, origem da página, XMP, OutputIntent e sumário não eram a causa |
| 2026-11-11 | qpdf 12.4.2 compilado por nós com Emscripten 6.0.13 no GitHub Actions                                       | Pacotes prontos no npm eram de um mantenedor só e com binário não auditável. Fonte conferida pelo SHA-256 assinado; imagem fixada por digest; build reproduzível (o `.wasm` saiu idêntico em duas compilações)                                                           |
| 2026-11-11 | qpdf compilado também para Node (`ENVIRONMENT=worker,node`)                                                 | Os testes automáticos rodam a correção completa com o mesmo binário do app                                                                                                                                                                                               |
| 2026-11-11 | Correções feitas sobre o JSON v2 do qpdf (`--json-output` / `--update-from-json`)                           | O qpdf cuida do formato (leitura, reparo, decriptação, escrita); o nosso código cuida só da lógica, testável sem navegador                                                                                                                                               |
| 2026-11-11 | Troca de degradês preserva o estado gráfico                                                                 | Se o `sh` fecha o bloco (`Q` em seguida), usa a técnica validada (cor + caminho + `f`); se há desenho depois, preenche isolado (`q … Q`) e mantém o recorte, para não mudar o que vem depois                                                                             |
| 2026-11-11 | pdf.js 6.4.299 em worker aninhado, para a conferência visual                                                | Carregado no mesmo worker, o pdf.js se registra no canal de mensagens do app; isolado, não interfere. Sem `eval` (a opção `isEvalSupported` deixou de existir na versão 6)                                                                                               |
| 2026-11-11 | Limite de 4096 caracteres por token no leitor de conteúdo                                                   | Evita estouro de pilha com arquivos hostis                                                                                                                                                                                                                               |
| 2026-11-11 | Na opção de degradês, nenhum degradê fica no arquivo: todos viram cor sólida                                | Teste no Corel 27: só importou a variante sem nenhum `sh`; o usuário prefere cor sólida a arriscar o erro. Amostras do original ficam numa página extra (ver abaixo)                                                                                                     |
| 2026-11-11 | Imagens embutidas (BI…EI) viram imagens normais                                                             | Rodada 7: o Corel 27 recusou todas as variantes com imagem embutida; sem ela, importou                                                                                                                                                                                   |
| 2026-11-11 | Degradês originais numa página de amostras no fim, em recorte + `sh`                                        | Rodada 8: recorte + `sh` importou como degradê editável; o mesmo degradê como padrão (`scn`) foi recusado                                                                                                                                                                |
| 2026-11-11 | ONNX Runtime Web 1.31.1, build JSPI, com os arquivos servidos pelo próprio app                              | O `.wasm` JSPI (17,9 MB) cabe no limite de 25 MiB por arquivo do Cloudflare Pages; sem CDN. A CSP atual basta (o `new Function` do embind não é chamado)                                                                                                                 |
| 2026-11-11 | Modelo padrão: BiRefNet_512x512 fp32 no processador (WASM)                                                  | Teste nos computadores: 1024 px no WASM estoura os 4 GB (`bad_alloc`); no WebGPU da placa AMD GCN-4 um `GatherND` leva ~13 s e o Windows reinicia a placa (TDR). O 512 roda em qualquer computador (~7 s com 4 threads). Os modelos de placa ficam como opção            |
| 2026-11-11 | Divisão de nós `Split`/`Concat` do grafo antes de rodar no WebGPU                                           | O BiRefNet tem nós com mais buffers que o `maxStorageBuffersPerShaderStage` de placas comuns (16); a divisão mantém o resultado e é testada com o ONNX Runtime no Node                                                                                                   |
| 2026-11-11 | Falha da placa de vídeo desliga o WebGPU naquele computador                                                 | Dispositivo perdido, worker encerrado ou tempo esgotado com modelo de placa: grava a preferência e volta ao processador. O usuário pode religar em “Sobre”                                                                                                               |
| 2026-11-11 | `connect-src` só com `huggingface.co` e `*.hf.co`                                                           | Hosts vistos no download real (redirecionamento para `*.cdn.hf.co`); `*.huggingface.co` não é usado                                                                                                                                                                      |
| 2026-11-11 | Modelo guardado no OPFS (sistema de arquivos privado do site), não na Cache API                             | No teste real, o Chrome recusou `cache.put` acima de algumas centenas de MB (“Unexpected internal error”); o OPFS gravou e leu 940 MB. O SHA-256 é conferido no download e a cada carga                                                                                  |

---

## 12. Checklist de revisão (aplicar ao fim de cada etapa)

**Código**

- [ ] TypeScript strict sem erros; lint e formatação ok.
- [ ] Sem `any` desnecessário, sem código morto, sem `console.log` esquecido.
- [ ] Todos os erros tratados e mostrados ao usuário.
- [ ] Testes novos cobrindo a etapa; todos passando.

**Segurança**

- [ ] Nenhum `innerHTML`, `eval`, `new Function` ou HTML montado com dados de arquivo.
- [ ] Nenhuma requisição externa nova (conferido no Playwright).
- [ ] CSP sem novas exceções (ou exceção justificada e registrada).
- [ ] Dependências novas avaliadas (manutenção, licença, vulnerabilidades) e com versão fixa.
- [ ] `npm audit` limpo.
- [ ] Processamento de arquivos em worker, com limites.

**Uso**

- [ ] Funciona offline (exceto primeiro download do modelo).
- [ ] Funciona nos temas escuro e claro.
- [ ] Testado com arquivos grandes e com arquivos inválidos.
- [ ] Mensagens em português claro.

---

## Apêndice A — Script de referência (Python) usado no diagnóstico

Serve **apenas como referência** da técnica validada. O app deve usar a implementação robusta descrita na seção 2.1b (tokenizador, sem regex). Requer `qpdf` (com `fix-qdf`) e `pikepdf`.

```bash
qpdf --qdf --object-streams=disable "entrada.pdf" q.pdf
python3 fix.py "entrada.pdf" q.pdf mod.pdf
fix-qdf mod.pdf > mod2.pdf
qpdf --object-streams=disable --compress-streams=y --recompress-flate mod2.pdf "saida (corel).pdf"
```

```python
# fix.py — troca "caminho W|W* n [cm] /ShNN sh" por cor sólida + preenchimento.
# No teste foi aplicado só ao boneco da direita (filtro por posição, omitido aqui).
import re, sys, pikepdf

src, qdf, out = sys.argv[1:4]
pdf = pikepdf.open(src)
shadings = pdf.pages[0].Resources.Shading

def ev(f, t):
    ft = int(f.FunctionType)
    if ft == 2:
        c0 = [float(x) for x in f.get('/C0', [0])]
        c1 = [float(x) for x in f.get('/C1', [1])]
        n = float(f.N)
        return [a + (t ** n) * (b - a) for a, b in zip(c0, c1)]
    if ft == 3:
        d0, d1 = [float(x) for x in f.Domain]
        B = [float(x) for x in f.Bounds]
        E = [float(x) for x in f.Encode]
        edges = [d0] + B + [d1]
        k = len(B)
        for i, bv in enumerate(B):
            if t < bv:
                k = i
                break
        a, b = edges[k], edges[k + 1]
        e0, e1 = E[2 * k], E[2 * k + 1]
        tt = e0 + (t - a) * (e1 - e0) / (b - a) if b > a else e0
        return ev(f.Functions[k], tt)
    raise Exception(f'FunctionType {ft} não suportado')

def average_color(n):
    f = shadings['/Sh%d' % n].Function
    s = [ev(f, i / 200) for i in range(201)]
    return [sum(c[j] for c in s) / len(s) for j in range(len(s[0]))]

b = open(qdf, 'rb').read().decode('latin1')
pat = re.compile(r'(W\*?)\nn\n(?:[-\d. ]+ cm\n)?/Sh(\d+) sh\n')
parts, last = [], 0
for m in pat.finditer(b):
    q = b.rfind('\nq\n', 0, m.start()) + 3
    lines = b[q:m.start()].strip('\n').split('\n')
    c = average_color(int(m.group(2)))      # CMYK neste arquivo
    i = 0
    while lines[i].split()[-1] == 'cm':
        i += 1
    new = lines[:i] + ['%.4f %.4f %.4f %.4f k' % tuple(c)] + lines[i:] + \
          ['f*' if m.group(1) == 'W*' else 'f']
    parts.append(b[last:q])
    parts.append('\n'.join(new) + '\n')
    last = m.end()
parts.append(b[last:])
open(out, 'wb').write(''.join(parts).encode('latin1'))
```

Resultado do teste: 22 degradês do boneco da direita (nos dois logos) trocados por **C0 M100 Y100 K17**; restante intacto; saída PDF 1.3, 100% vetorial.
