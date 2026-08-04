# ETAPA 6 — VALIDAÇÃO PÓS-MIGRATION E FECHAMENTO

Data da validação: 04/08/2026

Janela registrada no remoto: concluída antes da auditoria de
`2026-08-04 04:46:44 UTC` (`01:46:44 -03:00`). A tabela de histórico da CLI
Supabase não possui coluna com o instante exato de aplicação.

Migration: `20260804090000_material_labels_printing_stage_six.sql`

SHA-256: `82898290113D299B13B3A833398840127A176E10B3B7AAEF3339D96DEA7BC714`

## Resultado executivo

A migration foi aplicada com sucesso no Supabase remoto e a camada de banco foi
auditada. Local e remoto estão sincronizados, o dry-run final está vazio, RLS e
isolamento multiempresa passaram no smoke transacional remoto e nenhuma fixture
permaneceu gravada.

Entretanto, dois critérios explícitos do fechamento não são atendidos pela
interface atual:

1. “lote” aceita várias cópias de **um** material, mas não múltiplos materiais
   selecionados em uma única operação;
2. a RPC de histórico é paginada, mas a página mostra somente a primeira página
   e não oferece controles para navegar pelas demais.

O modelo também não persiste margens próprias; a impressão usa página nas
dimensões do modelo e orienta desativar margens do navegador/driver. Isso deve
ser tratado como limitação explícita até existir parâmetro canônico de margem.

Por esses motivos, o gate integral solicitado para o commit e para a declaração
de conclusão técnica está **reprovado**. Nenhum commit foi criado.

## 1. Aplicação e sincronização

- `supabase db push --linked`: aplicou somente a migration da Etapa 6;
- seeds: nenhum;
- roles: nenhuma alteração avulsa;
- migration list: local/remoto sincronizada até `20260804090000`;
- dry-run final: vazio;
- migrations antigas: não reaplicadas nem modificadas;
- Etapa 5: permaneceu no commit `bd5b2e2e2ffa6e2b96af6be0f9056a8333538c34`.

## 2. Schema remoto

Foram confirmadas:

- `etiqueta_modelos`, com RLS;
- `etiqueta_impressoes`, com RLS;
- índices por empresa, nome, padrão, data, material e `client_uuid`;
- constraints de dimensões, fonte, quantidade, snapshots, hash e referências;
- onze funções relacionadas ao domínio, sendo sete RPCs públicas;
- duas policies SELECT condicionadas a `can_read_company_module`;
- `authenticated` com SELECT nas tabelas e escrita somente pelas RPCs;
- helpers internos sem EXECUTE para `anon`, `authenticated` ou `service_role`;
- RPCs sem EXECUTE para `anon` e `service_role`;
- triggers que protegem projeção e histórico.

O `service_role` mantém os privilégios de tabela padrão da plataforma, mas
UPDATE/DELETE do histórico continuam bloqueados pelo trigger imutável. A
aplicação/frontend não recebe esses privilégios.

## 3. Sistema modular

O módulo `etiquetas_materiais` está ativo com metadata `stage = 6` e depende
exclusivamente de `gestao_materiais`. Foram reutilizados `module_catalog`,
`empresa_modules`, `module_dependencies`, `company_has_active_module`,
`can_read_company_module` e `can_write_company_module`.

Não foi criado sistema modular ou sistema de permissões paralelo.

## 4. Modelos dimensionais

O schema remoto confirmou isolamento por `empresa_id`, nome, descrição, largura,
altura, tipo de identificação, campos ordenados, fonte, borda, padrão, versão e
estado ativo.

- largura: 20 a 210 mm;
- altura: 10 a 297 mm;
- fonte: 6 a 24;
- um modelo padrão ativo por empresa;
- FKs compostas por empresa impedem modelo cruzado;
- campos são validados contra lista fechada no backend.

Não existe coluna de margem. A V1 depende de margem zero no navegador/driver.

## 5. QR, Code 128 e formato combinado

O enum canônico remoto contém `qr_code`, `codigo_barras` e `ambos`. O frontend
usa `qrcode.react` e `jsbarcode`/Code 128.

O snapshot recebe exclusivamente `conteudo_qr_code`, `codigo_barras`,
`identificador_unico`, `codigo_interno` e demais atributos de `materiais`. Não
foi criado UUID, QR, barcode, patrimônio ou código interno alternativo.

## 6. Snapshots e histórico

Cada solicitação persiste `modelo_snapshot` e `material_snapshot`, quantidade,
ator, nome do ator, data/hora, hash e `client_uuid`. O smoke remoto confirmou que
alterar depois o nome do material não reescreve o snapshot anterior.

UPDATE e DELETE do histórico são bloqueados por trigger. O histórico não é
derivado de logs do frontend e registra honestamente uma solicitação, sem afirmar
que houve saída física da impressora.

## 7. Lote, idempotência e concorrência

Confirmados:

- quantidade por solicitação entre 1 e 500;
- modelo e material registrados;
- snapshot completo;
- hash SHA-256 do payload;
- índice único `(empresa_id, client_uuid)`;
- advisory lock por empresa/chave;
- retry equivalente idempotente;
- payload diferente com a mesma chave rejeitado;
- evidência local concorrente: duas sessões → uma linha, quantidade total 5.

Não confirmado/ausente:

- uma única operação contendo múltiplos materiais distintos.

## 8. RLS e multiempresa

O smoke remoto foi executado dentro de transação com rollback e aprovou:

- administrador A e administrador B;
- usuário comum somente leitura funcional;
- Master com empresa explícita e bloqueio sem empresa;
- empresa em modo somente leitura;
- empresa inativa: leitura histórica permitida pelo contrato canônico e escrita bloqueada;
- módulo desativado;
- ausência de entitlement;
- licença Vitalícia;
- bloqueio empresa A → empresa B;
- bloqueio de material cruzado;
- snapshots imutáveis;
- helpers protegidos.

Após uma tentativa propositalmente falha e após o teste aprovado, a verificação
confirmou zero fixtures permanentes.

## 9. Integração com Materiais

`/etiquetas` consulta `materiais` e `categorias_materiais` pelas RPCs oficiais.
O CTA no detalhe encaminha o UUID canônico na URL. Não há duplicação de material,
fotos, identificação, UUID, QR, barcode, código interno ou patrimônio.

## 10. Pré-visualização

Prévia e impressão recebem o mesmo modelo e o mesmo conteúdo canônico/snapshot.
Os valores exibidos são os mesmos, mas existem dois renderizadores CSS: o
componente React de prévia e o HTML autocontido da janela de impressão. Essa
separação pode produzir diferenças visuais de driver/browser, embora não altere
o conteúdo codificado.

Limitações: pop-up, área não imprimível, margem do driver, escala, orientação e
quebra de página variam por navegador/impressora.

## 11. Impressão e scanner físicos

`Validação física em impressoras: PENDENTE`

`Validação com scanner físico: PENDENTE`

O roteiro está em `docs/stage-6-physical-printing-homologation.md` e cobre
impressora térmica, A4, dimensões, margens, QR, Code 128, combinado, scanner,
lote, quebra de página, escala 100% e navegador.

## 12. Histórico paginado

`listar_historico_impressoes_etiqueta` implementa paginação no backend e retorna
`total_count`. A tela, porém, chama somente a página 1 e não possui botões de
navegação. O critério de histórico paginado na página não está concluído.

## 13. Tipos Supabase

`src/integrations/supabase/types.ts` foi regenerado oficialmente com:

`supabase gen types typescript --linked --schema public`

O arquivo remoto substituiu a edição local manual e `tsc --noEmit` passou.

## 14. Supabase lint

Não houve erro de schema. O lint reportou avisos STABLE/VOLATILE já conhecidos
em módulos anteriores e avisos equivalentes nas quatro consultas de etiquetas.
Também sinalizou `validate_material_label_fields` como IMMUTABLE chamando
expressões classificadas STABLE. Nenhum warning foi corrigido diretamente no
remoto ou misturado ao fechamento.

## 15. npm audit

Resultado: 12 vulnerabilidades — 1 baixa, 2 moderadas, 9 altas, 0 críticas.

Pacotes envolvidos:

- alta: `brace-expansion`, `fast-uri`, `flatted`, `form-data`, `js-yaml`,
  `lodash`, `postcss`, `vite`, `ws`;
- moderada: `react-router`, `react-router-dom`;
- baixa: `@tootallnate/once`.

`jsbarcode` e `@types/jsbarcode`, adicionados pela Etapa 6, não aparecem no
relatório. Portanto, nenhuma vulnerabilidade identificada foi introduzida pelo
fluxo de etiquetas. O conjunto permanece como dívida técnica; nenhum `audit fix`
ou upgrade amplo foi executado.

## 16. Testes

Evidência local preservada:

- pgTAP: 38/38;
- PostgreSQL 16.14;
- replay desde `template0`;
- rollback;
- atomicidade com falha forçada;
- concorrência real.

Regressão final executada:

- Vitest: 46 arquivos, 306/306;
- `npx tsc --noEmit`: PASS;
- build: PASS;
- ESLint direcionado: PASS;
- `git diff --check`: PASS;
- Supabase lint: sem erros, com warnings documentados;
- npm audit: executado, sem correção automática.

## 17. E2E e limitações

`E2E manual autenticado remoto: PENDENTE`

Outras limitações:

- sem confirmação confiável de saída física pelo navegador;
- sem impressão silenciosa, ZPL/EPL ou descoberta de impressora;
- sem parâmetro persistido de margem;
- sem lote de múltiplos materiais;
- sem controles de paginação do histórico na UI;
- dois renderizadores CSS podem variar visualmente.

## 18. Riscos e dívidas restantes

- homologação física e scanner real;
- E2E autenticado;
- correção aditiva para lote multi-material;
- controles de paginação da página;
- decisão de produto sobre margem persistida;
- warnings de volatilidade;
- dívida global do npm audit.

Não foram tratados E2E antigo, estoque legado, RBAC granular, lint global ou
outras dívidas fora do domínio.

## 19. Git

Branch: `main`.

Commit-base: `bd5b2e2e2ffa6e2b96af6be0f9056a8333538c34`.

O commit sugerido **não foi criado**, porque os critérios de múltiplos materiais
e paginação de histórico não foram aprovados. Push, tag e release não foram
executados.

## Conclusão

**A Etapa 6 pode ser declarada tecnicamente concluída?**

**Não sob os critérios integrais desta ordem de fechamento.**

- camada de banco/migration: aplicada e tecnicamente aprovada;
- segurança, RLS, snapshots e idempotência: aprovados;
- conclusão funcional integral: bloqueada por lote multi-material e paginação da UI;
- homologação física de impressão: pendente e não bloqueia a migration;
- E2E manual autenticado: pendente e não foi inventado como aprovado.
