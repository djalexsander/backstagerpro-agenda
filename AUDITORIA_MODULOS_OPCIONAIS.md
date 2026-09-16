# Backstage Pro — Auditoria do Sistema de Módulos Opcionais

**Data**: 2026-09-14 · **Branch**: `main` · **HEAD analisado**: `73ab5c6` (chore: ETAPA 8 — fechamento final da auditoria + release 1.3.0)
**Tipo**: somente leitura. Nenhum arquivo de código foi alterado. Metodologia: 5 investigações paralelas (agentes read-only) cobrindo catálogo de dados, UI (sidebar/abas/dashboard/botões), rotas, backend (RLS/RPC/Edge Functions) e área de contratação + regras de Master, cada achado conferido com citação `arquivo:linha` no código atual.

**Contexto**: existe um relatório de auditoria anterior no repo (`BACKSTAGE_PRO_STATUS_POS_AUDITORIA.md`, 2026-08-30, HEAD `80f8821`) que já cobria módulos parcialmente. Desde então houve 5 commits adicionais, incluindo "ETAPA 7" e "ETAPA 8", que fecharam boa parte das pendências antigas relacionadas a módulos (ver seção 8). Este documento é uma auditoria nova e completa, focada especificamente na dimensão "módulo contratado vs. não contratado" (distinta da permissão granular por usuário dentro de um módulo já ativo).

---

## Resumo executivo

O sistema de módulos é **arquiteturalmente sólido e majoritariamente bem aplicado**: 20 `feature_key` existem no catálogo (14 comercializáveis, 6 desativados comercialmente por decisão de produto), com uma cadeia consistente `module_catalog` → `empresa_modules` → `hasModule()`/`ModuleGate` no frontend e `can_read/write_company_module`/`company_has_active_module`/`user_has_module_action` no backend. Dos 14 módulos comercializáveis, **7 estão 100% corretos em todas as camadas** (Materiais, Estoque, Check-in/Check-out+Scanner Remoto, Manutenção, RFID, Documentos Avançados, capacidades extras).

Foram encontrados **2 problemas reais de proteção de backend** (não apenas estéticos) e **vários problemas de inconsistência de frontend** (dado já protegido por RLS, mas UI não avisa corretamente):

1. 🔴 **`restore_company_backup`** grava em ~20 tabelas de praticamente todos os módulos opcionais sem checar `company_has_active_module` em nenhuma — o único dos 15 domínios de backend auditados com um gap de **escrita** não documentado como intencional.
2. 🔴 **Perfis de bobina/impressora** (`salvar_perfil_bobina` e família) nunca checam módulo, nem frontend nem backend — uma empresa sem o módulo Etiquetas configura impressoras normalmente.
3. ⚠️ Dashboard e abas do Financeiro renderizam dado financeiro sem checar `financeiro_avancado` (RLS bloqueia o dado, mas a UI quebra em vez de avisar).
4. ⚠️ `/backups` não tem nenhum gate de módulo no frontend (nem rota, nem componente).
5. ⚠️ Padrão `useModuleAccess` em Painel Operacional/Checklist dispara fetch de dados antes do gate resolver (sem vazamento real, mas mais fraco que `<ModuleGate>`).
6. ℹ️ `master_admin` tem bypass sistêmico e deliberado de todo o sistema de módulos — frontend **e** backend — inclusive dentro da própria empresa vinculada ao master, o que merece confirmação explícita do time (contradiz o princípio "master opera como admin_empresa fora do Master Panel" documentado internamente).

Nenhum dos achados de frontend representa vazamento bruto de dado — em todos os casos investigados, o RLS por trás bloqueia a leitura/escrita real. Os dois achados de backend (#1 e #2) são os únicos onde a proteção depende só de papel+tenant, sem checar módulo.

---

## 1. Estrutura de dados — catálogo de módulos disponíveis

**Tabela `module_catalog`** — criada em `supabase/migrations/20260414085805_91399c89-1acf-446c-bb29-f41d5de7f9cc.sql:8-25`.

Colunas relevantes: `feature_key` (UNIQUE), `ativo` (boolean — **é o único campo que determina "à venda"**), `tipo_modulo`, `is_capacity_module`, `categoria`, `destaque`, `metadata` (jsonb, carrega anotações `commercial_status`/`implementation_status` desde `20260817240000`/`20260817250000`, mas não é o que bloqueia comercialização — quem bloqueia é `ativo`).

RLS: 2 policies — master ALL, autenticado SELECT só `ativo=true`.

**Todos os 20 `feature_key` existentes** (INSERTs rastreados em `20260730073000`, `20260804195000_sync_canonical_module_catalog.sql`, `20260814090000_rfid_uhf_foundation.sql`; desativações finais em `20260817240000` e `20260817250000`):

| feature_key | `ativo` | Constante em `module-keys.ts` |
|---|---|---|
| `gestao_materiais`, `controle_estoque`, `checkin_checkout`, `locacao_materiais`, `manutencao_equipamentos`, `etiquetas_materiais`, `rfid_materiais` | ✅ true | sem `@deprecated` |
| `financeiro_avancado`, `relatorios`, `checklist_tecnico`, `documentos_avancados`, `painel_operacional`, `extra_usuarios`, `extra_eventos` | ✅ true | sem `@deprecated` |
| `agenda_compartilhada`, `equipe_permissoes`, `exportacoes_especiais`, `notificacoes_premium`, `extra_storage`, `relatorios_materiais` | ❌ false | `@deprecated` |

`src/constants/module-keys.ts:15-56` — 20 constantes em `MODULE_KEYS`, 1:1 com o catálogo; os 6 `@deprecated` batem exatamente com os 6 `ativo=false`. Nenhuma chave órfã dos dois lados.

## 2. Estrutura de dados — módulos ativos por empresa

**Tabela `empresa_modules`** — `20260414085805:50-65`. Colunas: `empresa_id`, `module_id`, `status` (CHECK: `active|inactive|pending|cancelled|rejected`), `activated_at`, `expires_at`, `granted_by_admin`, `origem`, `trial_granted`. Índice único parcial garante no máx. 1 linha `active` por (empresa, módulo).

RLS reescrita em `20260730043000_enforce_backend_entitlements.sql:535-555`: master ALL; tenant SELECT (`can_read_company_data`); tenant INSERT só para placeholder `pending`/onboarding. **Não existe policy de UPDATE/DELETE para tenant** — ativação real sempre passa por RPC `SECURITY DEFINER`.

RPCs que escrevem em `empresa_modules`: `activate_company_modules_checked` (chamada pelas 3 telas de aprovação master), `provision_company_module_entitlements` (placeholder `inactive` para todo módulo do catálogo, nunca concede acesso pago), `master_provision_company_module_entitlements`, `process_asaas_payment_webhook`, `deactivate_trial_modules`.

**O único valor de `status` tratado como "módulo ativo" em qualquer helper de backend é literalmente `'active'`** — `pending`, `inactive`, `cancelled`, `rejected` são todos "sem entitlement".

**Tabela `module_dependencies`** (`20260730073000:125-181`) — grafo módulo→pré-requisito. Validada em 4 camadas de backend (`company_module_dependencies_satisfied`, trigger `CONSTRAINT TRIGGER DEFERRABLE`, `activate_company_modules_checked`, `validate_inserted_module_batch_dependencies`). Sem tela de edição — só SQL direto.

## 3. Como o frontend identifica módulos contratados

- **`hasModule(featureKey)`** — closure em `src/hooks/useCompanyModules.ts:145-154`, lógica real em `src/lib/company-module-access.ts:1-16`: `catálogo tem a chave E ativo=true` **E** (`empresa é lifetime` OU `empresa_modules.status === 'active'` para essa chave). Síncrona (lê de `useMemo` sobre queries já resolvidas).
- **`useCompanyModules()`** — `src/hooks/useCompanyModules.ts:45-168`. 4 `useQuery` (licença lifetime, catálogo ativo, `empresa_modules` da empresa, `module_dependencies`), sem `staleTime` customizado (default do React Query = 0).
- **`ModuleGate`** — `src/components/ModuleGate.tsx:55-87`. Ordem: `isMasterAdmin` → bypass total (linha 64-65) → `isLoading` → `null` (sem flash) → `hasModule` → `children` → senão, conforme `mode` (`hide`/`lock`/`custom`). **Quando usado como wrapper JSX, bloqueia 100% do fetch dos filhos** — confirmado por teste (`ModuleGate.test.tsx:35-48,94-107`) e pela semântica de reconciliação do React (filho só monta/roda hooks quando o elemento é de fato retornado).
- **`useModuleAccess(featureKey)`** — hook irmão exportado no mesmo arquivo (`:123-131`), retorna `{canAccess, isLoading}` para uso **inline dentro do próprio componente**, em vez de envolver `children`. É estruturalmente mais fraco (ver seção 5) porque não impede os `useQuery` do mesmo componente de já terem disparado antes do `if` de bloqueio.

## 4. Sidebar / menu principal

`src/components/AppSidebar.tsx` (324 linhas, lido por inteiro). Padrão dominante: `isMasterAdmin || hasModule(FEATURE_KEY)`, replicado em 9 helpers `canShowXNavigation` (`src/lib/*-permissions.ts`).

- **Gated corretamente**: Materiais, Estoque, Check-in/Check-out, Scanner Remoto (reusa `checkin_checkout`), Locações, Clientes (reusa `locacao_materiais`), Manutenções, Etiquetas, RFID, Rastreabilidade (reusa `gestao_materiais`), Operação do Evento (OR `painel_operacional`/`checklist_tecnico`), Financeiro/Documentos/Funcionários/Relatórios (branch `admin_empresa`), Backups (`relatorios`).
- **Sem checagem de módulo (correto por design — não são módulos opcionais)**: Dashboard, Agenda, Empresa, Impressoras, Assinatura e Módulos, os 11 itens do Master Panel.
- **Achado cosmético**: "Usuários" no branch `admin_empresa` usa `hasModule(EQUIPE_PERMISSOES) || isAdminEmpresa` (`AppSidebar.tsx:186`) — como `equipe_permissoes` está desativado comercialmente e `isAdminEmpresa` já é sempre `true` nesse branch, a checagem de módulo é código morto (nunca influencia o resultado). Não é falha de segurança, é limpeza pendente.

## 5. Abas internas

- **Bom padrão** (`<TabsTrigger>` condicional): `EventDetail.tsx:220-221,226-235` (Painel Operacional/Checklist só aparecem com `useModuleAccess` true), `CheckinCheckout.tsx:384,388-392` (aba "Locações" com `rentalPermissions.visualizar`).
- **Padrão fraco com vazamento de fetch confirmado**: `OperacaoEvento.tsx:44-47` — as abas "Painel Operacional"/"Checklist" **sempre aparecem** como trigger; o gate real fica dentro de `PainelOperacional.tsx` (`useModuleAccess` linha 37, bloqueio linha 83-94) e `ChecklistCentral.tsx` (linha 21, bloqueio linha 53-64). Em ambos, os `useQuery` de dados (`events-operational`, `all-event-team`, `all-checklist-operational`) usam `enabled: !!empresaId` — **não** `enabled: canAccess` — e disparam antes do `if (!canAccess)` decidir esconder. Não há vazamento de dado (RLS protege), mas é uma janela real de fetch desnecessário/inconsistente com o resto do app.
- **`Financeiro.tsx`**: abas "Geral"/"Eventos" (linhas 294-295, 300-352) sempre aparecem sem checar `financeiro_avancado`; só "Locações"/"Manutenções" (296-297) são corretamente gated via `rentalsPermissions.visualizar`.
- Demais páginas com abas (`Estoque.tsx`, `Documentos.tsx`, dialogs de detalhe) têm abas 100% intra-módulo — sem problema.

## 6. Dashboard / cards / atalhos

`src/pages/Dashboard.tsx` (412 linhas, lido por inteiro).

| Elemento | Módulo | Gate? |
|---|---|---|
| Cards de eventos, gráfico "Status dos Eventos", "Próximo Evento"/"Eventos da Semana" | — (core) | N/A |
| **4 cards financeiros** (Recebido/Pendente/Despesas/Lucro) — linhas 229-263 | `financeiro_avancado` | ❌ **Não** |
| **Gráfico "Financeiro Mensal"** — linhas 313-335 | `financeiro_avancado` | ❌ **Não** |
| Seção "Locações" (Contratado/Recebido/A receber/Vencido) — linha 267 | `financeiro_avancado` | ✅ Sim (`rentalsPermissions.visualizar`) |

A query `financials-dashboard` (linhas 80-89) roda sem checar módulo — mas a tabela `financials` no Postgres **exige `financeiro_avancado` via RLS** (`can_read_company_module`, `20260808100000_enforce_master_tenant_isolation.sql:548-557`). Resultado prático: empresa sem o módulo vê os cards renderizados com dado vazio/zerado (RLS devolve nada) em vez da mensagem padrão de módulo bloqueado que o resto do app usa.

## 7. Botões / funcionalidades cross-module

| Elemento | Módulo | Gate? |
|---|---|---|
| Seção RFID no dialog de Materiais (`MaterialDetailsDialog.tsx:294-301`) | `rfid_materiais` | ✅ |
| Botão "Imprimir etiqueta" (`MaterialIdentificationCard.tsx:270-284`) | `etiquetas_materiais` | ✅ |
| Seção Estoque no dialog de Materiais (`:50-67,303-308`) | `controle_estoque` | ✅ |
| Seção Manutenção no dialog de Materiais (`:159-166,309`) | `manutencao_equipamentos` | ✅ |
| Card de Locação no Scanner Remoto (`ScannerRemoto.tsx:123,934`) | `locacao_materiais` | ✅ |
| Botão "Abrir locação {numero}" em Rastreabilidade (`RastreabilidadeMateriais.tsx:176-180`) | `locacao_materiais` | ❌ Não no frontend (RLS mitiga) |
| "Tag RFID ativa" (EPC) em Rastreabilidade (`:145-148,222-227`) | `rfid_materiais` | ❌ Não no frontend (RPC backend mitiga — só popula se `user_has_module_action(...,'view')`) |
| Opção "Conferência de locação" no seletor de sessão RFID (`RfidConferencia.tsx:48-55,100-121`) | `locacao_materiais` | ❌ Não (RLS mitiga, mas UX confusa) |
| Página Backups inteira (`Backups.tsx`) | `relatorios` | ❌ **Não** — só checagem de role (`backup-security.ts:5-9`) |

## 8. Proteção de rotas

`src/App.tsx` (273 linhas). **`ProtectedRoute.tsx` (42 linhas, lido por inteiro) não tem nenhum prop relacionado a módulo** — só `adminOnly`/`masterOnly`/`skipPlanCheck`. Todo bloqueio "antes do fetch" depende de alguém compor manualmente `<ModuleGate>` ao redor do elemento da rota, em `App.tsx`.

**Rotas de módulo com `<ModuleGate>` na própria rota (bloqueio garantido antes do fetch)**: `/materiais`, `/estoque`, `/checkin-checkout`, `/scanner-remoto`, `/locacoes`, `/clientes`, `/manutencoes`, `/etiquetas`, `/rfid`, `/rastreabilidade`, `/documentos` (App.tsx:105), `/funcionarios` (App.tsx:118-125, OR de 3 chaves).

**Rotas de módulo SEM `<ModuleGate>` na rota** (dependem de autogate interno mais fraco, ou de nada): `/financeiro` (autogate parcial só no botão exportar), `/backups` (**nenhum gate**), `/relatorios` (autogate via `useModuleAccess`, sem risco de dado pois é hub de navegação), `/operacao-evento` (autogate interno com vazamento de fetch, seção 5).

**Pendências antigas confirmadas como corrigidas**:
- `Documentos.tsx`/`Funcionarios.tsx` sem `ModuleGate` (P2-16 da auditoria de 08-30) → corrigido na **ETAPA 7** (commit `9b1f63b`, 2026-09-11), via composição em `App.tsx` (não dentro das próprias páginas).
- `src/pages/ModulosDisponiveis.tsx` (rota morta) → **arquivo removido** no commit `0c63f3e` (2026-09-11).
- Bug de `OnboardingModulos.tsx:76` (toda empresa nova via "zero módulos disponíveis") → **corrigido** no mesmo commit `0c63f3e`, agora usa `getSelfServiceAvailableModules`.

## 9. Proteção de backend (RLS / RPC / Edge Functions)

15 domínios auditados. **13 sem gap** (Materiais, Estoque, Check-in/Check-out, Locações, Manutenção, RFID, Scanner Remoto, Rastreabilidade, Documentos, Funcionários, Relatórios-superfície-própria, Push, Financeiro) — todos com RLS + RPCs `SECURITY DEFINER` checando `can_read/write_company_module` e/ou `user_has_module_action` (versão granular, usada desde RFID em 14/08 e estendida a Materiais/Estoque/Locação/Manutenção/Etiquetas entre 09-11/09 — "ETAPA 4"). Notificações Push é intencionalmente **não** module-gated (documentado no código — `_feature_key` só filtra destinatário do fan-out, não autoriza o chamador).

**2 gaps confirmados**:

1. **`restore_company_backup`** (`supabase/migrations/20260911150000_agenda_import_backup_restore_fix.sql:47`, mesmo padrão desde `20260817200000:6`) — chama `assert_actor_company_operational_access(v_actor_id, v_company_id, NULL)` com `_feature_key=NULL`, o que **pula inteiramente** a checagem `company_has_active_module` (definida em `20260730043000_enforce_backend_entitlements.sql:196-199`). A função then faz INSERT/UPSERT em ~20 tabelas — materiais, estoque, custódias, locações, manutenção, financeiro, RFID, etiquetas, bobina, funcionários, clientes, documentos — sem checar módulo para nenhuma. `_payload` é jsonb controlado pelo chamador, sem assinatura/checksum servidor provando que veio de um `gather_company_backup_data` real. Diferente de `gather_company_backup_data` (mesmo bypass, mas **documentado explicitamente no código** como decisão deliberada de manter export de dado histórico), este parece não-intencional.
2. **Perfis de bobina / configuração de impressora** — `listar_perfis_bobina`, `salvar_perfil_bobina`, `duplicar_perfil_bobina`, `excluir_perfil_bobina`, `definir_perfil_bobina_padrao`, `salvar_configuracao_impressora` (todas em `supabase/migrations/20260817170000_restore_bobina_master_tenant_isolation.sql`) checam só `has_role(admin_empresa) OR is_master_admin` + tenant — **nenhuma chama helper de módulo**. A policy da tabela `empresa_bobina_perfis` (`20260811140000_bobina_label_profiles.sql:104-107`) usa só `can_write_company_data` (tenant+papel, sem módulo). Conceitualmente pertence a `etiquetas_materiais`, mas nunca foi conectado ao entitlement em nenhuma camada.

Achados históricos já corrigidos (confirmam que o padrão de hardening é real e tem precedente no projeto): `20260808110000_harden_insecure_security_definer_functions.sql` (RPCs de provisionamento executáveis por `anon`) e `20260807090000_harden_financial_function_permissions.sql` (RPC financeira sem REVOKE, aceitava `_company_id` forjado).

## 10. Área de contratação / gerenciamento de módulos

Duas telas reais vendem módulo (consultam `module_catalog`): **`PlanoAssinatura.tsx`** (`/plano`, pós-onboarding) e **`OnboardingModulos.tsx`** (`/onboarding-modulos`, logo após escolher plano). Ambas usam `getSelfServiceAvailableModules`/`self-service-module-availability.ts`, que separa claramente "Módulos Ativos" / "Solicitações em andamento" / "Módulos Disponíveis" — nunca mistura.

`doesCompanyModuleBlockPurchase(status)` = `status === "active" || "pending"` → só esses dois bloqueiam nova compra; `cancelled`/`rejected`/`inactive` (placeholder) permitem contratar. `extra_storage` é excluído explicitamente de todas as telas (feature não implementada, `ativo=false` com CHECK permanente no banco) — não é vazamento, é placeholder consciente.

**Master Panel** (`/master/*`, todas `masterOnly`): `Modulos.tsx` (CRUD do catálogo global), `Empresas.tsx` → `EmpresaModulesManager` (ativa módulo de 1 empresa), `SolicitacoesModulos.tsx`, `SolicitacoesLoteModulos.tsx`, `PagamentosModulos.tsx` (as 3 aprovam via RPC). As "4 superfícies que ativam módulo" da auditoria de 08-17 — hoje **todas validam `module_dependencies`**: as 3 telas de aprovação via `activate_company_modules_checked` (RPC autoritativa), `EmpresaModulesManager` via checagem client-side **e** o trigger de banco universal (`CONSTRAINT TRIGGER DEFERRABLE`) que cobre qualquer escrita em `empresa_modules`. A correção veio no mesmo dia da auditoria antiga (commit `2fb495d`, 2026-08-17).

## 11. Regras especiais de Master/Admin

**Master tem bypass sistêmico e deliberado do sistema de módulos, em ambas as camadas:**

- **Frontend**: `ModuleGate.tsx:64-65` (`if (isMasterAdmin) return children`, antes até de checar `hasModule`), `useModuleAccess` (`:123-131`, `canAccess = isMasterAdmin || hasAnyModule(...)`), `AppSidebar.tsx:176-183` (Administração incondicional para master), e o mesmo padrão `isMasterAdmin || moduleEnabled` replicado em 9 arquivos `src/lib/*-permissions.ts`.
- **Backend**: `can_read_company_module`/`can_write_company_module` (`20260730043000_enforce_backend_entitlements.sql:122-162`, atualizada em `20260808100000:105-135`) checam `is_master_admin(auth.uid())` primeiro e liberam **para qualquer `_empresa_id`**, sem checar `company_has_active_module`.

**Isso vale mesmo dentro da própria empresa vinculada ao master** (não só no Master Panel global) — porque o gate em toda tela operacional é `isMasterAdmin || hasModule(...)`, o resultado real de `empresa_modules` para a empresa do master nunca é decisivo. Isso **contradiz** o princípio documentado internamente no projeto de que "master opera como admin_empresa comum fora do Master Panel, nunca faz bypass de dado operacional de UMA empresa" — esse princípio foi formulado para isolamento de *tenant* (não ler dado de OUTRA empresa), não para entitlement de *módulo*, e no código atual módulo é tratado como bypass total, não como bypass condicional. É consistente e replicado em 12+ pontos (não parece acidente), mas **recomendo confirmar explicitamente com o time de produto** se master deveria mesmo operar módulos que a própria empresa dele nunca contratou.

---

## 12. Tabela consolidada — todos os módulos

Legenda: ✅ protegido/correto · ⚠️ parcial (dado protegido no backend, UI inconsistente) · ❌ gap real · ➖ não aplicável · 🔵 decisão comercial (módulo fora de venda)

| Módulo | Menu/UI | Contratação | Rota | Backend | Status | Problema encontrado |
|---|---|---|---|---|---|---|
| **Gestão de Materiais** (`gestao_materiais`) | ✅ | ✅ | ✅ `ModuleGate` | ✅ RLS+RPC granular | ✅ OK | Nenhum |
| **Controle de Estoque** (`controle_estoque`) | ✅ | ✅ | ✅ `ModuleGate` | ✅ RPC-only granular | ✅ OK | Nenhum |
| **Check-in/Check-out** + Scanner Remoto (`checkin_checkout`) | ✅ | ✅ | ✅ `ModuleGate` (2 rotas) | ✅ RPC-only granular | ✅ OK | Nenhum |
| **Locação de Materiais** + Clientes (`locacao_materiais`) | ✅ (2 pontos cross-module sem gate local) | ✅ | ✅ `ModuleGate` (2 rotas) | ✅ RLS+RPC granular | ⚠️ PARCIAL | Botão "Abrir locação" (Rastreabilidade) e opção "Conferência de locação" (RFID) sempre visíveis; RLS mitiga |
| **Manutenção de Equipamentos** (`manutencao_equipamentos`) | ✅ | ✅ | ✅ `ModuleGate` | ✅ RPC-only granular | ✅ OK | Nenhum |
| **Etiquetas e Impressão** (`etiquetas_materiais`) | ✅ | ✅ | ✅ `ModuleGate` | ❌ perfis de bobina/impressora sem checagem alguma | 🔴 GAP | `/configuracoes/impressoras` não é module-gated em NENHUMA camada |
| **RFID / UHF** (`rfid_materiais`) | ✅ | ✅ | ✅ `ModuleGate` | ✅ RLS usa helper direto (mais estrito de todos) | ✅ OK | Nenhum |
| **Financeiro Avançado** (`financeiro_avancado`) | ❌ Dashboard + abas Geral/Eventos sem gate | ✅ | ❌ sem `ModuleGate` na rota | ✅ RLS exige o módulo | ⚠️ PARCIAL | UI renderiza vazio/zerado em vez de avisar "módulo não ativo" |
| **Relatórios** + Backups (`relatorios`) | ⚠️ Relatórios autogate fraco; ❌ Backups sem gate algum | ✅ | ⚠️/❌ | ✅ tabela `backups` protegida; ❌ **`restore_company_backup` não checa módulo para ~20 tabelas** | 🔴 GAP (mais sério da auditoria) | `/backups` sem gate de frontend; RPC de restore ignora entitlement |
| **Documentos Avançados** (`documentos_avancados`) | ✅ | ✅ | ✅ `ModuleGate` (corrigido ETAPA 7) | ✅ RLS direta | ✅ OK | Nenhum (pendência antiga resolvida) |
| **Painel Operacional** (`painel_operacional`) | ⚠️ aba sempre visível, conteúdo autogate | ✅ | ⚠️ sem `ModuleGate` na rota | ✅ via `funcionarios`/RLS geral | ⚠️ PARCIAL | `useQuery` dispara antes do gate resolver (`enabled: !!empresaId`, não `canAccess`) |
| **Checklist Técnico** (`checklist_tecnico`) | ⚠️ idem acima | ✅ | ⚠️ idem acima | ✅ idem acima | ⚠️ PARCIAL | Mesmo padrão de fetch antecipado |
| **Extra Usuários / Extra Eventos** (capacidade) | ➖ não é feature de tela | ✅ | ➖ | ✅ CHECK de valor>0 | ✅ OK | Nenhum (mecanismo diferente — capacidade, não feature) |
| **6 módulos fora de venda** (Agenda Compartilhada, Equipe e Permissões, Exportações Especiais, Notificações Premium, Extra Storage, Relatórios de Materiais) | ➖ `hasModule()` nunca true (catálogo filtra `ativo=true`) | ✅ corretamente ausentes | ➖ | ➖ | 🔵 decisão comercial | Cosmético: `hasModule(EQUIPE_PERMISSOES)` morto em `AppSidebar.tsx:186` |

**Regra especial cross-cutting**: `master_admin` faz bypass de `hasModule`/`ModuleGate` e das funções SQL de módulo em **todas** as linhas acima, inclusive dentro da própria empresa vinculada ao master (seção 11) — não está refletido linha a linha na tabela para não repetir, mas se aplica universalmente.

---

## Arquivos que precisam ser alterados para padronizar o controle de módulos

### P0 — proteção de backend (gap real, não é só UX)
1. **`supabase/migrations/` (nova migration)** — `restore_company_backup` (referência: `supabase/migrations/20260911150000_agenda_import_backup_restore_fix.sql:47`): adicionar `company_has_active_module` por tabela/coleção restaurada, ou documentar o bypass como decisão deliberada (mesmo padrão do comentário já existente em `gather_company_backup_data`, `supabase/migrations/20260818150000_extend_backup_rfid_labels_printing.sql:2159,2368`).
2. **`supabase/migrations/` (nova migration)** — proteger `salvar_perfil_bobina`, `duplicar_perfil_bobina`, `excluir_perfil_bobina`, `definir_perfil_bobina_padrao`, `salvar_configuracao_impressora` (`supabase/migrations/20260817170000_restore_bobina_master_tenant_isolation.sql`) e a policy de escrita de `empresa_bobina_perfis` (`supabase/migrations/20260811140000_bobina_label_profiles.sql:104-107`) com `can_write_company_module(empresa_id,'etiquetas_materiais')`.

### P1 — consistência de frontend (dado já protegido, UI precisa alinhar ao padrão do resto do app)
3. `src/pages/Backups.tsx` + `src/App.tsx:98` — envolver rota/página em `<ModuleGate featureKey={MODULE_KEYS.RELATORIOS}>`.
4. `src/pages/Dashboard.tsx:229-263,313-335` — gatear os 4 cards financeiros e o gráfico "Financeiro Mensal" com `hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO)`.
5. `src/pages/Financeiro.tsx` (+ `src/App.tsx:95`) — gatear a página ou ao menos as abas "Geral"/"Eventos" com `hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO)`.
6. `src/pages/PainelOperacional.tsx`, `src/pages/ChecklistCentral.tsx` — trocar `enabled: !!empresaId` por `enabled: !!empresaId && canAccess` nos `useQuery` de dados.
7. `src/pages/RfidConferencia.tsx:48-55` — esconder "Conferência de locação" quando `!hasModule(MODULE_KEYS.LOCACAO_MATERIAIS)`.
8. `src/pages/RastreabilidadeMateriais.tsx:176-180` — esconder/desabilitar "Abrir locação" quando `!hasModule(MODULE_KEYS.LOCACAO_MATERIAIS)`.

### P2 — arquitetura/prevenção (evitar que o próximo módulo repita o mesmo esquecimento)
9. `src/components/ProtectedRoute.tsx` — considerar um prop `requiredModule`/`featureKey` para proteção de rota centralizada (hoje depende 100% de alguém lembrar de compor `<ModuleGate>` manualmente em `App.tsx`; foi exatamente esse esquecimento que gerou o gap do Backups).
10. `src/components/AppSidebar.tsx:186` — remover `hasModule(MODULE_KEYS.EQUIPE_PERMISSOES)` morto.

### Confirmar intenção com o time (não é bug óbvio, é decisão de design a validar)
11. Bypass de `master_admin` em `src/components/ModuleGate.tsx:64-65` e em `can_read_company_module`/`can_write_company_module` (`supabase/migrations/20260808100000_enforce_master_tenant_isolation.sql`) — confirmar se master deve mesmo operar módulos não contratados pela própria empresa vinculada a ele.
