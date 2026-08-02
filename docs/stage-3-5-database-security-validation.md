# ETAPA 3.5 — VALIDAÇÃO DE BANCO E SEGURANÇA

Data da validação: 02/08/2026

Migration validada: `20260802160000_material_checkin_checkout_stage_three.sql`

Resultado: **SEGURA PARA APLICAÇÃO REMOTA**

Aplicação no Supabase remoto principal: **não executada**

## Ambiente utilizado

- Workspace Windows: `D:\backstagerpro-agenda-main`.
- Ambiente isolado: Ubuntu 24.04 em WSL 2.
- PostgreSQL real: 16.14 (`Ubuntu 16.14-0ubuntu0.24.04.1`).
- pgTAP: 1.3.2.
- `plpgsql_check`: 2.7.2.
- Supabase CLI usada no lint: 2.111.0.
- Bancos exclusivamente locais e descartáveis:
  - `stage35_baseline` para rollback;
  - `stage35_validation_v3` para aplicação limpa e pgTAP principal;
  - `stage35_concurrency` para fixtures persistentes e sessões concorrentes.
- Docker, Podman, `psql` Windows e Supabase local não estavam disponíveis.
- Nenhuma conexão foi feita ao projeto Supabase remoto configurado no repositório.

O bootstrap local reproduziu apenas objetos que normalmente pertencem à
plataforma Supabase (`auth`, `storage`, roles e funções JWT) e não é uma
migration de produção. Foram reproduzidas com sucesso as 75 migrations
anteriores relevantes. A migration isolada de `pg_cron`/`pg_net`
`20260404160835_5380c92d-a5a2-49e8-a9db-834d8e40df1a.sql` foi omitida porque
essas extensões não existem no PostgreSQL Ubuntu puro e não são dependência de
Materiais, Estoque ou Custódia.

## Aplicação, rollback e recriação

- Aplicação limpa da Etapa 3: **aprovada**, sem erro.
- Recriação desde banco vazio: **aprovada** após bootstrap, replay do schema
  anterior e aplicação da migration corrigida.
- Rollback transacional: **aprovado**.
  - Dentro da transação, `material_custodias` existia.
  - Após `ROLLBACK`, a tabela e `registrar_checkout_material(...)` não existiam.
- A migration não fornece uma down migration pós-commit. A prova realizada é
  a garantia transacional de rollback durante a aplicação; uma reversão depois
  do deploy deve usar backup ou um script de reversão previamente revisado.

## Objetos, privilégios e segurança de funções

Objetos principais confirmados no catálogo real:

- 5 enums de custódia;
- 2 tabelas: `material_custodias` e `material_custodia_eventos`;
- 13 índices/constraints indexadas nas duas tabelas, incluindo unicidade da
  chave idempotente e exclusão parcial de dupla custódia individual ativa;
- 2 triggers de proteção, expandidos pelo catálogo em `UPDATE` e `DELETE`;
- 11 funções específicas de custódia e a substituição controlada do writer
  canônico `apply_stock_movement`.

Privilégios confirmados:

- `authenticated` possui apenas `SELECT` nas duas tabelas de custódia;
- `anon` não possui acesso às tabelas nem às RPCs;
- `authenticated` executa somente as RPCs públicas de leitura/escrita;
- `resolve_custody_company`, `resolve_custody_responsible_name`,
  `protect_material_custody_history` e `apply_stock_movement` não são
  executáveis por `anon`, `authenticated` nem `service_role`;
- todas as 12 funções auditadas são `SECURITY DEFINER` e possuem
  `search_path = pg_catalog, public`.

As duas tabelas têm RLS habilitado. As policies de custódia e as três policies
de leitura canônica de estoque usam as fachadas autorizadas
`can_read_company_module`; o helper interno `company_has_active_module`
permanece revogado para clientes.

## pgTAP

### Arquivo principal da Etapa 3

- Arquivo: `supabase/tests/material_checkin_checkout_stage_three_test.sql`.
- Planejados pelo `finish()`: **61**.
- Executados: **61**.
- Aprovados: **61**.
- Falharam: **0**.
- Skipped: **0**.
- Resultado final: **PASS**.

### Arquivo estendido da Etapa 3.5

- Arquivo: `supabase/tests/material_checkin_checkout_stage_three_extended_test.sql`.
- Planejados pelo `finish()`: **36**.
- Executados: **36**.
- Aprovados: **36**.
- Falharam: **0**.
- Skipped: **0**.
- Resultado final: **PASS**.

Total final: **97 planejados, 97 executados, 97 aprovados, 0 falhas e 0 skipped**.

Erros de infraestrutura encontrados durante a preparação:

- PostgreSQL puro não tinha `extensions` no `search_path`, diferentemente do
  ambiente Supabase;
- as roles do cluster são globais e exigiram bootstrap idempotente;
- o stub local de `auth.users` precisou das colunas padrão usadas pelas
  fixtures;
- `authenticated` precisou do `USAGE` padrão do Supabase no schema
  `extensions` para executar pgTAP após `SET ROLE`.

Esses pontos foram corrigidos somente no bootstrap descartável. Não foram
contabilizados como aprovação antes de o pgTAP executar de fato.

## Concorrência real

Os testes usaram dois processos `psql` simultâneos. Uma transação mantinha os
locks abertos enquanto a outra tentava confirmar a operação conflitante.

| Cenário | Sessão vencedora | Sessão conflitante | Estado final |
|---|---|---|---|
| Material individual, 1 unidade | B confirmou | A recebeu `CI012` | 1 custódia ativa, saldo 0, 1 movimento, 1 evento |
| Quantitativo, saldo 10; retiradas 7 e 6 | B confirmou 6 | A recebeu saldo insuficiente | saldo 4, retirado 6, 1 movimento, nunca negativo |
| Check-in, pendente 20; ambas devolvem 12 | B confirmou 12 | A recebeu `CI001` | devolvido 12, pendente 8, saldo 12, 1 check-in |
| Cancelamento da mesma operação | B confirmou | A recebeu `CI015` | status cancelada, saldo restaurado 5, 1 estorno, 1 evento |
| Retry/scanner, mesmo payload e UUID | ambas confirmaram | nenhuma falhou | ambas retornaram o mesmo UUID; 1 custódia, 1 movimento, 1 evento, saldo 9 |

Qual sessão venceu dependeu do agendamento dos processos, como esperado. O
invariante relevante foi preservado em todos os casos.

## Atomicidade

Os quatro cenários foram executados com falhas reais/forçadas no PostgreSQL:

- Cenário A — falha do movimento por saldo insuficiente: nenhum check-out,
  movimento ou alteração de saldo permaneceu.
- Cenário B — trigger de teste falhou no `INSERT` da custódia depois do writer
  de estoque: saldo voltou a 10; nenhum ledger nem custódia permaneceu.
- Cenário C — trigger de teste falhou no evento de check-in depois do crédito e
  da atualização da projeção: saldo permaneceu 0, devolvido permaneceu 0 e
  nenhum movimento/evento parcial permaneceu.
- Cenário D — trigger de teste falhou no evento de cancelamento depois do
  estorno e da atualização da custódia: saldo permaneceu 0, status permaneceu
  `aberta` e não existiu meio estorno.

Resultado: **nenhum cenário deixou estado parcial**.

## RLS, multiempresa e papéis

Validações aprovadas:

- empresa A não consulta custódias nem eventos da empresa B;
- mesmo conhecendo o UUID privilegiadamente, A não faz check-in nem cancela a
  custódia de B;
- A não faz check-out de material B e não usa localização B;
- usuário comum lê o histórico próprio, mas não escreve;
- administrador da empresa executa as RPCs dentro do tenant;
- Master lê tenants diferentes e opera somente quando informa a empresa
  explicitamente;
- empresa em modo somente leitura não escreve;
- empresa inativa não escreve;
- módulo desativado bloqueia escrita;
- remoção do entitlement bloqueia escrita de forma fail-closed;
- licença Vitalícia recebe o módulo e dependências pelo caminho canônico.

A autoridade permaneceu no backend em todos os testes.

## Idempotência e scanner

- Retry sequencial de check-out: retorna o registro original e não duplica
  custódia.
- Retry sequencial de check-in: não duplica evento.
- Reuso da chave com payload diferente: bloqueado.
- Duas submissões simultâneas do scanner com o mesmo UUID/payload: retornaram o
  mesmo ID de custódia e produziram exatamente 1 custódia, 1 movimento e 1
  evento.
- Teste Vitest do serviço confirma que duas submissões rápidas preservam o
  mesmo `_client_uuid` e o mesmo payload na fronteira RPC.
- Os diálogos mantêm um UUID por tentativa e desabilitam a ação enquanto a
  mutation está pendente; a proteção definitiva continua no banco.

## Check-in parcial, total, cancelamento e estorno

Sequência exata aprovada:

1. saída de 20;
2. retorno de 8, restando 12;
3. retorno de 7, restando 5;
4. tentativa de retorno de 6 bloqueada;
5. retorno final de 5, encerrando a custódia e restaurando saldo 20.

Também foram aprovados check-in total depois de parcial, rejeição de novo
retorno em custódia concluída, cancelamento somente sem devoluções e vínculo do
cancelamento a um movimento imutável de estorno.

## Integração com Estoque e histórico

- `estoque_saldos` permaneceu o único estado oficial do saldo.
- `estoque_movimentacoes` permaneceu o ledger imutável.
- `materiais.quantidade` acompanhou o saldo apenas pela projeção já existente.
- A Etapa 3 não criou tabela ou coluna de segundo saldo.
- Check-out, check-in e cancelamento usaram exclusivamente
  `apply_stock_movement`.
- Cliente autenticado recebeu `42501` em `UPDATE`, `DELETE` e `INSERT` indevido
  nas tabelas históricas.
- Mesmo tentativas privilegiadas de `UPDATE`/`DELETE` foram bloqueadas pelos
  triggers com `CI019`.

## Lint e regressão

- `git diff --check`: **PASS**.
- Vitest: **37 arquivos, 263 testes aprovados**.
- `npx tsc --noEmit`: **PASS**.
- `npm run build`: **PASS**.
- ESLint restrito aos arquivos alterados da Etapa 3: **PASS**, sem warnings ou
  erros.
- `supabase db lint --schema public --level warning --fail-on error`:
  **PASS**, `No schema errors found`.

O build manteve apenas avisos preexistentes de tamanho de chunk/importação
dinâmica; nenhum erro foi produzido.

## Defeitos encontrados e correções realizadas

### Defeito funcional

As policies RLS de custódia e as leituras canônicas de estoque chamavam
diretamente `company_has_active_module`, embora a própria arquitetura revogue
`EXECUTE` desse helper para `authenticated`. Em PostgreSQL real, a consulta
falhava com `permission denied for function company_has_active_module` antes do
filtro de tenant.

Correção na migration da Etapa 3:

- policies de custódia passaram a usar `can_read_company_module` para Custódia,
  Materiais e Estoque;
- policies de leitura de localizações, saldos e movimentos foram recriadas
  usando somente a fachada autorizada;
- o helper interno continuou fechado, sem ampliar privilégios.

### Defeitos de teste/infraestrutura

- a fixture tentava criar uma segunda licença Vitalícia contra o índice de
  unicidade correto; passou a reutilizar o plano canônico;
- expectativas de imutabilidade foram separadas entre bloqueio de privilégio
  (`42501`) e defesa em profundidade pelo trigger (`CI019`);
- foi acrescentado o bloqueio de `INSERT` forjado no ledger;
- foram adicionados bootstrap local, rollback, concorrência, atomicidade,
  sequência parcial exata e teste de duplicidade do serviço.

## Arquivos modificados nesta validação

- `supabase/migrations/20260802160000_material_checkin_checkout_stage_three.sql`;
- `supabase/tests/material_checkin_checkout_stage_three_test.sql`;
- `supabase/tests/local_supabase_postgres_bootstrap.sql`;
- `supabase/tests/material_checkin_checkout_stage_three_concurrency_setup.sql`;
- `supabase/tests/material_checkin_checkout_stage_three_extended_test.sql`;
- `supabase/tests/material_checkin_checkout_stage_three_rollback_test.sql`;
- `src/lib/checkin-checkout-service.test.ts`;
- este relatório.

Os demais arquivos da Etapa 3 já estavam modificados ou não rastreados no
worktree e foram preservados.

## Estado do Git

- Worktree continua com todas as mudanças da Etapa 3 e 3.5.
- Nenhum commit, push, tag ou release foi criado.
- `git diff --check` está limpo.
- O build atualizou os artefatos ignorados em `dist`, sem acrescentá-los ao
  status do Git.

## Riscos restantes

- O teste usou PostgreSQL real com stubs mínimos dos schemas gerenciados pelo
  Supabase, não a stack Supabase Docker completa.
- A migration de `pg_cron`/`pg_net`, sem relação com esta Etapa, não foi
  reproduzida.
- Não foi auditado drift do schema remoto e não foi executado `db push
  --dry-run` contra produção, pois nenhum acesso remoto foi realizado nesta
  execução.
- Antes do deploy, ainda são necessários backup verificado, dry-run vinculado,
  revisão do plano e janela de aplicação monitorada.
- Não existe down migration pós-commit específica da Etapa 3.

## Conclusão

Com base na aplicação limpa, rollback transacional, 97 testes pgTAP, sessões
concorrentes reais, falhas atômicas forçadas, RLS/multiempresa, idempotência,
imutabilidade, lint e regressão, a migration
`20260802160000_material_checkin_checkout_stage_three.sql` está **SEGURA PARA
APLICAÇÃO REMOTA**.

Ela **não foi aplicada** ao Supabase remoto principal nesta execução.
