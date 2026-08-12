# Check-in / Check-out — guia de referência para desenvolvimento

Este documento é uma referência viva para quem for manter ou estender o
fluxo de check-in/check-out de materiais. Ele descreve como o código atual
está organizado e por que as regras não óbvias existem.

Para o histórico de entrega (o que foi implementado, testado e validado na
Etapa 3), veja `docs/stage-3-checkin-checkout-implementation-report.md` e
`docs/stage-3-post-migration-closure.md`. Este guia não substitui esses
relatórios; ele existe para não precisar reabrir um relatório de etapa toda
vez que alguém precisar entender o fluxo para dar manutenção.

## Mapa de arquivos

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| Tipos | `src/lib/checkin-checkout-types.ts` | Enums são derivados de `Database["public"]["Enums"]` em `src/integrations/supabase/types.ts` (gerado do schema) — essa é a fonte da verdade só para eles. Os contratos dos payloads JSON retornados pelas RPCs são interfaces escritas manualmente, sem vínculo estático com o tipo gerado (o serviço converte com `as unknown as`, sem validação em runtime); precisam ser atualizados manualmente sempre que o retorno de uma RPC mudar. |
| Regras de UI | `src/lib/checkin-checkout-domain.ts` | Normalização de leitura de scanner, casamento de identificador, cálculo de ações válidas (`getCustodyMaterialActions`) e validação de formulário (`validateCheckout`/`validateCheckin`). Espelha, no cliente, um subconjunto das checagens que o banco também faz — ver "Validação em duas camadas" abaixo. |
| Acesso a dados | `src/lib/checkin-checkout-service.ts` | Único ponto de chamada às RPCs (`supabase.rpc(...)`). Não há `insert`/`update`/`delete` direto nas tabelas de custódia ou estoque a partir do frontend. |
| Erros | `src/lib/checkin-checkout-errors.ts` | Traduz códigos de erro levantados pelas funções SQL (`CIxxx`, `STxxx`) e nomes de constraint em mensagens em português. |
| Permissões | `src/lib/checkin-checkout-permissions.ts` | Deriva `visualizar`/`checkout`/`checkin`/`cancelar` a partir do papel canônico do usuário, do módulo habilitado e do modo somente leitura da empresa. Não é um sistema de permissões novo — reaproveita os mesmos três papéis (`master_admin`, `admin_empresa`, `usuario`) usados no resto do projeto. |
| Dados/cache | `src/hooks/useCheckinCheckout.ts` | Consultas React Query da tela (operações abertas, histórico, indicadores, responsáveis, localizações) e invalidação de cache após qualquer operação. |
| Tela | `src/pages/CheckinCheckout.tsx` | Busca/identificação de material, listagem de operações abertas e histórico, abertura dos diálogos. |
| Diálogos | `src/components/checkin-checkout/*.tsx` | `CheckoutDialog`, `CheckinDialog`, `CancelCheckoutDialog`, `CustodyHistoryDialog` — um formulário por operação. |

## Fluxo resumido

1. **Identificação**: o operador digita ou lê (teclado USB/Bluetooth ou
   câmera) um identificador. `CheckinCheckout.tsx` normaliza a leitura
   (`normalizeCustodyScan`) e chama `searchCustodyMaterials`, que executa a
   RPC `buscar_materiais_custodia`. Câmera, scanner físico e digitação
   manual convergem para a mesma função e a mesma RPC — não existe uma
   segunda regra de identificação para a câmera.
2. **Ações válidas**: `getCustodyMaterialActions` decide, a partir do saldo
   disponível e das custódias abertas retornadas pela RPC, se check-out e/ou
   check-in fazem sentido para aquele material. A tela só oferece os botões
   compatíveis com o estado atual.
3. **Check-out**: `CheckoutDialog` valida localmente com `validateCheckout`
   e chama `registerCheckout`, que executa `registrar_checkout_material`.
   A RPC valida tudo de novo no banco, grava a saída no ledger de estoque,
   cria a custódia e o evento, tudo na mesma transação.
4. **Check-in**: `CheckinDialog` valida localmente com `validateCheckin` e
   chama `registerCheckin`, que executa `registrar_checkin_material`. Uma
   devolução parcial mantém a custódia em `parcial`; só quando o saldo
   pendente chega a zero o status vira `concluida`.
5. **Cancelamento**: `CancelCheckoutDialog` chama `cancelCheckout`
   (`cancelar_checkout_material`), permitido apenas antes de qualquer
   devolução.

Detalhes de schema, RLS, locks e transações estão documentados na migration
`supabase/migrations/20260802160000_material_checkin_checkout_stage_three.sql`
e no relatório da Etapa 3 — este guia não os duplica.

**Atenção:** migrations posteriores redefinem (`CREATE OR REPLACE FUNCTION`)
parte dessas funções — notavelmente `registrar_checkin_material` em
`supabase/migrations/20260806080000_fix_rental_status_sync_on_generic_checkin.sql`
(sincronização de status de locação no check-in genérico) e
`resolve_custody_company` em
`supabase/migrations/20260808100000_enforce_master_tenant_isolation.sql`
(isolamento multiempresa). Ao investigar o comportamento atual de uma RPC,
procure a definição cronologicamente mais recente (a última migration com
`CREATE OR REPLACE FUNCTION` para aquele nome), não apenas a migration
original acima.

## Validação em duas camadas

`checkin-checkout-domain.ts` reimplementa em TypeScript uma parte das
checagens que `registrar_checkout_material`/`registrar_checkin_material`
também fazem em SQL (quantidade positiva, item individual só sai com
quantidade 1, quantidade não pode superar o saldo/pendente, etc.). Isso é
proposital: a validação no cliente existe só para dar feedback imediato no
formulário. **O banco continua sendo a única autoridade** — qualquer
alteração de regra de negócio precisa mudar a função SQL primeiro; o
espelho no cliente deve ser atualizado depois, para não divergir e para não
dar a falsa impressão de que valida algo que o servidor não reforça.

## Erros

`checkin-checkout-errors.ts` traduz erros por dois mecanismos
independentes, ambos passados a `translateSupabaseError` dentro de
`translateCustodyError`:

- `CUSTODY_ERROR_MESSAGES` (usado como `codeMessages`) traduz os códigos
  `RAISE ... USING ERRCODE` levantados pelas funções SQL (prefixos
  `CIxxx`/`STxxx`) — lembre-se de checar a definição mais recente da
  função, ver a nota de redefinições acima.
- `uniqueConstraintMessages`, um objeto separado definido na própria
  `translateCustodyError`, traduz nomes de constraint única violada (ex.:
  `material_custodias_individual_active_uidx`). Esses nomes não passam por
  `CUSTODY_ERROR_MESSAGES`.

Se uma RPC passar a levantar um código novo, ou uma constraint única sem
tradução for violada, o usuário vê a mensagem genérica de
`fallbackMessage` até que alguém adicione a tradução correspondente. Ao
investigar um erro não traduzido, procure primeiro o código/nome na
definição SQL mais recente, não neste arquivo.

## Permissões

`getCustodyPermissions` não cria uma tabela de permissões nova: ela só
projeta o papel canônico do usuário (`role`), o módulo habilitado
(`checkin_checkout` + dependências `gestao_materiais` e
`controle_estoque`, resolvidos por `useCompanyModules`/`MODULE_KEYS`) e o
modo somente leitura da empresa (`empresaReadOnly`, do `AuthContext`) nas
quatro ações da tela. Qualquer papel além de `master_admin`,
`admin_empresa` e `usuario` é tratado como sem acesso. Escrita
(`checkout`/`checkin`/`cancelar`) exige `master_admin` ou `admin_empresa` —
`usuario` só visualiza. Essas mesmas checagens são refeitas no banco pelas
RPCs; o cliente nunca é a autoridade final.

## Invalidação de cache

Depois de qualquer operação (check-out, check-in, cancelamento),
`invalidateCustody` em `useCheckinCheckout.ts` invalida não só as próprias
queries da tela, mas também `material-rentals`/`material-rental-indicators`/
`material-rental-detail`. Isso existe porque uma custódia pode pertencer a
uma locação do módulo Locações (`referencia_tipo = 'locacao_item'`); sem
essas invalidações, o backend recalcula corretamente, mas a tela de
Locações mostrava dado velho até um reload manual. Se um novo módulo
passar a referenciar custódias (via `referencia_tipo`/`referencia_id`), a
invalidação correspondente deve ser adicionada aqui também.
