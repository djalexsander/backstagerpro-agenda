# ETAPA 2.5 — VALIDAÇÃO PÓS-MIGRATION

Data: 02/08/2026
Projeto Supabase vinculado: `zupcxxtnaglcappazciu`

## Legenda

- `[x]` concluído
- `[ ]` pendente
- `[!]` requer validação humana
- `[⚠]` risco

## Publicação da migration

- [x] Antes da aplicação, `supabase migration list --linked` e
  `supabase db push --dry-run --linked` confirmaram que
  `20260802090000_stage_2_5_stock_stabilization.sql` era a única migration
  local pendente.
- [x] A migration foi revisada integralmente e é incremental: altera grants,
  substitui uma função de proteção e amplia uma view administrativa.
- [x] Não contém `DROP`, `DELETE`, `TRUNCATE`, `ALTER TABLE`, reset de saldo,
  carga de dados, movimentação de estoque ou atualização em massa.
- [x] Não cria tabela, empresa, módulo, papel, policy ou sistema paralelo de
  contexto/permissão. Reutiliza as estruturas e funções canônicas.
- [x] `supabase db push --linked --yes` aplicou efetivamente a migration no
  remoto em 02/08/2026.
- [x] A listagem pós-aplicação mostra `20260802090000` nos lados local e
  remoto, com timestamp `2026-08-02 09:00:00`.

## Schema e tipos remotos

- [x] `supabase db lint --linked --schema public --level warning
  --fail-on error` retornou `No schema errors found`.
- [x] Os tipos foram regenerados com `supabase gen types typescript --linked
  --schema public` e o arquivo versionado ficou exatamente igual à saída
  remota.
- [x] A view remota `estoque_reconciliacao_legado` expõe os campos novos
  `localizacao_legada`, `tem_movimentacoes` e `status_reconciliacao` nos tipos
  gerados.
- [ ] Um `db dump` remoto independente não foi produzido: nessa versão do CLI
  o comando requer Docker, indisponível neste ambiente. Migration list, lint e
  geração de tipos linked são as evidências remotas obtidas.

## Segurança e isolamento

- [x] RLS continua habilitada para Materiais, categorias, localizações,
  saldos e movimentações nas migrations aplicadas.
- [x] `company_has_active_module`, `can_read_company_module` e
  `can_write_company_module` continuam sendo as funções canônicas usadas
  pelas policies e por `resolve_stock_company`.
- [x] O backend deriva a empresa do usuário comum e só aceita empresa
  explicitamente selecionada no fluxo Master canônico.
- [x] FKs compostas, RLS e resolução canônica da empresa impedem referências
  operacionais entre empresas.
- [x] O frontend do Master exige empresa selecionada em `/materiais` e
  `/estoque`; o usuário comum continua restrito a `AuthContext.empresaId`.
- [x] Os estados visuais e `canWrite` do Estoque consideram empresa
  selecionada, módulos, dependências, papel, empresa ativa, somente leitura,
  plano, pagamento, trial e licença Vitalícia.
- [x] Testes automatizados cobrem Master, administrador da empresa, usuário
  comum, somente leitura, empresa inativa, módulo desativado e Vitalícia nas
  regras de acesso do frontend.
- [ ] Não houve ensaio E2E autenticado com personas reais no remoto. A
  validação do backend foi feita pelas migrations/policies aplicadas e por
  auditoria estática, sem fabricar sessões de usuário.

## Materiais e Estoque

- [x] `materiais.localizacao` foi retirado de filtro, ordenação, coluna e
  CRUD operacional no frontend.
- [x] O grant de `UPDATE(localizacao)` foi revogado de `authenticated` e o
  trigger impede inserção/alteração autenticada do texto legado pelo CRUD
  comum.
- [x] A localização oficial continua exclusivamente em
  `estoque_localizacoes`, associada aos saldos de `estoque_saldos`.
- [x] A migration não executa DML sobre saldos, materiais ou movimentos; logo,
  ela não possui instrução capaz de alterar saldo ou apagar dados.
- [x] `protect_stock_ledger` e as proibições de escrita direta no ledger não
  foram alteradas; `estoque_movimentacoes` permanece append-only.
- [x] `sync_material_stock_projection` não foi alterada;
  `materiais.quantidade` permanece projeção derivada do estoque oficial e
  protegida contra escrita pelo CRUD.
- [x] A migration preserva coluna e valores de `materiais.localizacao` e
  `quantidade_legada_etapa1`; não há comando destrutivo ou transformação de
  dados.
- [!] Não foi possível comparar snapshots de dados antes/depois por falta de
  canal SQL administrativo. A ausência de DML comprova que a migration não
  ordena alteração de saldo, mas a verificação nominal dos dados requer acesso
  administrativo real.
- [x] Os testes automatizados de Materiais e Estoque passaram no conjunto de
  34 arquivos e 240 testes.

## Dados legados

- [x] Nenhuma movimentação foi criada automaticamente e nenhuma localização
  foi inferida.
- [ ] A lista real com empresa, material, código, UUID, tipo de controle,
  quantidade legada, quantidade oficial, saldo, divergência e necessidade de
  decisão não pôde ser obtida. Não há `psql`, PostgreSQL, Docker ou sessão
  administrativa apropriada; a tentativa REST administrativa foi recusada
  pela política de chaves e não foi contornada.
- [!] Os registros classificados como `decisao_humana_pendente` ou
  `revisao_historica_pendente`, quando consultados por um canal administrativo
  somente leitura, precisarão de decisão humana sobre contagem e localização.
- [x] A consulta nominal segura está documentada em
  `docs/stage-2-5-legacy-reconciliation.md`.

## Testes e validações finais

- [x] `git diff --check`: aprovado.
- [x] `npm test -- --reporter=dot`: aprovado, 34 arquivos e 240 testes.
- [x] `npx tsc --noEmit`: aprovado.
- [x] `npm run build`: aprovado.
- [x] ESLint direcionado aos arquivos TypeScript alterados: aprovado.
- [⚠] ESLint global: 357 erros e 11 avisos preexistentes. Não foram
  corrigidos nesta tarefa, conforme solicitado.
- [ ] pgTAP das Etapas 1, 2 e 2.5 não foi executado. O CLI encerrou antes da
  execução com `LegacyDockerRunError`; nenhum teste SQL foi declarado
  aprovado.
- [ ] Concorrência real de saída, transferência, saldo inicial e estorno não
  foi executada. Não existe Docker, Podman ou `psql` para abrir duas sessões;
  nenhum sucesso foi simulado.

## Git e publicação

- [x] Worktree permanece modificado, com arquivos da estabilização e sua
  documentação.
- [x] Nenhum commit, push de Git, tag ou release foi criado.
- [x] A única publicação externa foi a migration Supabase expressamente
  autorizada.
- [x] A Etapa 3 não foi iniciada.

## Conclusão

**As Etapas 1 e 2 podem ser declaradas oficialmente concluídas? Não.**

O código, a migration e as validações automatizadas disponíveis estão
estáveis. O fechamento oficial ainda depende de evidência real para:

1. executar as suítes pgTAP das Etapas 1, 2 e 2.5;
2. executar os quatro testes concorrentes em duas sessões PostgreSQL;
3. obter a lista nominal de `quantidade_legada_etapa1` e registrar as decisões
   humanas aplicáveis;
4. executar o ensaio autenticado das personas e dos estados empresariais no
   remoto.

A dívida global preexistente de ESLint é um risco conhecido, mas não foi
introduzida nem ampliada por esta estabilização.
