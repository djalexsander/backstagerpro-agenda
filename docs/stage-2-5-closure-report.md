# ETAPA 2.5 — FECHAMENTO DAS ETAPAS 1 E 2

Data da validação: 02/08/2026
Projeto Supabase vinculado: `zupcxxtnaglcappazciu`

## Resultado executivo

A estabilização de código foi concluída sem iniciar a Etapa 3. O frontend de
Materiais e Estoque passou a usar seleção explícita de empresa para o Master e
o Estoque não oferece escrita quando entitlement, dependência, plano, licença,
pagamento ou estado operacional da empresa selecionada não permitem a operação.

A migration da Etapa 2 (`20260730080000_stock_control_stage_two.sql`) e a
migration incremental da Etapa 2.5 estão aplicadas no remoto. A aplicação da
2.5 foi autorizada e executada em 02/08/2026.

As Etapas 1 e 2 ainda não devem ser declaradas oficialmente concluídas: faltam
obter a lista direcionada dos registros legados que exigem decisão humana,
executar pgTAP e concorrência real em duas sessões e validar as personas
autenticadas no remoto.

## Alterações realizadas

- seleção explícita de empresa do Master em `/materiais` e `/estoque`, mantida
  no parâmetro `empresa` da URL e apresentada por um seletor compartilhado;
- usuários comuns continuam usando exclusivamente `AuthContext.empresaId`; o
  parâmetro da URL não substitui a empresa canônica deles;
- hooks de Materiais, Estoque e módulos aceitam a empresa já resolvida pela
  página, sem criar outro contexto global;
- `canWrite` de Estoque passou a considerar os módulos `gestao_materiais` e
  `controle_estoque`, empresa selecionada, papel, plano ativo, licença
  Vitalícia, pagamento, vencimento, trial, bloqueio e empresa ativa/inativa;
- consultas de Estoque ficam desabilitadas quando a empresa selecionada não tem
  acesso; ações de movimento, ajuste, estorno e localizações não são exibidas;
- o detalhe de Material recebe o mesmo contexto e não mostra atalhos de Estoque
  que o backend recusaria;
- filtros, ordenação e coluna baseados em `materiais.localizacao` foram removidos
  da tela de Materiais;
- `materiais.localizacao` foi formalizado como histórico somente leitura, sem
  remoção de coluna ou dados;
- a view de reconciliação foi ampliada com localização legada, existência de
  movimentos e classificação segura para decisão humana;
- tipos Supabase substituídos pela saída exata de `supabase gen types typescript
  --linked --schema public`;
- documentação da Etapa 2 corrigida para registrar a migration remota aplicada.

## Migration criada

- `supabase/migrations/20260802090000_stage_2_5_stock_stabilization.sql`

Ela:

- revoga `UPDATE(localizacao)` do papel `authenticated`;
- impede inserção/alteração autenticada do texto legado pelo CRUD comum;
- preserva dados existentes e permite manutenção administrativa sem sessão de
  usuário para migrations futuras;
- não cria saldos nem movimentos;
- amplia `estoque_reconciliacao_legado` sem concedê-la ao cliente autenticado.

Antes da publicação, o dry-run confirmou que somente essa migration estava
pendente. Depois da publicação, `supabase migration list --linked` confirmou os
timestamps local e remoto `20260802090000`.

## Reconciliação de `quantidade_legada_etapa1`

Nenhuma movimentação automática foi criada. A estratégia e a consulta nominal
estão em `docs/stage-2-5-legacy-reconciliation.md`.

Os valores reais não puderam ser listados com segurança neste ambiente. Não há
cliente SQL direcionado nem sessão autenticada no navegador; a exportação ampla
de dados públicos foi recusada por exceder o escopo necessário. Portanto, a
lista exata de registros com `decisao_humana_pendente` ou
`revisao_historica_pendente` permanece pendente e não foi inventada.

## Testes e resultados reais

| Validação | Resultado |
| --- | --- |
| `npm test -- --reporter=dot` | aprovado: 34 arquivos, 240 testes |
| `npx tsc --noEmit` | aprovado |
| `npm run build` | aprovado: 4.243 módulos transformados |
| ESLint nos arquivos alterados | aprovado |
| `git diff --check` | aprovado |
| `supabase migration list --linked` | Etapa 2 confirmada no remoto |
| geração de tipos `--linked --schema public` | aprovado; arquivo idêntico à saída remota |
| `supabase db lint --linked --schema public --level warning --fail-on error` | aprovado: sem erros de schema |
| `supabase db push --linked --yes` | aprovado; migration 2.5 aplicada |
| ESLint global | reprovado por dívida anterior: 357 erros e 11 avisos, incluindo `src-tauri/target` e muitos `any` fora do escopo |
| pgTAP Etapas 1 e 2 com `--linked` | não executado; CLI encerrou antes dos testes com `LegacyDockerRunError` |
| pgTAP Etapa 2.5 | preparado em arquivo, não executado antes da migration |
| concorrência: saída, transferência, saldo inicial e estorno | não executada; sem Docker, Podman ou `psql` para duas sessões |

O build manteve avisos não bloqueantes já conhecidos: `buffer` externalizado por
`docx`, import estático/dinâmico de `pdfjs-dist` e chunk principal acima de 500
kB.

## Segurança revisada

- isolamento por empresa: frontend comum deriva somente de
  `AuthContext.empresaId`; backend mantém empresa canônica, RLS e FKs compostas;
- RLS: migrations aplicadas habilitam RLS em materiais, categorias,
  localizações, saldos e movimentos; saldos/ledger não aceitam escrita direta;
- `company_has_active_module`: permanece a fonte canônica de entitlement e
  dependências no backend;
- `can_read_company_module`: continua limitando leitura de usuários comuns à
  própria empresa e aos módulos ativos;
- `can_write_company_module`: continua exigindo administrador da empresa ou o
  fluxo Master canônico; Estoque adiciona as verificações operacionais em
  `resolve_stock_company`;
- Vitalícia: reconhecida somente pela periodicidade canônica `vitalicio` e por
  plano ativo;
- somente leitura/inativa/módulo desativado: escrita e ações visuais de Estoque
  bloqueadas, sem apagar dados;
- Master: exige empresa explícita para as duas páginas; no Estoque também exige
  entitlement/dependência e empresa operacional para escrever;
- administrador da empresa: leitura/escrita conforme módulo e estado da própria
  empresa;
- usuário comum: leitura conforme módulo, sem ações de gestão ou movimentação.

## Arquivos modificados/criados

- `src/pages/Materiais.tsx`
- `src/pages/Estoque.tsx`
- `src/components/company/CompanyContextSelector.tsx`
- `src/components/materials/MaterialDetailsDialog.tsx`
- `src/hooks/useCompanyModules.ts`
- `src/hooks/useMaterials.ts`
- `src/hooks/useStock.ts`
- `src/lib/access-control.ts`
- `src/lib/access-control.test.ts`
- `src/lib/material-filters.ts`
- `src/lib/material-filters.test.ts`
- `src/lib/stock-permissions.ts`
- `src/lib/stock-permissions.test.ts`
- `src/lib/stock-service.ts`
- `src/integrations/supabase/types.ts`
- `supabase/migrations/20260802090000_stage_2_5_stock_stabilization.sql`
- `supabase/tests/stock_control_stage_2_5_test.sql`
- `docs/stock-control-stage-two.md`
- `docs/stock-control-stage-two-delivery-report.md`
- `docs/stock-control-stage-two-manual-test.md`
- `docs/stage-2-5-legacy-reconciliation.md`
- `docs/stage-2-5-concurrency-validation.md`
- `docs/stage-2-5-closure-report.md`
- `docs/stage-2-5-post-migration-validation.md`

## Pendências e riscos

1. executar as suítes pgTAP das Etapas 1, 2 e 2.5 com resultado TAP real;
2. executar os quatro ensaios concorrentes em duas sessões;
3. executar a consulta administrativa filtrada de reconciliação e registrar os
   materiais que precisam de decisão humana;
4. executar o ensaio autenticado das personas e estados empresariais no remoto.

A dívida global de ESLint, que antecede esta etapa, permanece como risco a ser
tratado separadamente.

## Estado do Git

Worktree modificado, sem commit, push, tag ou release. Há arquivos modificados e
novos exclusivamente desta estabilização/documentação; a migration 2.5 foi
aplicada ao remoto. `git diff --check` está limpo.

## Conclusão oficial

**Ainda não.** O código frontend e as validações automatizadas disponíveis estão
estáveis, e a Etapa 2 está comprovadamente aplicada no remoto. Porém, as Etapas
1 e 2 só podem ser consideradas oficialmente concluídas após as quatro
condições de fechamento acima terem evidência real. A Etapa 3 não foi
iniciada.
