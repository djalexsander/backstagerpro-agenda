# ETAPA 3 — CHECK-IN / CHECK-OUT — RELATÓRIO DE IMPLEMENTAÇÃO

Data da revisão: 2026-08-02

## Pré-verificação

- O `HEAD` foi confirmado em `52bd2f3d8a7faf9ae68feec529258ebd0a0f5cf6`, commit exclusivo da Etapa 2.5.
- O worktree estava limpo antes do início da Etapa 3.
- Não havia diferenças locais em `docs/stage-2-5-closure-report.md` nem em `docs/stage-2-5-post-migration-validation.md`. A indicação posterior da interface não correspondia ao estado real do Git no início desta execução.
- A branch local já estava um commit à frente de `origin/main`; não foi feito push, tag ou release.

## 1. Arquitetura adotada

A implementação separa custódia física de saldo de estoque. `material_custodias` representa a operação de retirada e sua projeção de quantidade pendente; `material_custodia_eventos` forma o histórico append-only. Toda alteração física de saldo é delegada à função canônica `apply_stock_movement`, dentro da mesma transação das RPCs de custódia.

O frontend acessa apenas RPCs. Não há `INSERT`, `UPDATE` ou `DELETE` direto nas tabelas de custódia, `estoque_saldos` ou `estoque_movimentacoes`.

## 2. Fluxo de Check-out

1. O operador escaneia ou pesquisa UUID, QR Code, código de barras, código interno, patrimônio, número de série ou nome.
2. A RPC retorna o material, sua localização, saldo oficial e eventual custódia ativa.
3. A interface oferece somente ações válidas.
4. O operador escolhe origem, finalidade, responsável, quantidade, condição, previsão e observações.
5. `registrar_checkout_material` valida empresa, módulos, escrita, material, localização, responsável e disponibilidade; adquire locks; registra a saída no estoque; cria a custódia e o evento; e grava `system_logs` atomicamente.
6. Materiais individuais aceitam quantidade 1 e possuem índice único parcial contra duas custódias ativas.

## 3. Fluxo de Check-in

1. O operador seleciona uma custódia aberta ou parcial.
2. A tela informa responsável, saída, quantidade original, já devolvida, pendente e previsão.
3. O operador informa quantidade, destino, condição, observações e eventual ocorrência.
4. `registrar_checkin_material` bloqueia a operação, valida a quantidade pendente, registra a entrada oficial de estoque, inclui um evento imutável e atualiza somente a projeção controlada da custódia.
5. Retornos parciais mantêm status `parcial`; somente saldo pendente zero produz `concluida`.

## 4. Integração com estoque

- O estoque continua sendo a autoridade de saldo, localização e ledger.
- Check-out gera movimento canônico `saida`; check-in gera `entrada`; cancelamento gera `estorno`.
- A origem modular `checkin_checkout`, já prevista no enum canônico, foi autorizada na função interna de movimento.
- Locks consultivos, `FOR UPDATE`, saldo oficial e idempotência são aplicados no banco.
- Custódia e movimento são executados na mesma transação da RPC: falha em qualquer etapa causa rollback integral.
- Não há atualização de `materiais.quantidade`, escrita de saldo pelo frontend ou inserção direta no ledger pelo cliente.

## 5. Modelo de custódia

- Distingue executor da operação e responsável físico.
- O responsável usa `profiles` ou `funcionarios` canônicos; o nome é preservado como snapshot histórico.
- Materiais individuais e quantitativos compartilham a operação, com invariantes específicos.
- `referencia_tipo` e `referencia_id` permitem vínculo futuro desacoplado com cliente, contrato, orçamento, evento ou locação, sem criar tabelas paralelas nesta etapa.
- Condição física usa domínio próprio e não altera automaticamente `estado_operacional`.

## 6. Tabelas

- `material_custodias`: checkout, responsável, finalidade, origem, quantidade original/devolvida, previsão, estado e referências futuras.
- `material_custodia_eventos`: checkout, check-in, cancelamento ou correção, ator, quantidade, origem/destino, condição, ocorrência, justificativa e movimento de estoque.

Há constraints de empresa, quantidade, estados e responsáveis, índice único parcial para item individual ativo e índices para empresa, material, status, responsável, datas e idempotência.

## 7. RPCs e funções

RPCs expostas a `authenticated`:

- `registrar_checkout_material`
- `registrar_checkin_material`
- `cancelar_checkout_material`
- `buscar_materiais_custodia`
- `listar_custodias_materiais`
- `obter_indicadores_custodia`
- `listar_responsaveis_custodia`
- `listar_eventos_custodia`

Funções internas incluem resolução de empresa, responsável, proteção do histórico e a extensão segura do movimento canônico. Funções internas tiveram execução revogada. As 12 funções `SECURITY DEFINER` declaram `SET search_path = pg_catalog, public`.

## 8. RLS

- RLS está habilitada nas duas tabelas.
- Policies de leitura exigem `can_read_company_module` para `checkin_checkout` e os módulos dependentes ativos.
- Não existem policies de escrita direta; mutações passam exclusivamente pelas RPCs transacionais.
- As RPCs resolvem empresa canônica, Master com empresa explícita, associação do usuário comum, empresa ativa, modo operacional, entitlement e permissão de leitura/escrita.
- Material, localização, responsável e custódia são revalidados na mesma empresa no backend.

## 9. Integração modular

`checkin_checkout` já constava no `module_catalog` como planejado e já dependia de `gestao_materiais`. A migration o ativa e acrescenta dependência de `controle_estoque`.

A segunda dependência é necessária porque todas as retiradas e devoluções alteram a disponibilidade física oficial. Sem `controle_estoque`, a custódia poderia divergir da autoridade de saldo. A implementação reutiliza `module_catalog`, `empresa_modules`, `module_dependencies`, `useCompanyModules`, `ModuleGate`, `company_has_active_module`, `can_read_company_module`, `can_write_company_module`, `EmpresaModulesManager` e `system_logs`.

## 10. Arquivos criados

- `docs/stage-3-checkin-checkout-implementation-report.md`
- `src/components/checkin-checkout/CancelCheckoutDialog.tsx`
- `src/components/checkin-checkout/CheckinDialog.tsx`
- `src/components/checkin-checkout/CheckoutDialog.tsx`
- `src/components/checkin-checkout/CustodyHistoryDialog.tsx`
- `src/hooks/useCheckinCheckout.ts`
- `src/lib/checkin-checkout-domain.test.ts`
- `src/lib/checkin-checkout-domain.ts`
- `src/lib/checkin-checkout-errors.ts`
- `src/lib/checkin-checkout-permissions.test.ts`
- `src/lib/checkin-checkout-permissions.ts`
- `src/lib/checkin-checkout-service.ts`
- `src/lib/checkin-checkout-types.ts`
- `src/pages/CheckinCheckout.tsx`
- `supabase/migrations/20260802160000_material_checkin_checkout_stage_three.sql`
- `supabase/tests/material_checkin_checkout_stage_three_test.sql`

## 11. Arquivos modificados

- `src/App.tsx`
- `src/components/AppSidebar.tsx`
- `src/constants/module-keys.ts`
- `src/integrations/supabase/types.ts`

## 12. Migration criada

`20260802160000_material_checkin_checkout_stage_three.sql` contém enums, tabelas, índices, constraints, triggers, RLS, policies, funções/RPCs, grants/revokes, comentários, integração modular e extensão da função canônica de estoque.

A migration não foi aplicada no Supabase remoto.

## 13. Testes criados

- 22 testes unitários novos de domínio e permissões: normalização e identificação por scanner, ações válidas, quantidade, item individual, estado parcial/total, empresas e personas.
- Suite pgTAP da Etapa 3: estrutura, RLS, isolamento, módulos, escrita, somente leitura, item individual, quantidade parcial, saldo insuficiente, duplicidade, idempotência, check-in parcial/total, cancelamento/estorno, ledger imutável, entidades de outra empresa, entidades inativas, entitlement e Vitalícia.

## 14. Testes realmente executados

- Testes direcionados novos: **22/22 aprovados** em 2 arquivos.
- Suite automatizada completa: **262/262 aprovados** em 36 arquivos.
- pgTAP da Etapa 3: **não executado**. A tentativa local falhou com `ECONNREFUSED 127.0.0.1:54322`, pois não havia PostgreSQL/Supabase local ativo.
- Nenhum teste foi executado contra o banco remoto, para não aplicar ou pressupor a migration pendente.

## 15. Limitações

- O leitor por teclado USB/Bluetooth é suportado; câmera/browser não foi adicionada, por ser complementar.
- A custódia referencia somente usuários e funcionários canônicos ativos. Outros tipos futuros ficam desacoplados até existirem entidades canônicas seguras.
- Cancelamento é permitido apenas antes de qualquer devolução; após retorno parcial, a correção deve preservar a sequência de eventos.
- A condição de retorno registra avaria/ocorrência, mas não abre manutenção nem muda automaticamente o estado operacional.
- O RBAC granular futuro não foi implementado; as permissões canônicas atuais permanecem a autoridade.
- Os tipos Supabase adicionados são contratos provisórios da migration; a geração oficial deve ocorrer após aplicação autorizada.

## 16. Riscos

- A migration pendente ainda não foi compilada por uma instância PostgreSQL local/staging nesta execução.
- `supabase db lint --linked` validou o schema remoto atual, não o SQL ainda não aplicado.
- `supabase db push --dry-run --linked` confirmou apenas que uma migration está pendente; não equivale a execução transacional.
- Concorrência foi defendida por locks, constraints, saldo oficial e testes lógicos, mas ainda requer teste real em duas sessões antes da promoção.
- O bundle mantém avisos preexistentes de chunk grande e imports do `pdfjs`/`docx`; o build conclui normalmente.

## 17. Pendências

Pendências específicas da Etapa 3:

- aplicar a migration somente após autorização explícita;
- executar a migration e o pgTAP em PostgreSQL descartável/staging;
- executar concorrência real em duas sessões para item individual, quantidade limitada e check-in duplicado;
- executar E2E autenticado das personas, estados empresariais e scanner;
- regenerar os tipos Supabase após a aplicação autorizada.

Dívidas antigas, mantidas separadas e **não resolvidas**:

- pgTAP real das Etapas 1, 2 e 2.5;
- teste real de concorrência das Etapas 1, 2 e 2.5;
- levantamento nominal e reconciliação de `quantidade_legada_etapa1`;
- E2E autenticado das personas e estados empresariais no remoto.

Os 357 erros globais preexistentes de ESLint não foram tratados nesta etapa.

## 18. Build, typecheck e validações

- `npm.cmd test -- --run`: aprovado, 36 arquivos e 262 testes.
- `npx.cmd tsc --noEmit`: aprovado.
- `npm.cmd run build`: aprovado, 4.253 módulos transformados.
- ESLint somente dos arquivos TypeScript/TSX alterados: aprovado.
- `git diff --check`: aprovado.
- Auditoria de escrita direta, funções internas, `search_path`, RLS e isolamento multiempresa: aprovada por inspeção estática.
- `npx.cmd supabase db lint --linked --schema public --level warning --fail-on error`: `No schema errors found` no schema remoto atual.
- `npx.cmd supabase db push --dry-run --linked`: confirmou somente `20260802160000_material_checkin_checkout_stage_three.sql` como pendente; nada foi aplicado.
- `npx.cmd supabase migration list --linked`: remoto e local alinhados até `20260802090000`; Etapa 3 apenas local.

## 19. Estado do Git

O worktree está intencionalmente **sujo**, contendo apenas os arquivos da Etapa 3 listados neste relatório. Não foi criado commit. Não houve push, tag, release ou aplicação remota.

## 20. Segurança para aplicação remota

**Ainda não é seguro aplicar a migration diretamente no Supabase remoto.**

O código, typecheck, build, testes unitários, lint direcionado, dry-run e revisão estática passaram. Contudo, a migration e o pgTAP precisam primeiro ser executados em PostgreSQL local descartável ou ambiente de staging, incluindo concorrência real em duas sessões. Depois dessa validação, a aplicação remota deve ocorrer somente mediante autorização explícita e com plano de rollback/observabilidade.
