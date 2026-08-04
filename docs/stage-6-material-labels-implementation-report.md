# ETAPA 6 — ETIQUETAS E IMPRESSÃO — RELATÓRIO DE IMPLEMENTAÇÃO

Data da validação: 04/08/2026

Migration: `20260804090000_material_labels_printing_stage_six.sql`

SHA-256: `82898290113D299B13B3A833398840127A176E10B3B7AAEF3339D96DEA7BC714`

Aplicação no Supabase remoto: **não executada**

Commit, push, tag e release: **não realizados**

## Resultado executivo

A Etapa 6 foi implementada e validada localmente em PostgreSQL 16.14. O módulo
oferece modelos dimensionais por empresa, QR Code, código de barras Code 128,
pré-visualização, impressão em lote e histórico imutável com snapshot do modelo
e do material.

O histórico registra **solicitação de impressão**, e não confirma saída física.
Essa distinção é intencional: a API de impressão do navegador não informa com
confiabilidade se o usuário concluiu o diálogo ou se a impressora produziu papel.

## Arquitetura e integração

- `etiquetas_materiais` foi liberado no catálogo modular;
- a dependência canônica permanece `etiquetas_materiais` → `gestao_materiais`;
- não foram criados material, identificador, saldo ou cadastro patrimonial paralelo;
- QR e código de barras vêm exclusivamente de `materiais`;
- imprimir não altera `materiais`, Estoque, Custódia, Locação ou Manutenção;
- o detalhe do material possui CTA para o módulo de etiquetas;
- Master exige seleção explícita de empresa;
- empresas em modo somente leitura preservam consultas e bloqueiam gravações.

## Modelo de dados

### `etiqueta_modelos`

Armazena nome, dimensões em milímetros, tipo de identificação, campos ordenados,
tamanho da fonte, borda, modelo padrão, estado ativo e versão otimista. Há um
único modelo padrão ativo por empresa.

Dimensões aceitas: largura de 20 a 210 mm e altura de 10 a 297 mm. Os campos são
validados no backend contra uma lista fechada e não podem se repetir.

### `etiqueta_impressoes`

Ledger append-only de solicitações, com quantidade de 1 a 500, ator, data,
`client_uuid`, hash SHA-256, referência opcional de reimpressão e snapshots JSON
do modelo e material. Alterações futuras no cadastro ou no modelo não reescrevem
o conteúdo histórico.

## Segurança

- RLS ativo em modelos e histórico;
- leitura condicionada a `can_read_company_module`;
- escrita apenas por RPCs que usam `can_write_company_module` e acesso operacional;
- tabelas sem INSERT/UPDATE/DELETE para `authenticated`;
- helpers internos sem EXECUTE para `anon`, `authenticated` e `service_role`;
- funções `SECURITY DEFINER` com `search_path = pg_catalog, public`;
- referências críticas usam empresa e ID, impedindo vínculo cruzado de tenant;
- histórico protegido contra UPDATE e DELETE inclusive fora da aplicação.

## Idempotência, concorrência e atomicidade

O registro de impressão usa advisory lock por empresa/`client_uuid` e hash do
payload. Retry equivalente retorna o mesmo registro; reutilização da chave com
payload diferente falha com `LB016`.

Duas sessões PostgreSQL simultâneas com a mesma chave e quantidade 5 produziram:

- `same_request_rows=1`;
- `same_request_quantity=5`.

Falhas forçadas ao inserir o log de auditoria confirmaram rollback integral de:

- criação de modelo;
- registro de solicitação de impressão.

## Interface

- página `/etiquetas` protegida por `ModuleGate`;
- navegação condicionada ao módulo;
- indicadores de modelos, materiais identificados e impressões do dia;
- criação, edição, definição de padrão e inativação de modelos;
- pesquisa por nome, código, QR, barras, série ou patrimônio;
- prévia em dimensão proporcional;
- impressão em página configurada em milímetros e lote de até 500 unidades;
- Code 128 escaneável gerado por `jsbarcode`;
- instrução explícita para escala 100%, sem margem nem cabeçalho;
- histórico com material, modelo/versão, quantidade, data e solicitante.

## Tipos e dependências

Os tipos Supabase locais foram sincronizados com as duas tabelas e sete RPCs da
Etapa 6. Foram adicionados:

- `jsbarcode@3.12.1`;
- `@types/jsbarcode@3.11.4` como dependência de desenvolvimento.

O `npm audit` reportou 12 vulnerabilidades no conjunto atual de dependências
(1 baixa, 2 moderadas e 9 altas). Não foi aplicado `npm audit fix`, pois uma
atualização automática ampla está fora do escopo funcional e exige avaliação
separada de compatibilidade.

## Evidências

- pgTAP: **38/38 PASS**;
- Vitest: **46 arquivos, 306/306 PASS**;
- TypeScript: **PASS**;
- ESLint direcionado: **PASS**;
- build de produção: **PASS**;
- `git diff --check`: **PASS**;
- aplicação transacional da migration: **PASS**;
- replay desde `template0`: **PASS**;
- rollback transacional: **PASS**;
- atomicidade com falha forçada: **PASS**;
- concorrência real em duas sessões: **PASS**.

O replay limpo aplicou todas as migrations relevantes. A migration antiga
isolada de `pg_cron`/`pg_net` foi omitida no PostgreSQL Ubuntu puro, seguindo o
mesmo procedimento documentado nas etapas anteriores.

## Limitações e pendências

- migration ainda não aplicada no Supabase remoto;
- E2E manual autenticado remoto ainda não executado;
- impressão física deve ser validada nas impressoras e mídias realmente usadas;
- o navegador pode bloquear pop-ups; a interface informa como liberar;
- não há descoberta automática de impressora, linguagem ZPL/EPL ou impressão
  silenciosa, pois isso exigiria integração nativa específica;
- a precisão final depende da configuração do driver em escala 100%.

## Estado do Git

As alterações estão somente no worktree. Nenhum commit, push, tag ou release foi
realizado. A Etapa 5 não foi alterada.

## Conclusão

A implementação local da Etapa 6 está tecnicamente validada. A conclusão oficial
e o deploy remoto devem seguir autorização específica, backup e o fluxo normal
de aplicação/validação pós-migration.
