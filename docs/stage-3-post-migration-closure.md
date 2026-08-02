# ETAPA 3 — VALIDAÇÃO PÓS-MIGRATION E FECHAMENTO

Data do fechamento: 02/08/2026

Migration: `20260802160000_material_checkin_checkout_stage_three.sql`

Aplicação remota: 02/08/2026 às 19:05:40 (America/Sao_Paulo, UTC-03:00)

SHA-256 aplicado: `9EA489892EA04684BA2DAE74F71E84F3134EA2FCB06FE8AC562672F95CBF2E8F`

## Resultado executivo

A Etapa 3 está tecnicamente concluída quanto à implementação, migration,
testes automatizados, testes em PostgreSQL real e promoção do schema remoto.
A única pendência específica é o E2E manual autenticado no ambiente remoto;
ele não foi marcado como executado porque esta sessão não dispunha de navegador
nem credenciais/sessão autenticada apropriada.

Não houve push Git, tag, release nem início da Etapa 4.

## 1. Pré-validação

- `supabase migration list --linked`: local e remoto alinhados até
  `20260802090000`; somente a Etapa 3 estava apenas no local.
- `supabase db push --dry-run --linked`: listou exclusivamente
  `20260802160000_material_checkin_checkout_stage_three.sql`.
- `git diff --check`: aprovado.
- Auditoria do conjunto versionável: nenhum secret, credencial ou arquivo
  temporário novo foi encontrado. `.env`, `dist`, `node_modules`, artefatos
  Tauri e `supabase/.temp` permaneceram ignorados.
- O arquivo candidato tinha última alteração em 02/08/2026 às 17:55:20; o
  relatório da Etapa 3.5 foi criado depois, às 18:16:41, e registra a mesma
  migration corrigida como aprovada em pgTAP, concorrência e atomicidade.
- O checksum foi calculado antes do teste, antes do push, durante a aplicação
  local limpa e depois do push. Permaneceu
  `9EA489892EA04684BA2DAE74F71E84F3134EA2FCB06FE8AC562672F95CBF2E8F`.
- Foi feita nova reprodução em PostgreSQL 16.14 real: bootstrap Supabase local,
  replay das 75 migrations anteriores relevantes, omissão documentada apenas
  da migration isolada de `pg_cron`/`pg_net`, aplicação do SQL candidato e
  execução das suítes da Etapa 3.
- pgTAP pré-deploy repetido no checksum candidato: 61/61 na suíte principal e
  36/36 na suíte estendida, totalizando 97/97. A suíte estendida aprovou os
  cenários de atomicidade A–D.
- A concorrência real em duas sessões, já aprovada na Etapa 3.5 para o mesmo
  arquivo, cobriu item individual, saldo quantitativo, check-in concorrente,
  cancelamento concorrente e retry idempotente do scanner.

Não foi identificada diferença material entre a migration validada na Etapa
3.5, a migration reaplicada no PostgreSQL descartável e a migration promovida.

## 2. Aplicação remota

- CLI: Supabase CLI 2.111.0.
- Comando de promoção: `supabase db push --linked`.
- A CLI aplicou exclusivamente
  `20260802160000_material_checkin_checkout_stage_three.sql`.
- Nenhuma migration antiga foi reaplicada.
- Nenhuma alteração manual de dados ou DDL foi feita fora da migration.
- Nenhum dado de teste foi criado no remoto.

## 3. Estado local e remoto

- `supabase migration list --linked`: a versão `20260802160000` consta nos dois
  lados.
- `supabase db push --dry-run --linked`: remoto atualizado, zero migrations,
  seeds ou roles pendentes.
- A geração remota de tipos confirmou as tabelas
  `material_custodias` e `material_custodia_eventos`, suas relações compostas,
  os cinco enums e as assinaturas das RPCs públicas.
- O lint remoto compilou e inspecionou as funções da Etapa 3 sem erro.

## 4. Objetos e contratos da Etapa 3

Confirmados pela aplicação transacional da migration, geração remota de tipos,
lint remoto e catálogo PostgreSQL real da reprodução local:

- 5 enums: condição, finalidade, tipo de responsável, status da custódia e
  tipo de evento;
- 2 tabelas: `material_custodias` e `material_custodia_eventos`;
- constraints de tenant, quantidades, estado, responsável, referências e
  integridade com material, localização, estoque e custódia;
- índices de empresa/status/data, previsão, material/status, responsável,
  evento/data, idempotência e exclusão de segunda custódia individual ativa;
- triggers append-only/de proteção do histórico;
- funções de resolução e proteção internas;
- RPCs públicas de busca, listagem, indicadores, responsáveis, eventos,
  check-out, check-in e cancelamento;
- integração modular `checkin_checkout` com dependências de
  `gestao_materiais` e `controle_estoque`.

## 5. RLS, grants e segurança

- RLS permanece habilitado nas duas tabelas de custódia.
- As policies de leitura de custódia e as policies canônicas de leitura de
  localizações, saldos e movimentos usam a fachada autorizada
  `can_read_company_module`.
- Não existem policies de escrita direta para custódia; escrita ocorre somente
  pelas RPCs transacionais.
- `authenticated` recebe somente `SELECT` nas tabelas de custódia e `EXECUTE`
  nas oito RPCs públicas.
- `anon` não recebe leitura das tabelas nem execução das RPCs.
- `resolve_custody_company`, `resolve_custody_responsible_name`,
  `protect_material_custody_history`, `apply_stock_movement` e o helper de
  entitlement continuam sem exposição a clientes.
- As funções `SECURITY DEFINER` da Etapa 3 usam
  `search_path = pg_catalog, public`.
- O defeito da Etapa 3.5 não reapareceu: as policies chamam a fachada
  executável e o helper `company_has_active_module` continua privado. Não foi
  introduzido grant adicional para contornar a correção.

Probes remotos, sem escrita, com a chave pública:

| Probe | Resultado |
|---|---|
| leitura anônima de `material_custodias` | bloqueada, HTTP 401 / PostgreSQL `42501` |
| execução anônima de `buscar_materiais_custodia` | bloqueada, HTTP 401 / `42501` |
| exposição de `resolve_custody_company` | ausente no PostgREST, HTTP 404 / `PGRST202` |
| execução anônima de `company_has_active_module` | bloqueada, HTTP 401 / `42501` |

A execução remota como `authenticated` não foi realizada por falta de sessão
autenticada segura. O contrato específico de `authenticated`, incluindo o uso
da fachada e o bloqueio dos helpers, foi aprovado no PostgreSQL real pela suíte
pgTAP aplicada ao mesmo checksum.

## 6. Multiempresa e personas

No PostgreSQL real, foram aprovados:

- isolamento de leitura e escrita entre empresas A e B;
- empresa com módulo desativado;
- empresa em somente leitura;
- empresa inativa;
- usuário comum com leitura e sem escrita;
- administrador da empresa;
- Master com empresa explicitamente selecionada;
- licença Vitalícia com módulo e dependências canônicas;
- remoção de entitlement com comportamento fail-closed.

Esses testes por persona não foram repetidos no remoto para evitar criação de
usuários, empresas, licenças ou estoque fictício. Nenhum registro de teste ficou
no ambiente remoto.

## 7. Smoke tests remotos

Executados e aprovados, sem mutação:

- leitura da lista de migrations e dry-run vazio;
- lint do schema `public`;
- geração dos tipos do schema remoto;
- presença das tabelas, enums, relações e RPCs da Etapa 3;
- bloqueio de leitura direta e RPC pública para `anon`;
- bloqueio/não exposição dos helpers internos para `anon`.

Não executados no remoto por ausência de ambiente autenticado apropriado:

- usuário comum, administrador e Master;
- empresa inativa, somente leitura e módulo desativado;
- licença Vitalícia;
- isolamento multiempresa por sessões de usuário reais;
- check-out, check-in parcial/total e cancelamento com dados reais.

## 8. Integração estoque + custódia

- `estoque_saldos` continua sendo a única fonte de saldo por material e
  localização.
- `estoque_movimentacoes` continua sendo o ledger imutável.
- `materiais.quantidade` continua somente como projeção sincronizada pelo
  writer canônico de estoque.
- A Etapa 3 não criou tabela ou coluna de saldo paralelo.
- Custódia permanece em `material_custodias` e seu histórico append-only em
  `material_custodia_eventos`, separados do ledger de estoque.
- Check-out, check-in e cancelamento chamam exclusivamente
  `apply_stock_movement` para débito, crédito e estorno.
- Cada RPC executa custódia, saldo, ledger, evento e log na mesma transação do
  PostgreSQL; falha em qualquer ponto faz rollback integral.
- Os cenários A–D forçaram falhas depois de diferentes etapas e não deixaram
  saldo, ledger, custódia, projeção ou evento parcial.

## 9. Interface

Revalidação estática e automatizada aprovada para:

- rota `/checkin-checkout` protegida por `ModuleGate`;
- item condicional na sidebar;
- scanner USB/Bluetooth por entrada de teclado e busca por UUID, QR, código de
  barras, código interno, patrimônio, série ou nome;
- listagem de operações abertas e histórico com filtros/paginação;
- check-out;
- check-in parcial e total;
- cancelamento com estorno;
- histórico completo da custódia;
- seleção explícita de empresa para Master;
- desabilitação de ações durante mutations e idempotência por UUID.

E2E manual visual/autenticado: **não executado**. O navegador do aplicativo não
estava disponível nesta sessão e não havia credencial ou sessão autenticada
segura. Nenhum cenário foi marcado como aprovado sem execução.

## 10. Regressão final

- Vitest: **37 arquivos, 263 testes aprovados**.
- `npx tsc --noEmit`: **PASS**.
- `npm run build`: **PASS**, 4.253 módulos transformados.
- ESLint dos 18 arquivos TypeScript/TSX alterados da Etapa 3: **PASS**, sem
  warnings ou erros.
- `git diff --check`: **PASS**.
- pgTAP em PostgreSQL 16.14 real: **97/97**.
- Atomicidade A–D: **PASS**.
- Concorrência real da Etapa 3.5: **PASS** nos cinco cenários documentados.
- Supabase lint remoto com `--level warning --fail-on error`: **PASS sem erros**.

O build manteve apenas avisos herdados de bundle grande, externalização de
`buffer` usada por `docx` e import estático/dinâmico de `pdfjs`. Não houve erro.

O lint remoto emitiu warnings, não erros, porque cinco RPCs de leitura estão
marcadas `STABLE` e chamam expressões classificadas como `VOLATILE` pelo
`plpgsql_check`: `buscar_materiais_custodia`,
`listar_custodias_materiais`, `obter_indicadores_custodia`,
`listar_responsaveis_custodia` e `listar_eventos_custodia`. Esse ponto não
amplia privilégios nem comprometeu os testes funcionais, mas deve ser tratado
como melhoria futura de anotação/volatilidade.

## 11. Limitações, riscos e dívidas herdadas

Limitações restantes da Etapa 3:

- E2E manual autenticado remoto ainda pendente;
- não foi executado dump independente completo do catálogo remoto porque a CLI
  exigiu Docker, indisponível neste ambiente; a validação remota usou migration
  list, dry-run, lint, geração oficial de tipos e probes PostgREST;
- não existe down migration pós-commit específica; reversão após deploy depende
  de backup ou script previamente revisado;
- warnings de volatilidade das cinco RPCs de leitura, sem erro de lint.

Dívidas herdadas, fora do escopo desta entrega:

- pgTAP real e concorrência das Etapas 1, 2 e 2.5;
- reconciliação nominal de `quantidade_legada_etapa1`;
- E2E autenticado das personas e estados empresariais das etapas anteriores;
- 357 erros globais antigos de ESLint, não reproduzidos nem corrigidos nesta
  validação direcionada;
- avisos preexistentes de tamanho/chunk do bundle.

## 12. Conclusão objetiva

- Conclusão da implementação: **sim**.
- Conclusão da migration: **sim, aplicada e sincronizada no remoto**.
- Testes automatizados: **sim, 263/263**.
- Testes reais de PostgreSQL: **sim, pgTAP 97/97, atomicidade A–D e concorrência
  real aprovada na Etapa 3.5**.
- Validação remota: **sim, com schema sincronizado, lint sem erros, geração de
  tipos e probes de segurança sem escrita**.
- E2E manual autenticado: **pendente e explicitamente não executado**.

**A Etapa 3 pode ser declarada tecnicamente concluída? Sim.**

A pendência de E2E autenticado é uma validação operacional/manual complementar
e permanece visível; não altera a conclusão técnica da implementação e da
promotion da migration validada.
