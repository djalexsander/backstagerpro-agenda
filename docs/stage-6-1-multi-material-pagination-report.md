# ETAPA 6.1 — CORREÇÃO MULTI-MATERIAL E PAGINAÇÃO

Data/hora da validação: 2026-08-04 02:28:10 -03:00

## 1. Causa dos gates reprovados

A Etapa 6 registrava uma solicitação por material e a interface consultava sempre a primeira página do histórico. O preview e a impressão também partiam de um único material. As margens internas eram constantes no CSS e a margem física final dependia implicitamente do navegador/driver.

## 2. Arquitetura da correção

A correção é incremental e mantém `etiqueta_impressoes` como ledger legado compatível. O novo agregado usa:

- `etiqueta_solicitacoes`: cabeçalho lógico imutável do lote;
- `etiqueta_solicitacao_itens`: materiais, ordem, quantidade e snapshot por item;
- RPC transacional `registrar_solicitacao_impressao_lote_etiquetas`;
- constraint triggers diferidos que recusam cabeçalho sem todos os itens ou totais divergentes;
- advisory lock por empresa e chave idempotente;
- paginação server-side no histórico.

## 3. Migration criada

`20260804120000_material_labels_stage_six_multi_material_fix.sql`

A migration é aditiva. Não contém `DELETE FROM`, `TRUNCATE`, `DROP TABLE` ou `DROP COLUMN`. A migration original `20260804090000_material_labels_printing_stage_six.sql` permaneceu inalterada e conserva SHA-256 `82898290113D299B13B3A833398840127A176E10B3B7AAEF3339D96DEA7BC714`.

## 4. SHA-256

`937A6F1F82FA3D647580063316FCC64A6FD70AE6D68769D55F0015D5EDFE1C7E`

## 5. Lote multi-material

Uma solicitação aceita de 1 a 100 materiais distintos, de 1 a 500 cópias por material e até 5.000 etiquetas no total. A ordem do payload é persistida e usada no resumo, preview e impressão. O teste `10 + 4 + 8` produziu um cabeçalho, três itens e 22 etiquetas.

## 6. Atomicidade

Cabeçalho, itens, snapshots e log são gravados na mesma transação. Falha injetada no log resultou em zero cabeçalhos e zero itens para a chave testada. Constraint triggers diferidos impedem commit de lotes incompletos ou com totais divergentes.

Resultado: `PASS`.

## 7. Idempotência

A chave é única por empresa. Retry com mesma chave e payload retorna a solicitação existente; não cria segundo cabeçalho nem duplica itens. A mesma chave com payload diferente é recusada com `LB016`.

## 8. Concorrência

PostgreSQL real: `16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)`.

- duas sessões simultâneas, mesma chave e lote: `1` cabeçalho, `3` itens, quantidades `10,4,8`, total `22`;
- duas sessões simultâneas com lotes legítimos distintos: `2` cabeçalhos, total `10` etiquetas;
- nenhum item duplicado.

Resultado: `PASS`.

## 9. Snapshots

Cada item guarda snapshot do material canônico no momento da solicitação. O cabeçalho guarda snapshot do modelo, incluindo margens internas e versão. Alteração posterior de nome e código interno do material não alterou o histórico. UPDATE/DELETE arbitrários são bloqueados por privilégios e triggers imutáveis.

## 10. RLS

As duas novas tabelas têm RLS. `authenticated` possui somente SELECT condicionado por `can_read_company_module`. INSERT/UPDATE/DELETE diretos são revogados. Helpers internos permanecem sem EXECUTE para frontend, anon e service role.

## 11. Multiempresa

FKs compostas por `empresa_id` vinculam modelo, cabeçalho, itens e materiais. Material ou modelo de outra empresa faz a operação inteira falhar. O teste de lote misto confirmou ausência de cabeçalho parcial.

## 12. Preview

A tela permite buscar e selecionar vários materiais, ajustar quantidade, remover item e visualizar resumo. O preview mostra todos os materiais na ordem do lote e a respectiva multiplicidade. Preview e impressão usam o mesmo modelo, os mesmos identificadores canônicos e a mesma ordem; a impressão usa os snapshots devolvidos pelo backend.

## 13. Impressão

A janela de impressão expande os itens ordenados conforme suas quantidades. QR Code, Code 128 e formato combinado continuam usando exclusivamente os identificadores canônicos do material. Não foi criado identificador paralelo.

## 14. Paginação

O histórico usa paginação server-side com 10 registros por página. A interface possui Anterior, Próxima, página atual, total de páginas, total de solicitações, estado de carregamento e bloqueio correto nos limites. O detalhe exibe cada material, quantidade e campos do snapshot.

## 15. Margens

Foram adicionados `margem_interna_mm` e `espacamento_interno_mm`, ambos validados entre 0 e 10 mm e retrocompatíveis com padrão 1,50 mm. Eles controlam apenas padding interno e espaço entre códigos/texto.

Limitação formal: **A escala e margens físicas finais dependem do navegador, driver e impressora.**

## 16. Compatibilidade com histórico existente

O backfill transforma deterministicamente cada registro legado em lote de um item, preservando UUID, timestamp, ator, chave, hash, quantidade e snapshots. O teste de rollback/recriação preservou o mesmo UUID legado e resultou em `1` material, `3` etiquetas e item com quantidade `3`. A fachada unitária antiga continua operacional e seus 38 testes históricos permanecem verdes.

## 17. pgTAP

- Etapa 6 histórica: `38/38`;
- Etapa 6.1: `27/27`;
- total SQL executado: `65/65`.

## 18. Testes automatizados

- Vitest: `311/311`, 46 arquivos;
- TypeScript `npx tsc --noEmit`: aprovado;
- build Vite: aprovado;
- ESLint direcionado aos arquivos de etiquetas: aprovado;
- `git diff --check`: aprovado;
- warnings de build globais preexistentes: chunk principal grande, importação PDF duplicada e externalização de `buffer` por `docx`.

Os testes de domínio cobrem seleção, prevenção de duplicidade, alteração de quantidade, remoção, total, payload ordenado, expansão de preview/impressão e limites de paginação. Testes preexistentes de filtros e permissões continuam aprovados.

## 19. PostgreSQL real

- versão: PostgreSQL 16.14;
- replay desde banco vazio: aprovado;
- aplicação até Etapa 6 e aplicação da 6.1: aprovada;
- rollback transacional da 6.1: aprovado;
- recriação após rollback: aprovada;
- backfill legado: aprovado;
- atomicidade e concorrência real: aprovadas.

O `plpgsql_check`, mecanismo PostgreSQL usado pelo lint, retornou zero erros e zero warnings nas funções corretivas. A CLI oficial `supabase db lint` não conseguiu alcançar o PostgreSQL no WSL porque ele escuta somente o loopback interno; nenhuma credencial privilegiada ou alteração de configuração foi criada para contornar isso. O lint oficial pós-deploy remoto continua obrigatório.

## 20. Riscos

- homologação de dimensão física depende de browser, driver, mídia e impressora;
- tipos Supabase remotos só podem ser regenerados oficialmente depois do deploy autorizado;
- lint oficial deve ser repetido no schema remoto após a aplicação;
- warnings globais de bundle permanecem fora do escopo.

`npm audit`: 12 vulnerabilidades, sendo 1 baixa, 2 moderadas, 9 altas e 0 críticas. Pacotes reportados: `@tootallnate/once`, `brace-expansion`, `fast-uri`, `flatted`, `form-data`, `js-yaml`, `lodash`, `postcss`, `react-router`, `react-router-dom`, `vite` e `ws`. A 6.1 não alterou `package.json`/`package-lock.json` e não introduziu dependência; o relatório permanece dívida técnica separada. Nenhum `npm audit fix --force` foi executado.

## 21. Pendências operacionais

- Validação física em impressora real: **PENDENTE**;
- scanner físico: **PENDENTE**;
- E2E manual autenticado remoto: **PENDENTE**.

## 22. Estado do Git e remoto

- branch: `main`;
- commits à frente de `origin/main`: `4`;
- worktree: não limpo, intencionalmente contendo Etapa 6 + correção 6.1;
- status: 43 entradas (7 modificadas, 36 não rastreadas);
- commit 6/6.1: não criado, conforme instrução;
- push/tag/release: não realizados;
- Etapas 1–5: não alteradas; migration da Etapa 5 sem diff;
- migration 6.1 no remoto: **não aplicada**;
- migration list: somente `20260804120000` está pendente;
- dry-run remoto: aplicaria somente `20260804120000_material_labels_stage_six_multi_material_fix.sql`.

## Conclusão

**A migration corretiva da Etapa 6.1 está segura para aplicação no Supabase remoto? Sim, tecnicamente, condicionada à autorização específica de deploy.**

Após o deploy autorizado ainda serão obrigatórios: migration list sincronizada, dry-run vazio, lint remoto, auditoria pós-migration, regeneração oficial de `src/integrations/supabase/types.ts` e regressão final. Nenhuma dessas ações remotas foi antecipada neste fechamento local.
