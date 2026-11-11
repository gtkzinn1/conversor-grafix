# Conversor Grafix — instruções para o Claude

Regras do projeto, escopo, stack e etapas: `docs/ESPECIFICACAO.md` (seções 0 e 10). Não repetir aqui o que já está lá; apontar para ela.

## Respostas
- Curtas e diretas, em português. Sem abertura elogiosa, sem fecho de cortesia, sem emojis.
- Não repetir o plano nem recapitular o que já foi dito.
- Não chutar APIs, versões, flags ou nomes de pacote: conferir no código ou na documentação.

## Leitura e comandos
- Não reler arquivo já lido nem recém-editado. Ler só o trecho necessário (offset/limit, grep).
- Nunca rodar comando que espere entrada (ex.: `cat >` sem heredoc, prompts interativos).
- Comandos longos em segundo plano, sem polling.

## Testes
- Durante o trabalho: só os testes ligados ao que mudou (`npx vitest run <arquivo>`, `npx playwright test <arquivo>`).
- Bateria completa só antes de commit/PR: `npm run lint`, `npx tsc -b`, `npx vitest run`, `npm run build`, `npx playwright test`.

## Etapas e git
- Cada etapa da seção 10 começa numa sessão nova; especificação, commits e memória guardam o andamento.
- Aguardar o comando do usuário antes de cada etapa.
- Branch + PR por etapa; merge só depois do "está bom". Commits no padrão Conventional Commits, em português.
