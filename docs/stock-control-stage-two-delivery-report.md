# Etapa 2 — Relatório de entrega

## Estado da entrega

O código da Etapa 2 está implementado e a migration
`20260730080000_stock_control_stage_two.sql` está aplicada no projeto remoto.
Esse estado foi confirmado em 02/08/2026 com `supabase migration list --linked`.
Os testes frontend foram reexecutados na estabilização 2.5. Os testes pgTAP e o
ensaio concorrente ainda dependem de um cliente PostgreSQL/Docker disponível.

Não foram executados commit, push de Git, tag ou release. O comando
`supabase db push --linked --yes` foi executado em 02/08/2026 exclusivamente
para aplicar a migration incremental autorizada da Etapa 2.5.

## Resumo da implementação

A Etapa 2 transforma o estoque em um domínio transacional integrado ao catálogo
modular e multiempresa existente:

- página operacional `/estoque`, protegida por `ModuleGate`;
- menu condicionado ao módulo `controle_estoque`;
- localizações hierárquicas;
- saldo oficial por material/localização;
- ledger imutável;
- saldo inicial explícito;
- entrada, saída, transferência, ajuste e estorno;
- locks, idempotência e constraints de segunda barreira;
- RLS e permissões baseadas nas funções modulares canônicas;
- paginação de saldos e histórico no servidor;
- integração com cadastro e detalhes de Materiais;
- mensagens seguras para erros PostgreSQL/Supabase.

## Decisões arquiteturais finais

### Tabelas canônicas

Foi usado exclusivamente o conjunto:

- `estoque_localizacoes`;
- `estoque_saldos`;
- `estoque_movimentacoes`.

Não foi criado conjunto paralelo com prefixo `materiais_`.

### Fonte oficial do saldo

- `estoque_saldos` é a única fonte oficial do estado atual.
- `estoque_movimentacoes` é a fonte oficial do histórico.
- saldo, projeção e ledger são alterados na mesma transação.
- a view `estoque_divergencias_saldo` identifica qualquer divergência.

### `materiais.quantidade`

O campo foi mantido temporariamente como projeção técnica da soma dos saldos:

- não é enviado pelo formulário nem pelo `material-service`;
- clientes autenticados não recebem permissão de atualização dessa coluna;
- trigger rejeita alterações fora do contexto interno de projeção;
- trigger de `estoque_saldos` recalcula a projeção;
- o valor anterior à Etapa 2 é preservado em
  `quantidade_legada_etapa1`;
- materiais novos sempre começam com projeção zero;
- uma migration futura poderá remover a projeção e o campo legado depois da
  reconciliação.

### `materiais.localizacao`

O texto livre foi mantido somente por compatibilidade:

- não participa de nenhuma operação;
- não é convertido automaticamente em localização oficial;
- não é sincronizado com `estoque_localizacoes`;
- não aparece como saldo ou localização atual;
- pode ser removido em migration futura após revisão dos dados legados.

### Quantidades

As quantidades são inteiras. A estrutura atual de unidade não diferencia com
segurança unidades fracionáveis. Suporte a frações fica para evolução futura,
com tipo e precisão explicitamente modelados.

## Migration

Arquivo:

`supabase/migrations/20260730080000_stock_control_stage_two.sql`

A migration é única, incremental e posterior à Etapa 1. Nenhuma migration
histórica foi alterada.

## Tipos

### `estoque_localizacao_tipo`

- `deposito`;
- `almoxarifado`;
- `sala`;
- `veiculo`;
- `estrutura`;
- `area_tecnica`;
- `outra`.

### `estoque_movimentacao_tipo`

- `entrada`;
- `saida`;
- `transferencia`;
- `ajuste_positivo`;
- `ajuste_negativo`;
- `saldo_inicial`;
- `estorno`.

### `estoque_origem_modulo`

- ativos nesta etapa: `manual`, `controle_estoque`;
- reservados para integração futura: `checkin_checkout`,
  `locacao_materiais`, `manutencao_equipamentos`.

As origens futuras são rejeitadas pelas RPCs nesta etapa.

## Tabelas, checks e constraints

### `estoque_localizacoes`

Campos de identidade, empresa, código, nome, descrição, tipo, pai, estado,
timestamps e atores.

Proteções:

- código e nome não vazios;
- pai diferente do próprio registro;
- chave `(empresa_id, id)` para FKs compostas;
- pai obrigatório na mesma empresa;
- código único por empresa, normalizado por `lower(btrim())`;
- nome único por empresa, normalizado por `lower(btrim())`;
- trigger recursivo contra ciclos;
- exclusão física bloqueada quando houver filhos, saldo ou histórico.

### `estoque_saldos`

Proteções:

- quantidade não negativa;
- material e localização pertencem à mesma empresa;
- unicidade `(empresa_id, material_id, localizacao_id)`;
- material individual limitado ao total zero ou um;
- material individual impedido de ter saldo positivo em dois locais;
- nenhuma permissão direta de INSERT, UPDATE ou DELETE para
  `authenticated`.

### `estoque_movimentacoes`

Proteções:

- quantidade positiva;
- saldos totais anterior e posterior não negativos;
- hash de payload obrigatório;
- FKs compostas de material, origem e destino para a mesma empresa;
- `client_uuid` único por empresa;
- uma única movimentação de saldo inicial por material;
- um único estorno por movimentação;
- formato de origem/destino coerente com o tipo;
- origem diferente do destino;
- trigger bloqueando UPDATE e DELETE;
- nenhuma permissão direta de INSERT, UPDATE ou DELETE para
  `authenticated`.

### Materiais

- `estoque_minimo >= 0`;
- projeção individual limitada a `0` ou `1`;
- `quantidade` e `quantidade_legada_etapa1` protegidas.

## Índices

### Localizações

- `estoque_localizacoes_empresa_codigo_uidx`;
- `estoque_localizacoes_empresa_nome_uidx`;
- `estoque_localizacoes_empresa_parent_idx`.

### Saldos

- unicidade empresa/material/localização;
- `estoque_saldos_empresa_material_idx`;
- `estoque_saldos_empresa_localizacao_idx`.

### Movimentações

- unicidade empresa/`client_uuid`;
- estorno original único;
- saldo inicial único;
- empresa/data;
- empresa/material/data;
- localização combinada/data;
- origem/data;
- destino/data;
- tipo/data;
- documento;
- módulo/ID de origem;
- ator/data.

### Materiais

- `(empresa_id, id)` para relacionamentos compostos;
- índice parcial de materiais abaixo ou iguais ao mínimo;
- índice de conteúdo do QR.

## RLS, policies e grants

RLS está habilitada nas três tabelas.

Policies:

- `Company users read stock locations`;
- `Company admins create stock locations`;
- `Company admins update stock locations`;
- `Company admins delete unused stock locations`;
- `Company users read stock balances`;
- `Company users read stock movements`.

Leitura usa `can_read_company_module`. Escrita administrativa de localizações
usa `can_write_company_module`, módulo ativo e empresa operacional.

Saldos e ledger concedem somente `SELECT` a `authenticated`. As mutações
ocorrem por funções `SECURITY DEFINER` com `search_path` seguro e validação
explícita.

As views de divergência e reconciliação são diagnósticos administrativos e não
possuem `SELECT` para `authenticated`. Funções auxiliares e triggers têm
`EXECUTE` revogado de `PUBLIC`, `anon`, `authenticated` e `service_role`;
somente as quatro RPCs públicas necessárias são concedidas ao cliente
autenticado.

## Funções auxiliares e triggers

- `resolve_stock_company`: resolve empresa do usuário ou contexto Master e
  valida autenticação, módulo, empresa e permissão.
- `prepare_stock_location_write`: normaliza campos, registra atores e impede
  ciclos.
- `protect_used_stock_location`: impede excluir localização utilizada.
- `protect_material_stock_projection`: impede edição de saldo pelo CRUD.
- `validate_stock_balance`: segunda barreira para material individual.
- `sync_material_stock_projection`: recalcula `materiais.quantidade`.
- `protect_stock_ledger`: torna o ledger append-only.
- `apply_stock_movement`: núcleo privado compartilhado das operações.

## RPCs públicas

- `registrar_movimentacao_estoque`;
- `ajustar_estoque_material`;
- `estornar_movimentacao_estoque`;
- `listar_estoque_resumo`.

As três RPCs de escrita derivam a empresa canônica, validam permissão, usam
`auth.uid()` como ator e delegam as alterações ao núcleo transacional.

## Fluxos operacionais

### Material individual

- saldo total permitido `0` ou `1`;
- cada movimento efetivo usa exatamente uma unidade;
- apenas uma localização pode ter saldo positivo;
- entrada `0 → 1`, saída `1 → 0`;
- transferência muda o local mantendo total `1`.

### Material por quantidade

- saldo pode ser distribuído em múltiplos locais;
- total é a soma dos locais;
- movimentos aceitam apenas inteiros positivos;
- saída e transferência validam o saldo depois do lock.

### Saldo inicial

- ação explícita, nunca trigger de cadastro;
- inicialização única global por material;
- não usa automaticamente a quantidade legada;
- gera ledger e snapshots completos;
- retry idempotente não duplica.

### Entrada e saída

- entrada credita destino ativo;
- saída debita origem com saldo suficiente;
- ambas exigem motivo;
- não alteram status operacional;
- material inativo não recebe operação comum.

### Transferência

- origem e destino distintos e da mesma empresa;
- destino ativo;
- débito e crédito na mesma transação;
- uma única movimentação lógica;
- locks de saldo em ordem determinística.

### Ajuste

- recebe quantidade física, motivo e justificativa;
- calcula diferença no banco;
- diferença positiva gera `ajuste_positivo`;
- diferença negativa gera `ajuste_negativo`;
- resultado zero é recusado por não haver alteração;
- não altera status operacional.

### Estorno

- cria evento compensatório;
- nunca altera ou exclui o original;
- exige justificativa;
- impede segundo estorno;
- entrada/positivo é compensado por retirada;
- saída/negativo é compensado por devolução;
- transferência é compensada pelo caminho inverso;
- saldo atual inviável bloqueia o estorno.

## Concorrência

Cada movimentação:

1. adquire advisory lock por empresa e `client_uuid`;
2. bloqueia o material com `FOR UPDATE`;
3. garante as linhas de saldo necessárias;
4. bloqueia os saldos em ordem de localização;
5. lê e valida o saldo após os locks;
6. atualiza saldo, projeção e ledger na mesma transação.

O check de saldo não negativo e o trigger de material individual são barreiras
adicionais. O ensaio real de duas sessões está documentado, mas ainda não foi
executado por ausência de PostgreSQL local.

## Idempotência

- chave única `(empresa_id, client_uuid)`;
- payload convertido em representação JSON canônica e SHA-256;
- mesma chave e mesmo hash retorna o movimento existente;
- mesma chave e hash diferente retorna conflito `ST013`;
- o frontend mantém o UUID durante o envio/retry e bloqueia submissão dupla.

## Localizações e estoque mínimo

- localização possui hierarquia, caminho completo e ativação/inativação;
- local inativo não recebe entrada, transferência ou ajuste positivo;
- saldo existente pode sair, ser ajustado para baixo ou ser recomposto por
  estorno;
- estoque mínimo é configuração não negativa;
- saldo menor ou igual ao mínimo é sinalizado;
- estoque mínimo nunca bloqueia saída nem cria movimentação.

## Integração modular

- `controle_estoque` fica ativo no catálogo, etapa 2, sem flag `planned`;
- dependência `controle_estoque → gestao_materiais` preservada;
- empresas comuns não recebem entitlement automaticamente;
- empresa Vitalícia segue o contrato canônico;
- dependências transitivas usam
  `company_module_dependencies_satisfied`;
- o trigger existente impede desativar uma dependência ativa;
- desativar o módulo bloqueia acesso sem apagar dados;
- reativar restaura o acesso aos mesmos registros.

## Proteção frontend

- menu e rota condicionados ao módulo;
- usuário comum em leitura;
- administrador operacional com ações;
- empresa somente leitura sem ações;
- dialogs validam campos e inteiros;
- botão desabilitado durante envio;
- `client_uuid` por tentativa lógica;
- erros conhecidos traduzidos;
- fallback desconhecido seguro;
- queries de saldos, indicadores, histórico e detalhes invalidadas após sucesso;
- CRUD de Materiais não envia `quantidade` nem localização oficial.

## Proteção backend

- RLS e grants mínimos;
- empresa derivada do usuário, exceto seleção explícita do Master;
- verificação de empresa operacional, módulo, dependências e papel;
- FKs compostas contra referências entre empresas;
- sem mutação direta de saldos ou ledger;
- ledger append-only;
- locks e validação pós-lock;
- checks de saldo;
- idempotência;
- projeção protegida.

## Views

- `estoque_divergencias_saldo`: deve permanecer vazia;
- `estoque_reconciliacao_legado`: lista valores antigos e materiais ainda sem
  saldo inicial.

## Arquivos criados

- `supabase/migrations/20260730080000_stock_control_stage_two.sql`;
- `supabase/tests/stock_control_stage_two_test.sql`;
- `docs/stock-control-stage-two.md`;
- `docs/stock-control-stage-two-manual-test.md`;
- `docs/stock-control-stage-two-delivery-report.md`;
- `src/pages/Estoque.tsx`;
- `src/hooks/useStock.ts`;
- `src/components/stock/StockMovementDialog.tsx`;
- `src/components/stock/StockLocationManager.tsx`;
- `src/components/stock/StockReversalDialog.tsx`;
- `src/lib/stock-types.ts`;
- `src/lib/stock-domain.ts`;
- `src/lib/stock-service.ts`;
- `src/lib/stock-errors.ts`;
- `src/lib/stock-permissions.ts`;
- `src/lib/stock-domain.test.ts`;
- `src/lib/stock-service.test.ts`;
- `src/lib/stock-errors.test.ts`;
- `src/lib/stock-permissions.test.ts`.

## Arquivos alterados

- `src/App.tsx`;
- `src/components/AppSidebar.tsx`;
- `src/constants/module-keys.ts`;
- `src/integrations/supabase/types.ts`;
- `src/components/materials/MaterialDetailsDialog.tsx`;
- `src/components/materials/MaterialFormDialog.tsx`;
- `src/lib/material-types.ts`;
- `src/lib/material-domain.ts`;
- `src/lib/material-service.ts`;
- `src/lib/material-domain.test.ts`;
- `src/lib/material-service.test.ts`;
- `src/lib/supabase-error.ts`;
- `supabase/tests/materials_inventory_test.sql`;
- `supabase/tests/materials_module_entitlement_test.sql`.

## Testes adicionados e resultados

### Frontend

Novas suítes cobrem:

- regras de material individual e quantitativo;
- quantidades inválidas;
- saldo mínimo;
- validação de entrada, saída, transferência, saldo inicial e ajuste;
- permissões e navegação;
- limite somente leitura;
- chamadas exclusivas às RPCs;
- idempotência na fronteira do service;
- estorno compensatório;
- tradução de erros e fallback seguro.

Resultado executado:

- `npm run typecheck`: aprovado;
- `npm test -- --reporter=verbose`: reexecutado na Etapa 2.5, 34 arquivos e
  240 testes aprovados;
- ESLint direcionado: aprovado;
- `npm run build`: aprovado, 4.243 módulos transformados.

Avisos não bloqueantes do build:

- `buffer` externalizado pela dependência `docx`;
- `pdfjs-dist` importado de forma estática e dinâmica;
- chunk principal acima de 500 kB.

### SQL/pgTAP

Arquivos preparados:

- `stock_control_stage_two_test.sql`: plano de 102 asserções;
- `materials_inventory_test.sql`: plano de 23 asserções;
- `materials_module_entitlement_test.sql`: plano de 29 asserções.

Total preparado: 154 asserções SQL, todas encapsuladas em
`BEGIN ... ROLLBACK`.

Resultado na estabilização 2.5: o CLI conectou ao remoto, mas `supabase test db
--linked` ainda exige Docker para executar o cliente pgTAP e encerrou com
`LegacyDockerRunError`. Nenhuma suíte SQL foi reportada como aprovada.

## `db lint`

Comando executado originalmente:

`supabase db lint --local`

Resultado:

- falhou antes da análise;
- `LegacyDbConnectError`;
- `PgClient: Failed to connect`;
- nenhuma conexão linked foi usada.

Na Etapa 2.5, `supabase db lint --linked --schema public --level warning
--fail-on error` foi aprovado com `No schema errors found`.

## Dry-run

Comando tentado:

`supabase db push --dry-run --local`

Resultado:

- o CLI confirmou `DRY RUN: migrations will not be pushed`;
- falhou ao conectar ao PostgreSQL local;
- nenhuma migration foi aplicada;
- nenhum `--linked` foi usado.

## Estado remoto da migration

`20260730080000_stock_control_stage_two.sql` consta no histórico remoto com o
timestamp `2026-07-30 08:00:00`. A estabilização 2.5 não reaplica nem altera
essa migration histórica. A migration incremental
`20260802090000_stage_2_5_stock_stabilization.sql` também consta no histórico
remoto, com timestamp `2026-08-02 09:00:00`.

## Riscos e limitações

- a migration da Etapa 2 está aplicada no PostgreSQL remoto;
- pgTAP e concorrência real ainda não têm resultado;
- o roteiro manual ainda não foi executado;
- tipos Supabase foram regenerados do schema remoto real em 02/08/2026;
- o valor legado é preservado, mas exige reconciliação manual;
- nomes de localização são únicos em toda a empresa, não apenas entre irmãos;
- quantidades fracionárias não são suportadas;
- chunks grandes continuam sendo uma dívida de desempenho anterior;
- nenhuma integração real com check-in/out, locação ou manutenção foi ativada.

## Roteiro manual

O roteiro completo, com 44 cenários, pré-condições, passos e resultados
esperados, está em:

`docs/stock-control-stage-two-manual-test.md`.
