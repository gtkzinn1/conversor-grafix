# Andamento do projeto (recapitulação)

Resumo para retomar o trabalho em qualquer computador. Detalhes técnicos e decisões: `docs/ESPECIFICACAO.md` (seções 10 e 11). Regras para o Claude: `CLAUDE.md`.

Atualizado em 2026-11-12.

## Situação das etapas

| Etapa                         | Situação               | Onde   |
| ----------------------------- | ---------------------- | ------ |
| 1. Fundação                   | Pronta                 | PR #5  |
| 2. Corrigir PDF para o Corel  | Pronta                 | PR #6  |
| 3. Remover fundo              | Pronta                 | PR #9  |
| 4. PSD → PDF                  | **Removida** do escopo | PR #10 |
| 5. Ferramentas de PDF         | Pronta                 | PR #11 |
| 6. Ferramentas de imagem      | Pendente               | —      |
| 7. CMYK (FOGRA39)             | Pendente               | —      |
| 8. Revisão final e publicação | Pendente               | —      |

## O que já funciona

- **Corrigir PDF para o Corel:** resolve o "arquivo danificado" dos PDFs do Canva (remove a árvore de estrutura de acessibilidade), reescreve em PDF 1.4, remove conteúdo ativo, externaliza imagens embutidas (BI…EI) e troca degradês por cor sólida, com os degradês originais numa página de amostras no fim. Tudo via qpdf compilado para WebAssembly. Testado no CorelDRAW 27.
- **Remover fundo:** BiRefNet 512 no processador (WASM) por padrão, 897 MB baixados uma vez por computador (revisão fixa + SHA-256, guardado no OPFS). Modelos de 1024 px na placa de vídeo como opção em "Sobre"; se a placa travar, volta sozinho para o processador. Fila de imagens e editor (Apagar, Restaurar, desfazer, zoom, Baixar PNG). Recorte de 24 MP em ~34 s.
- **Editar PDF:** juntar (ordem ajustável), separar (ZIP), extrair e girar por miniaturas, cortar desenhando a área (só a página ou todas; redefine as caixas, sem rasterizar), comprimir (imagens em JPEG ou sem perda) e PDF → imagem (PNG/JPG, 150–600 DPI). Testado no CorelDRAW 27.
- **Casca do app:** PWA instalável e offline, tema claro/escuro, menu lateral (layout "bancada"), tela Sobre com licenças e o bloco "Modelo de IA".

## Pendências

- **Testar o remover fundo nos outros 2 computadores** (e o WebGPU onde houver): adiado para a Etapa 8, quando o app estiver publicado no Cloudflare Pages (basta abrir o endereço no Chrome).
- WebGPU nesta placa AMD GCN-4 trava (TDR): não usar a opção de placa de vídeo nela.

## Como trabalhamos

- **Etapas:** cada uma numa sessão nova do Claude, só depois do comando do usuário. Ao terminar, apresentar e esperar o "está bom".
- **Git:** uma branch e um PR por etapa; merge só depois do "está bom" e com o CI verde. Commits em Conventional Commits, em português. Nunca commitar direto na `main`. O repositório é portfólio: histórico e PRs organizados. O repositório é público (desde 2026-11-12), com minutos de CI ilimitados; a regra de merge é seguida por disciplina.
- **Interface:** antes de qualquer tela nova, mostrar 2–3 mockups para o usuário escolher. Interface enxuta, só o que tem função clara.
- **Segurança pragmática:** arquivos de clientes são tratados como hostis (workers, limites, CSP rígida). Ferramentas de terceiros podem ser usadas depois de avaliadas (manutenção, licença, vulnerabilidades); não descartar só por serem de terceiros.
- **Economia de tokens:** respostas curtas; só os testes do que mudou durante o trabalho (a bateria completa roda no CI); navegador manual só para o que o Playwright não cobre. Sessões até ~150 mil tokens de contexto; perto disso, registrar o andamento e abrir sessão nova.
- **Amostras de clientes** (com dados pessoais) nunca vão para o repositório; criar amostras sintéticas equivalentes em `tests/samples/`.

## Para retomar em outro computador

```bash
git clone https://github.com/gtkzinn1/conversor-grafix.git
cd conversor-grafix
npm ci
```

Se já tiver o projeto: `git checkout main` e `git pull`, depois `npm ci`. Para abrir o app: `npm run build` e `npm run preview` (endereço `http://localhost:4173`).

Para começar a próxima etapa, abrir uma sessão nova do Claude na pasta do projeto e pedir: "Etapa 5".
