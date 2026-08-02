# ETAPA 4 — LOCAÇÃO DE MATERIAIS — RELATÓRIO DE IMPLEMENTAÇÃO

Data da validação: 02/08/2026

Migration: `20260802200000_material_rentals_stage_four.sql`

Aplicação no Supabase remoto: **não executada**

Commit: **não criado**

## Resultado executivo

A Etapa 4 foi implementada e validada localmente em PostgreSQL 16.14 real. A
migration passou por aplicação limpa, recriação, rollback transacional, 70
testes pgTAP, Supabase lint, falhas forçadas de atomicidade e concorrência real
em duas sessões.

Resultado: **a migration está tecnicamente segura para aplicação no Supabase
remoto**, respeitada a pré-validação normal do deploy remoto. Este trabalho não
executou `db push`, não alterou dados remotos e não criou commit, tag ou release.

## 1. Arquitetura

A separação de responsabilidades ficou explícita:

- `estoque_saldos` continua sendo a fonte do saldo físico;
- `estoque_movimentacoes` continua sendo o ledger imutável;
- `materiais.quantidade` continua sendo apenas a projeção mantida pelo estoque;
- `material_custodias` e seus eventos continuam representando saída, retorno e
  posse física;
- a locação representa cliente, período, reserva e valores comerciais;
- a reserva é derivada dos itens de locações ativas e não cria movimento físico
  nem saldo paralelo.

O módulo `locacao_materiais`, já planejado no `module_catalog`, foi liberado no
catálogo canônico. A decisão final de dependências foi:

- `locacao_materiais` → `gestao_materiais`;
- `locacao_materiais` → `controle_estoque`;
- `locacao_materiais` → `checkin_checkout`.

Foram reutilizados `module_catalog`, `empresa_modules`, `module_dependencies`,
`useCompanyModules`, `ModuleGate`, `company_has_active_module`,
`can_read_company_module`, `can_write_company_module`, `EmpresaModulesManager`
e `system_logs`. Não foi criado um sistema modular paralelo.

## 2. Modelo de dados

Objetos principais:

- `clientes`: cadastro canônico geral PF/PJ;
- `material_locacao_numeradores`: numeração amigável anual por empresa;
- `material_locacoes`: cabeçalho comercial e máquina de estados;
- `material_locacao_itens`: quantidade contratada, cobrança, desconto e
  subtotal;
- `material_locacao_eventos`: histórico comercial append-only.

O catálogo real confirmou 5 tabelas, 4 enums, 36 constraints nas entidades
principais, 8 índices com prefixo de locação, além dos índices de cliente e do
índice parcial de custódia por referência. Todos os vínculos críticos carregam
`empresa_id`; cliente, material, locação, item e custódia são validados no mesmo
tenant.

O número exposto segue `LOC-AAAA-NNNNNN`, com contador transacional por
empresa/ano. UUID permanece como chave interna.

## 3. Integração com cliente

A investigação encontrou **ausência de uma entidade canônica de cliente** no
schema anterior. Os eventos guardavam artista/local, e `financials` era
específico de evento, sem cadastro de cliente reutilizável.

Por isso, foi criada `public.clientes`, deliberadamente geral e não específica
de locação. Ela suporta pessoa física e jurídica, nome civil/razão social, nome
fantasia, CPF/CNPJ, contatos, observações e inativação. Não foram criados
`clientes_locacao`, cópias ou snapshots concorrentes de cadastro.

## 4. Integração com estoque

A disponibilidade comercial é calculada como:

`saldo físico em localizações ativas - reservas válidas sobrepostas ainda não retiradas`

Reservar não escreve em `estoque_saldos` nem em `estoque_movimentacoes`.
Retirada e devolução chamam as fachadas atômicas da Etapa 3, que continuam sendo
as únicas responsáveis por debitar/creditar saldo e escrever o ledger.

Os testes confirmaram que não existem colunas de saldo paralelo nas tabelas de
locação, que o check-out altera `estoque_saldos`, que
`materiais.quantidade` acompanha somente a projeção de estoque e que o ledger
permanece imutável.

## 5. Integração com Check-in / Check-out

Cada retirada chama `registrar_checkout_material` com:

- finalidade `locacao`;
- `referencia_tipo = 'locacao_item'`;
- `referencia_id` igual ao item contratado.

Cada devolução chama `registrar_checkin_material`. Quantidades retiradas,
devolvidas e com o cliente são derivadas de `material_custodias`; a locação não
duplica responsável físico, posse, saída, retorno ou evento de custódia.

Avarias e ocorrências permanecem no histórico da Etapa 3, prontas para consumo
por uma etapa futura de manutenção.

## 6. Reserva e disponibilidade por período

Os intervalos são semiabertos: `[retirada, devolução)`. Assim, uma devolução às
10:00 e uma nova retirada exatamente às 10:00 não conflitam. Foram cobertos:

- início dentro de outro intervalo;
- fim dentro;
- intervalo englobante;
- mesmo intervalo;
- fronteira devolução/retirada no mesmo instante.

Locações `reservada`, `pronta_retirada`, `em_andamento` e
`parcialmente_devolvida` participam do cálculo. Rascunhos e canceladas não
consomem disponibilidade.

Materiais individuais aceitam quantidade contratada igual a 1 e não podem ter
duas reservas conflitantes. Materiais quantitativos são limitados ao saldo
físico menos reservas sobrepostas.

## 7. Retirada e devolução

Retiradas parciais sucessivas são permitidas até a quantidade contratada. A
fachada da locação bloqueia dupla retirada e delega a operação física para a
custódia.

Devoluções parciais sucessivas reutilizam o Check-in da Etapa 3. O detalhe
apresenta, por item:

`Contratado | Retirado | Devolvido | Com cliente`

A conclusão automática ocorre após entrega integral e retorno integral. Existe
também uma ação explícita de conclusão, que somente passa se não houver posse
pendente e todo o contratado tiver sido entregue.

## 8. Valores e cobrança

Foram implementados quantidade, unidades de cobrança, valor unitário, desconto,
valor bruto, subtotal e total em `numeric`, com constraints não negativas.
`valor_locacao_padrao` do material é reutilizado como sugestão.

O domínio admite `fixo`, `diaria`, `periodo` e `unidade`, mas a interface inicial
usa a forma segura por unidade e unidades de cobrança explícitas. Não foi criada
cobrança automática de multa.

## 9. Status e atrasos

Estados persistidos:

- rascunho;
- reservada;
- pronta para retirada;
- em andamento;
- parcialmente devolvida;
- concluída;
- cancelada.

“Atrasada” não é um estado manual redundante. É derivada quando a previsão de
devolução passou e ainda existe quantidade em custódia. Transições são
executadas por RPCs; o frontend apenas oferece ações compatíveis.

## 10. Cancelamento, exclusão e histórico

Cancelamento é permitido somente antes de existir retirada. Ele libera a
reserva futura, mantém cabeçalho e histórico e exige justificativa. Uma locação
com custódia não pode ser cancelada como se a saída não tivesse ocorrido.

Não há DELETE público de locação. O histórico comercial é append-only, e o
histórico físico continua no ledger/custódia imutável.

## 11. Concorrência

A confirmação bloqueia cada material com `pg_advisory_xact_lock`, sempre em
ordem estável, e repete a validação de disponibilidade dentro da mesma
transação. Isso evita o padrão inseguro “consultar no frontend e inserir”.

Testes reais com dois processos `psql`:

| Cenário | Resultado |
|---|---|
| saldo 10; reservas conflitantes 7 e 6 | uma sessão confirmou 6; a outra recebeu `LR012`; total reservado 6, nunca 13 |
| mesmo equipamento individual e período conflitante | uma sessão confirmou; a outra recebeu `LR012`; exatamente 1 reserva |
| mesmo individual em períodos contíguos `[a,b)` e `[b,c)` | as duas sessões confirmaram; 2 reservas válidas |

A sessão vencedora depende do agendamento do sistema operacional; o invariante
de não overbooking independe dessa ordem.

## 12. Idempotência

Criação, edição, itens, confirmação, marcação de pronta, retirada, devolução,
conclusão e cancelamento têm chave idempotente e hash de payload. O banco
serializa a chave e devolve o resultado anterior em retries equivalentes,
rejeitando reutilização com payload diferente.

A interface preserva a mesma chave enquanto uma tentativa pode ser repetida
após falha de rede. Testes unitários comprovaram payload e UUID idênticos em
submissões duplicadas.

## 13. RLS, segurança e multiempresa

RLS está habilitado em clientes, locações, itens, eventos e numeradores. As
policies de leitura passam somente por `can_read_company_module` e pelas três
dependências. Não há policies de escrita para clientes autenticados: mutações
ocorrem por RPC.

As 21 funções específicas de locação auditadas são `SECURITY DEFINER` com
`search_path = pg_catalog, public`. `authenticated` executa apenas as fachadas
públicas. Helpers de resolução, disponibilidade, totais, numeração, proteção e
recálculo permanecem sem `EXECUTE` para `anon`, `authenticated` e
`service_role`.

Foram aprovados:

- isolamento e referências cruzadas entre empresas;
- usuário comum somente leitura;
- administrador de empresa;
- Master com seleção explícita e bloqueio sem seleção;
- empresa somente leitura;
- empresa inativa;
- módulo desativado;
- ausência de entitlement;
- licença Vitalícia.

## 14. Interface

Foi criada `/locacoes`, protegida por `ModuleGate`, com navegação condicional.
A tela inclui:

- indicadores de andamento, retiradas/devoluções do dia e atrasos;
- lista paginada;
- busca por número, cliente e material;
- filtros de cliente, status, período, atraso e responsável;
- criação em duas etapas;
- cadastro rápido no cadastro canônico de clientes;
- pesquisa de materiais com físico, reservado e disponível;
- detalhe comercial e operacional;
- retirada parcial com leitura de QR/código/scanner-teclado;
- devolução parcial/total a partir da custódia aberta;
- cancelamento, conclusão e histórico.

O fluxo reutiliza a normalização e o modelo de scanner da Etapa 3; não foi
criado um subsistema de scanner.

## 15. Agenda, orçamento, financeiro e documentos

`material_locacoes.evento_id` permite associação opcional à entidade canônica
`events`, validada no mesmo tenant. Não foi criado outro sistema de agenda.

Não existe módulo canônico de orçamento/proposta no schema atual. Foi mantida
uma referência futura, sem duplicar orçamento nesta etapa.

O Financeiro atual é centrado em `financials` por evento e ainda não oferece um
modelo genérico adequado de contas a receber/parcelas de locação. Portanto não
foi criado lançamento automático. A evolução recomendada é uma integração
explícita que vincule a locação a um lançamento canônico de contas a receber,
com parcelas e status financeiros pertencendo ao Financeiro — nunca à locação.

Foram reservadas referências futuras para financeiro, orçamento e contrato,
sem foreign key prematura para entidades que ainda não existem. PDF, contrato,
assinatura e comprovantes não foram implementados; o domínio e o histórico
foram priorizados.

## 16. Migration e validação PostgreSQL real

Ambiente:

- Ubuntu 24.04 em WSL 2;
- PostgreSQL 16.14;
- pgTAP 1.3.2;
- Supabase CLI 2.111.0;
- bancos locais descartáveis `stage4_validation`, `stage4_concurrency` e
  `stage4_rollback`;
- nenhuma conexão ao Supabase remoto.

Resultados:

- aplicação limpa desde bootstrap e 77 migrations relevantes: **PASS**;
- migration de `pg_cron`/`pg_net`, incompatível com PostgreSQL Ubuntu puro e
  sem dependência para este domínio: omitida, como na Etapa 3.5;
- recriação desde banco limpo: **PASS**;
- rollback transacional: **PASS**; tabela e RPC não sobreviveram ao rollback;
- pgTAP: **70/70 PASS**;
- Supabase lint em `public`: **No schema errors found**;
- análise das funções pelo lint/`plpgsql_check`: nenhum erro;
- atomicidade de retirada, devolução e cancelamento com falha forçada após a
  mutação intermediária: **PASS**, sem estado parcial;
- concorrência real em duas sessões: **PASS** nos três cenários obrigatórios.

## 17. Testes de aplicação

- Vitest completo: **40 arquivos, 282 testes aprovados**;
- testes novos de locação: **19 aprovados**;
- `npx tsc --noEmit`: **PASS**;
- `npm run build`: **PASS**;
- ESLint direcionado aos arquivos da Etapa 4 e integrações alteradas: **PASS**;
- `git diff --check`: **PASS**;
- Supabase lint local: **PASS**.

O build manteve apenas avisos herdados de tamanho de chunk, importação dinâmica
do PDF.js e externalização de `buffer` usada por `docx`. Eles não foram
introduzidos nem corrigidos nesta etapa.

## 18. Arquivos criados

- `docs/stage-4-material-rentals-implementation-report.md`;
- `src/pages/Locacoes.tsx`;
- `src/components/material-rentals/NewRentalDialog.tsx`;
- `src/components/material-rentals/RentalDetailDialog.tsx`;
- `src/hooks/useMaterialRentals.ts`;
- `src/lib/material-rental-types.ts`;
- `src/lib/material-rental-domain.ts` e teste;
- `src/lib/material-rental-permissions.ts` e teste;
- `src/lib/material-rental-service.ts` e teste;
- `supabase/migrations/20260802200000_material_rentals_stage_four.sql`;
- suíte pgTAP, rollback, atomicidade, setup e seis sessões SQL de concorrência
  em `supabase/tests/material_rentals_stage_four_*.sql`.

## 19. Arquivos modificados

- `src/App.tsx`;
- `src/components/AppSidebar.tsx`;
- `src/constants/module-keys.ts`.

Não houve alteração fora do domínio de locação e de seus pontos canônicos de
integração.

## 20. Limitações e riscos restantes

- E2E manual autenticado não foi executado: não havia ambiente remoto
  autenticado apropriado, e a migration não foi aplicada remotamente. Não é
  marcado como aprovado.
- A UI cobre scanner que se comporta como teclado/QR; câmera nativa específica
  depende da infraestrutura futura de dispositivo.
- Financeiro, orçamento, contrato, PDF, assinatura, multa e manutenção são
  apenas pontos de extensão; não foram implementados sem regras canônicas.
- O gerador de tipos do Supabase CLI ainda exigiu Docker/Podman neste ambiente.
  A interface usa tipos de domínio próprios e uma fronteira RPC explicitamente
  tipada, validada pelo TypeScript; a regeneração de
  `src/integrations/supabase/types.ts` deve ocorrer no fluxo habitual que tenha
  o runtime do gerador disponível.
- A validação remota ainda deverá repetir migration list, lint e smoke tests
  seguros quando houver autorização de deploy.

## 21. Dívidas herdadas, mantidas separadas

- E2E manual autenticado remoto;
- reconciliação nominal de estoque legado;
- débitos globais antigos de lint;
- warnings `STABLE`/`VOLATILE` de RPCs anteriores;
- warnings herdados do bundle.

Nenhuma dessas dívidas foi misturada ao escopo da Etapa 4.

## 22. Estado do Git

Pré-condição confirmada antes das alterações:

- branch `main`;
- HEAD `309197761993be0b3d0429832a3910f4fa799459`;
- worktree limpo;
- `main` dois commits à frente de `origin/main`.

Estado final esperado: alterações da Etapa 4 isoladas no worktree, sem commit,
push, tag ou release. A Etapa 5 não foi iniciada.

## Conclusão

**A migration da Etapa 4 está segura para aplicação no Supabase remoto?**

**Sim.** A evidência local cobre estrutura, RLS, privilégios, multiempresa,
estoque/custódia, idempotência, rollback, atomicidade, pgTAP e concorrência real.
A aplicação remota não foi executada e deve ocorrer somente em uma etapa de
deploy explicitamente autorizada, seguida de validação remota e E2E autenticado.
