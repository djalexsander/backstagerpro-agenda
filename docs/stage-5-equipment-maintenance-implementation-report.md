# ETAPA 5 — MANUTENÇÃO DE EQUIPAMENTOS — RELATÓRIO DE IMPLEMENTAÇÃO

Data da validação: 02/08/2026

Migration: `20260802230000_equipment_maintenance_stage_five.sql`

Aplicação no Supabase remoto: **não executada**

Commit, push, tag e release: **não realizados**

## Resultado executivo

A Etapa 5 foi implementada e validada em PostgreSQL 16.14 real. A migration
passou por reprodução desde banco vazio, aplicação/recriação em bases
descartáveis, rollback transacional, Supabase lint, 65 testes pgTAP, falhas
forçadas de atomicidade e quatro cenários com sessões PostgreSQL concorrentes.

O módulo usa o cadastro canônico de materiais, a arquitetura modular existente,
a custódia da Etapa 3 e o motor de disponibilidade da Etapa 4. Não cria saldo,
custódia, técnico, fornecedor ou Financeiro paralelo.

## 1. Arquitetura

`manutencao_equipamentos` foi liberado no `module_catalog`. Foram reutilizados
`empresa_modules`, `module_dependencies`, `useCompanyModules`, `ModuleGate`,
`company_has_active_module`, `can_read_company_module`,
`can_write_company_module`, `EmpresaModulesManager` (catalog-driven) e
`system_logs`.

A única dependência obrigatória é:

- `manutencao_equipamentos` → `gestao_materiais`.

`controle_estoque` e `checkin_checkout` são integrações opcionais. Essa decisão
é intencional: manutenção não movimenta saldo, e uma ordem manual, preventiva
ou de inspeção deve funcionar sem custódia habilitada. Quando Estoque,
Check-in/Check-out e Locação estão ativos, as integrações de disponibilidade e
origem são aplicadas pelas fachadas canônicas.

## 2. Modelo de dados

- `manutencao_ordens`: cabeçalho, máquina de estados, responsável, datas,
  condições, custos, preventiva e referência de origem;
- `manutencao_ordem_eventos`: histórico append-only e idempotência;
- `manutencao_ordem_insumos`: peças/insumos documentados, com referência
  opcional a material canônico;
- `manutencao_equipamento_numeradores`: número amigável anual por empresa,
  no formato `MAN-AAAA-NNNNNN`.

Todas as entidades carregam `empresa_id`; relações críticas usam chaves
compostas por empresa. UUID continua sendo a chave interna.

## 3. Status

Estados persistidos:

- aberta;
- aguardando análise;
- em manutenção;
- aguardando peça;
- concluída;
- cancelada.

O backend valida a matriz de transições. Estados terminais não reabrem. A
conclusão exige diagnóstico, serviço executado e condição de saída. A interface
oferece apenas as ações válidas e usa `updated_at` como versão otimista.

## 4. Preventiva

A V1 trabalha exclusivamente por data. A ordem aceita intervalo entre 1 e 3650
dias; ao concluir, deriva `proxima_preventiva_em`. O detalhe do material deriva
última manutenção e próxima preventiva das ordens, sem telemetria, horas ou
ciclos inexistentes.

## 5. Corretiva

Ordens corretivas registram defeito/motivo, condição de entrada, diagnóstico,
serviço, condição de saída, prioridade, responsável, previsão, datas e custos.
Também podem nascer de defeito operacional ou de Check-in avariado.

## 6. Integração com Check-in

As condições canônicas `com_avaria`, `danificado` e `manutencao_necessaria`
geram uma ação explícita **Abrir manutenção** após o Check-in. Nenhuma ordem é
criada automaticamente.

A nova ordem consulta o evento de Check-in, pré-preenche material, quantidade,
condição e ocorrência e guarda FK para o evento exato. A custódia e seu histórico
não são copiados.

## 7. Integração com Locação

`material_rental_availability` foi estendida, sem criar outro motor. Ela agora
calcula:

`saldo físico em locais ativos - reservas sobrepostas - quantidade em manutenção ativa`

O seletor de locação omite materiais com disponibilidade zero. A confirmação
da reserva repete a validação sob o lock canônico do material.

## 8. Integração com disponibilidade

Manutenções ativas são `aberta`, `aguardando_analise`, `em_manutencao` e
`aguardando_peca`. Conclusão ou cancelamento libera a indisponibilidade na mesma
transação.

Um trigger na projeção de custódia serializa e bloqueia Check-out incompatível.
Para materiais quantitativos, o sistema usa apenas `quantidade_afetada`, sem
inventar números de série/unidades. O saldo restante após Check-out nunca pode
ficar abaixo da quantidade em manutenção.

## 9. Integração com Estoque

Manutenção nunca escreve em `estoque_saldos`, `estoque_movimentacoes` ou na
projeção `materiais.quantidade`. Peças/insumos podem apontar para um material
cadastrado, mas a Etapa 5 registra apenas uso e custo; não cria movimentação
artificial sem regra de consumo/localização definida.

## 10. Custos

A ordem registra mão de obra, peças, outros e total gerado pelo banco. Insumos
detalhados recalculam o custo de peças. Valores usam `numeric`, rejeitam
negativos e são expostos somente a quem pode consultar o módulo.

Nenhum lançamento financeiro é criado. A integração futura deve vincular a
ordem a uma entidade canônica de contas a pagar/lançamento quando esse contrato
existir, sem projetar Financeiro dentro da manutenção.

## 11. Histórico

Criação, edição relevante, diagnóstico, início, transição, conclusão,
cancelamento e inclusão/remoção explícita de insumo geram eventos. UPDATE e
DELETE do histórico são bloqueados por trigger. Correções preservam o passado
por novos eventos/reversões.

## 12. Concorrência

Locks transacionais por empresa/material serializam manutenção com reserva e
Check-out. Índice parcial único impede duas manutenções individuais ativas. A
ordem também é bloqueada por linha durante edição/encerramento.

Resultados de duas sessões reais:

| Cenário | Resultado |
|---|---|
| duas aberturas no mesmo individual | uma confirmou; outra recebeu `MT012`; uma ordem ativa |
| abertura versus confirmação de reserva | manutenção confirmou; reserva recebeu `LR012`; locação permaneceu rascunho |
| abertura versus Check-out | manutenção confirmou; Check-out recebeu `MT012`; saldo 1 e zero custódias |
| conclusão versus cancelamento | conclusão confirmou; concorrente recebeu `MT015`; um evento terminal |

## 13. Idempotência

Criação, edição, transição e insumos usam `client_uuid`, hash de payload, unique
constraint e advisory lock. Retry equivalente retorna o resultado existente;
reutilização com payload diferente falha com `MT013`.

## 14. RLS

RLS está ativo nas três entidades consultáveis e no numerador. Leitura usa
`can_read_company_module`; escrita ocorre somente pelas RPCs, que validam tenant,
entitlement, dependência, acesso operacional e `can_write_company_module`.

Foram aprovados usuário comum, administrador de empresa, Master com empresa
explícita, somente leitura, empresa inativa, módulo inativo, ausência de
entitlement, referências cruzadas e licença Vitalícia. Helpers internos não têm
`EXECUTE` para `anon`, `authenticated` ou `service_role`. Todas as funções
`SECURITY DEFINER` usam `search_path = pg_catalog, public`.

## 15. Arquivos

Frontend/domínio:

- `src/pages/Manutencoes.tsx`;
- `src/components/equipment-maintenance/NewMaintenanceDialog.tsx`;
- `src/components/equipment-maintenance/MaintenanceDetailDialog.tsx`;
- `src/hooks/useEquipmentMaintenance.ts`;
- `src/lib/equipment-maintenance-{types,domain,permissions,service}.ts`;
- testes unitários correspondentes.

Integrações alteradas:

- `src/App.tsx`;
- `src/components/AppSidebar.tsx`;
- `src/components/checkin-checkout/CheckinDialog.tsx`;
- `src/components/materials/MaterialDetailsDialog.tsx`;
- `src/pages/Materiais.tsx`.

Banco/testes:

- migration incremental da Etapa 5;
- pgTAP, rollback, atomicidade, replay limpo e scripts de quatro pares de
  sessões concorrentes em `supabase/tests/equipment_maintenance_stage_five_*`.

## 16. Migration

`20260802230000_equipment_maintenance_stage_five.sql` é incremental e não
altera migrations aplicadas. Inclui enums, tabelas, índices, constraints, RLS,
policies, triggers, RPCs, grants/revokes, dependência modular e extensões
controladas da disponibilidade de Locação e do guard de Check-out.

## 17. Testes

- Vitest completo: **43 arquivos, 296 testes aprovados**;
- `npx tsc --noEmit`: **PASS**;
- `npm run build`: **PASS**;
- ESLint direcionado: **PASS**;
- `git diff --check`: **PASS**.

Os avisos de bundle sobre `buffer`, PDF.js e chunk grande são herdados e não
foram tratados nesta etapa.

## 18. pgTAP

**65/65 PASS**. A suíte cobre estrutura, domínio modular, RLS, multiempresa,
referências cruzadas, usuário comum, somente leitura, módulo inativo, sem
entitlement, empresa inativa, Vitalícia, Master, criação, edição, transições,
conclusão, cancelamento, idempotência, dupla manutenção, disponibilidade de
Locação/Check-out, liberação, histórico, Check-in e helpers protegidos.

## 19. PostgreSQL real

Ambiente: Ubuntu 24.04/WSL 2, PostgreSQL **16.14**, pgTAP 1.3.2 e Supabase CLI
2.111.0.

- replay desde `template0`, bootstrap dos objetos Supabase e todas as migrations
  relevantes: **PASS**;
- migration antiga isolada de `pg_cron`/`pg_net`: omitida no PostgreSQL Ubuntu
  puro, como nas validações anteriores;
- aplicação e recriação em bancos descartáveis: **PASS**;
- rollback transacional: **PASS**;
- Supabase lint em `public`: **No schema errors found**;
- atomicidade com falha forçada após mutações intermediárias de criação,
  conclusão e insumo: **PASS**;
- concorrência real em quatro pares de sessões: **PASS**.

Nenhuma conexão ou escrita no Supabase remoto foi realizada.

## 20. Riscos

- aplicação remota ainda deve seguir o fluxo normal de dry-run, backup e
  observabilidade;
- reservas já confirmadas impedem a abertura que exceda capacidade; não existe
  agendamento futuro de janela de manutenção na V1;
- o CTA após Check-in depende do entitlement ativo de manutenção;
- custos não têm efeito contábil até existir integração financeira explícita.

## 21. Limitações

- materiais quantitativos são tratados por contagem afetada, não por unidade
  serializada; não há histórico individual inexistente;
- peças documentadas não debitam estoque nesta etapa;
- horas/ciclos, telemetria e SLA não foram criados;
- não há cadastro canônico de fornecedor de serviços. Foi mantido nome externo
  simples e extensível, sem tabela paralela; o campo `fornecedor` do material é
  um atributo de aquisição e não uma entidade reutilizável;
- técnico interno reutiliza `profiles`/`funcionarios`; RBAC granular permanece
  dívida futura;
- E2E manual autenticado remoto não foi executado, conforme escopo.

## 22. Estado do Git

Pré-condição confirmada antes das alterações:

- branch `main`;
- HEAD `93a1a163f5a6122d627a3507f7e86f7fd54c8b23`;
- worktree limpo;
- branch exatamente 3 commits à frente de `origin/main`.

Estado final: alterações exclusivas da Etapa 5 no worktree, branch ainda 3
commits à frente, sem commit, push, tag ou release.

## Conclusão

**A migration da Etapa 5 está segura para aplicação no Supabase remoto?**

**Sim.** A evidência local cobre replay limpo, rollback, lint, RLS,
multiempresa, idempotência, atomicidade, disponibilidade, integração com
Locação/Check-out e concorrência real. A aplicação remota não foi executada e
deve ocorrer somente em uma etapa de deploy explicitamente autorizada.
