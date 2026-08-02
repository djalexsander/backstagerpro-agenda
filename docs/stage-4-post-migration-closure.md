# ETAPA 4 — VALIDAÇÃO PÓS-MIGRATION E FECHAMENTO

Data: 02/08/2026

Projeto: Backstage Pro

Branch: `main`
Migration: `20260802200000_material_rentals_stage_four.sql`

## Resultado executivo

A migration da Etapa 4 foi aplicada no Supabase remoto entre **20:25:03 e
20:25:10 BRT de 02/08/2026**. O arquivo aplicado manteve o SHA-256 validado:

`2B9C9206FA61CF53D1B7AAFA7D55CF9215630950D23B852000F5F5C53DA62736`

A lista de migrations ficou sincronizada e o dry-run posterior não encontrou
migrations, seeds ou roles pendentes. A auditoria remota foi somente leitura e
não criou clientes, locações, reservas ou outros dados fictícios.

**Conclusão técnica: a Etapa 4 pode ser declarada tecnicamente concluída.** A
implementação, a migration, os testes automatizados, os testes reais de
PostgreSQL e a validação remota foram aprovados. O E2E manual autenticado remoto
continua pendente e não foi contado como executado.

## 1. Pré-validação e aplicação

- branch confirmada: `main`;
- estado inicial da branch: 2 commits à frente de `origin/main`;
- worktree inicial da Etapa 4: somente arquivos do domínio de locações e suas
  integrações necessárias;
- única migration local pendente: `20260802200000_material_rentals_stage_four.sql`;
- nenhuma migration antiga aplicada foi modificada;
- SHA-256 recalculado e idêntico ao hash esperado;
- `git diff --check`: aprovado;
- varredura de secrets, credenciais e temporários: aprovada;
- push remoto: somente a migration da Etapa 4; nenhuma migration antiga, seed
  ou role foi reaplicada;
- alteração manual de dados fora da migration: nenhuma.

## 2. Sincronização local/remoto

Após a aplicação, `supabase migration list --linked` mostrou a versão
`20260802200000` nos lados local e remoto. `supabase db push --dry-run --linked`
retornou banco atualizado, com listas vazias de migrations, seeds e roles.

## 3. Schema remoto

A consulta somente leitura aos catálogos do PostgreSQL remoto confirmou:

- tabelas `clientes`, `material_locacao_numeradores`, `material_locacoes`,
  `material_locacao_itens` e `material_locacao_eventos`;
- enums `customer_person_type`, `material_rental_status`,
  `material_rental_billing_mode` e `material_rental_event_type`;
- índices por empresa, documento, cliente, status/período, responsável, atraso,
  material, histórico e referência de custódia;
- constraints de valores, período, quantidades, idempotência, numeração e
  formato do responsável;
- foreign keys compostas por `empresa_id` para cliente, locação, material,
  item e custódia;
- triggers de proteção contra mutação indevida do histórico operacional;
- 23 funções/RPCs da Etapa 4 com `SECURITY DEFINER` e
  `search_path=pg_catalog, public`.

## 4. Sistema modular canônico

O registro remoto `locacao_materiais` está ativo, marcado como operacional na
Etapa 4 e usa exclusivamente `module_catalog`, `empresa_modules` e
`module_dependencies`. As dependências confirmadas são:

- `checkin_checkout`;
- `controle_estoque`;
- `gestao_materiais`.

As fachadas usam `company_has_active_module`, `can_read_company_module` e
`can_write_company_module`; a interface usa `useCompanyModules` e `ModuleGate`.
Não foi criado sistema paralelo de permissões.

## 5. RLS, privilégios e segurança

RLS está habilitado nas cinco tabelas. As quatro tabelas de leitura do módulo
possuem policies `SELECT` para `authenticated`, condicionadas simultaneamente à
locação e às três dependências. O numerador não é exposto para leitura direta.

O catálogo remoto confirmou:

- `anon`: sem acesso às tabelas e sem execução das RPCs;
- `authenticated`: `SELECT` apenas onde previsto, sem `INSERT`, `UPDATE` ou
  `DELETE` direto;
- 17 fachadas autorizadas: executáveis somente por `authenticated`;
- 6 helpers internos: sem `EXECUTE` para `authenticated`, `anon` ou
  `service_role`;
- nenhum alargamento de privilégio e `search_path` seguro em todas as funções.

A autoridade permanece no backend. Os testes locais reais cobriram usuário
comum, administrador pelas regras canônicas de escrita, Master com empresa
selecionada, empresa somente leitura, empresa inativa, módulo desativado, falta
de entitlement e plano Vitalícia.

## 6. Cliente e multiempresa

A investigação da base anterior não encontrou entidade canônica reutilizável de
cliente. A migration criou `public.clientes` como cadastro canônico genérico de
PF/PJ, não como tabela específica da locação. Não existe `clientes_locacao` nem
snapshot paralelo.

`material_locacoes` referencia exclusivamente `clientes (empresa_id, id)`. As
FKs compostas e a resolução obrigatória de empresa bloqueiam cliente, material,
locação, item ou custódia de outra empresa. O pgTAP confirmou tanto a rejeição
da referência cruzada quanto a invisibilidade de locações de outro tenant.

## 7. Reserva e disponibilidade por período

Reserva é contexto comercial e não movimentação física. A disponibilidade é
derivada no backend a partir de `estoque_saldos`, descontando reservas válidas
sobrepostas. O intervalo adotado é semiaberto `[retirada, devolução)`, portanto
uma devolução e uma nova retirada no mesmo instante podem coexistir.

O schema remoto não contém colunas de saldo, estoque, quantidade retirada ou
quantidade devolvida persistidas nos cabeçalhos/itens da locação. A inspeção das
funções confirmou que `material_rental_availability` lê o saldo oficial e não
escreve em `estoque_saldos` nem em `estoque_movimentacoes`.

## 8. Concorrência e idempotência

A confirmação ocorre dentro de transação, com locks consultivos por
empresa/material em ordem estável e revalidação final de disponibilidade. A
idempotência é garantida por `client_uuid`, `payload_hash` e constraints únicas.

Evidência em PostgreSQL 16.14 local, com duas sessões reais:

- quantidade: saldo 10, reservas concorrentes 7 e 6; apenas uma confirmou e o
  total nunca chegou a 13;
- individual: duas reservas conflitantes do mesmo equipamento; apenas uma
  venceu;
- datas adjacentes não sobrepostas: ambas confirmaram;
- retries de criação, confirmação e operações críticas: sem duplicação.

Esses cenários não foram repetidos contra dados reais do remoto, por segurança.
A migration aplicada é byte a byte a mesma versão coberta por essa evidência.

## 9. Check-in / Check-out e estoque

A retirada chama `registrar_checkout_material`; a devolução chama
`registrar_checkin_material`. O catálogo remoto confirmou as duas delegações e
confirmou ausência de escrita direta dessas fachadas nas tabelas de estoque.

Assim:

- `estoque_saldos` permanece o saldo físico oficial;
- `estoque_movimentacoes` permanece o ledger oficial imutável;
- `materiais.quantidade` permanece somente projeção;
- `material_custodias` e seus eventos permanecem a fonte de retirada, posse e
  retorno físico;
- a locação apenas referencia cliente, item e custódia;
- não existe segundo saldo, ledger ou mecanismo de custódia.

Retirada parcial/total e devolução parcial/total são derivadas da custódia da
Etapa 3. Avarias e ocorrências continuam registradas nesse domínio físico.

## 10. Fluxos e status

O backend controla as transições:

`rascunho → reservada → pronta_retirada → em_andamento → parcialmente_devolvida → concluida`

As transições intermediárias são aplicadas somente quando compatíveis com as
quantidades de custódia. Atraso é derivado do prazo vencido com material ainda
em posse do cliente, não de status manual. Cancelamento preserva o histórico e
libera a reserva, mas é bloqueado quando existe material fora. Edição e remoção
de itens ficam restritas ao rascunho.

Criação, edição, confirmação, disponibilidade, retiradas, devoluções,
cancelamento e conclusão foram revalidados por domínio, serviço, interface e
pgTAP. A rota `/locacoes`, o gate modular, a sidebar, os indicadores, filtros,
paginação, scanner/busca e detalhe permanecem compilados no build de produção.

## 11. Valores e integrações futuras

Itens armazenam quantidade, modalidade/unidades de cobrança, valor unitário,
desconto e subtotal gerado; o cabeçalho mantém valor bruto, desconto e total com
constraints de consistência. Não foi criado segundo sistema monetário ou
Financeiro, e nenhuma conta a receber foi gerada nesta execução.

Os identificadores opcionais de financeiro, orçamento e contrato apenas
preparam integrações futuras. Não foram criados sistemas paralelos de orçamento,
evento, contrato ou agenda.

## 12. Testes e regressão

| Validação | Resultado |
| --- | --- |
| Vitest completo | 40 arquivos, 282/282 testes aprovados |
| Testes novos de locação | 19 aprovados dentro da suíte |
| TypeScript | `npx tsc --noEmit` aprovado |
| Build de produção | aprovado |
| ESLint direcionado | aprovado |
| pgTAP em PostgreSQL 16.14 real | 70/70 aprovado novamente |
| Aplicação limpa e recriação local | aprovadas na validação pré-deploy |
| Rollback transacional | aprovado na validação pré-deploy |
| Atomicidade com falhas forçadas | retirada, devolução e cancelamento aprovados |
| Concorrência em duas sessões | quantidade, individual e datas não conflitantes aprovados |
| `git diff --check` | aprovado |
| Supabase lint remoto | sem erros |
| Migration list e dry-run remoto | sincronizados, sem pendências |

O build mantém avisos globais já existentes sobre tamanho de chunks, importação
do `pdfjs-dist` e externalização de `buffer`; não são regressões da Etapa 4.

## 13. Supabase lint

O lint remoto não encontrou erros de schema. Foram emitidos avisos
`STABLE/VOLATILE` em consultas das Etapas 3 e 4. Na Etapa 4, eles atingem as
fachadas de leitura que resolvem empresa/permissão e, em indicadores, consultam
o relógio. São avisos conhecidos, não falhas de integridade ou segurança, e
permanecem como dívida separada para evitar alteração pós-validação da migration.

## 14. Tipos Supabase

O método oficial sem Docker funcionou:

`supabase gen types --linked --schema public`

`src/integrations/supabase/types.ts` foi regenerado diretamente do schema remoto
e agora contém as tabelas, enums, relacionamentos e RPCs da Etapa 4. A fronteira
RPC tipada passou novamente em TypeScript, testes e build. Não houve edição
manual do contrato gerado.

O `supabase db dump --linked --schema public` ainda depende de Docker nesta
máquina e não produziu dump. Essa limitação foi contornada com a consulta
oficial `supabase db query --linked` aos catálogos remotos, estritamente somente
leitura, que confirmou RLS, policies, privilégios, constraints, índices,
triggers, funções e integrações.

## 15. Smoke test remoto

O smoke test remoto foi limitado a operações seguras e reversíveis:

- migration history e dry-run;
- lint remoto;
- geração de tipos pelo schema remoto;
- consultas somente leitura a catálogos, módulos, dependências, RLS, policies,
  privilégios, funções, índices, constraints e triggers;
- confirmação de bloqueio de `anon`, bloqueio dos helpers internos e exposição
  exclusiva das fachadas a `authenticated`.

Nenhum registro de negócio foi criado ou alterado. Não havia sessão autenticada
de browser adequada para validar os papéis contra dados reais.

**E2E manual autenticado remoto: pendente.**

## 16. Limitações, riscos e dívidas pendentes

Limitações e riscos residuais:

- E2E manual autenticado remoto ainda pendente;
- concorrência não repetida remotamente para não tocar dados reais;
- avisos `STABLE/VOLATILE` conhecidos no lint;
- integração financeira automática, multas, contratos e documentos continuam
  deliberadamente fora do escopo;
- os avisos globais de bundle permanecem sem relação com locações.

Dívidas herdadas e mantidas separadas:

- E2E manual autenticado remoto das etapas anteriores;
- reconciliação nominal de estoque legado;
- débitos globais antigos de lint;
- warnings `STABLE/VOLATILE` das RPCs anteriores.

## 17. Estado de conclusão

- **Implementação:** concluída;
- **Migration:** aplicada e sincronizada no Supabase remoto;
- **Testes automatizados:** aprovados;
- **PostgreSQL real:** pgTAP, rollback, atomicidade e concorrência aprovados;
- **Validação remota:** aprovada por migration history, dry-run, lint, tipos e
  auditoria somente leitura dos catálogos;
- **E2E manual autenticado remoto:** pendente, não executado;
- **Git:** commit exclusivo de fechamento integra este relatório; o hash é
  informado no handoff final. Nenhum push, tag ou release foi realizado.

## Resposta final

**A Etapa 4 pode ser declarada tecnicamente concluída?**

**Sim.** A pendência de E2E manual autenticado remoto permanece registrada como
validação operacional posterior e não invalida as evidências técnicas de banco,
segurança, aplicação e integração aprovadas nesta etapa.
