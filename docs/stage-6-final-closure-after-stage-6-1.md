# ETAPA 6 — FECHAMENTO FINAL APÓS CORREÇÃO 6.1

Data/hora do fechamento: 2026-08-04 02:40:09 -03:00

## Resultado executivo

A migration corretiva 6.1 foi aplicada exclusivamente pelo fluxo oficial do Supabase CLI. Local e remoto estão sincronizados, o dry-run final está vazio, o lint oficial remoto não encontrou erros, os tipos foram regenerados do schema remoto e a regressão completa passou.

Os gates que impediram o fechamento original foram corrigidos: uma solicitação agora contém vários materiais com quantidades individuais e snapshots imutáveis; o histórico possui paginação server-side navegável; margens internas seguras foram formalizadas sem prometer precisão física do hardware.

## 1. Migration 6.1 aplicada

Migration aplicada:

`20260804120000_material_labels_stage_six_multi_material_fix.sql`

O comando de aplicação reportou somente esse arquivo. Nenhuma migration anterior, seed ou role avulsa foi aplicada.

## 2. Data/hora

Aplicação e validação pós-deploy executadas em 2026-08-04, antes do fechamento registrado às 02:40:09 -03:00.

## 3. SHA-256

Migration 6.1:

`937A6F1F82FA3D647580063316FCC64A6FD70AE6D68769D55F0015D5EDFE1C7E`

Migration original da Etapa 6, preservada sem alteração:

`82898290113D299B13B3A833398840127A176E10B3B7AAEF3339D96DEA7BC714`

## 4. Sincronização local/remoto

- `migration list`: `20260804120000` presente nos dois lados;
- dry-run final: `upToDate=true`, nenhuma migration pendente;
- Etapas 1–5: sem diff;
- aplicação remota: somente a 6.1.

## 5. Lint remoto

O Supabase lint oficial foi executado com `--linked --schema public --level warning --fail-on error`.

- erros: `0`;
- warnings: `31` globais;
- warnings no domínio de etiquetas: `7`;
- RPCs de escrita 6.1: nenhum erro ou warning.

Os avisos são da classe STABLE/VOLATILE/IMMUTABLE já registrada como dívida anterior. Não foi feita alteração fora do escopo para silenciá-los.

## 6. Lote multi-material

Uma única linha em `etiqueta_solicitacoes` representa a solicitação lógica. `etiqueta_solicitacao_itens` registra materiais distintos, ordem, quantidade e snapshot.

Limites implementados:

- 1 a 100 materiais distintos;
- 1 a 500 etiquetas por material;
- até 5.000 etiquetas por solicitação.

Evidência local real: Material A × 10, B × 4 e C × 8 resultaram em um cabeçalho, três itens e total 22.

## 7. Atomicidade

Cabeçalho, todos os itens, snapshots e log são persistidos na mesma transação. Constraint triggers diferidos impedem cabeçalho sem itens, quantidade divergente ou lote incompleto.

O teste local com falha injetada confirmou zero cabeçalhos e zero itens sobreviventes. Testes destrutivos não foram repetidos em produção.

## 8. Idempotência

- índice único `(empresa_id, client_uuid)`;
- advisory lock por empresa e chave;
- mesma chave e mesmo payload retornam a mesma solicitação;
- mesma chave e payload diferente são recusados com `LB016`;
- retry não duplica cabeçalho, itens ou snapshots.

Concorrência real no PostgreSQL 16.14: duas sessões simultâneas produziram uma solicitação, três itens, total 22 e quantidades `10,4,8`.

## 9. Backfill

Cada registro de `etiqueta_impressoes` é convertido deterministicamente em lote de um item, preservando UUID, empresa, modelo, quantidade, data/hora, ator, chave idempotente, hash e snapshots.

A inspeção remota pós-deploy reportou contagem estimada zero para `etiqueta_impressoes`, `etiqueta_solicitacoes` e `etiqueta_solicitacao_itens`; portanto não havia histórico remoto a converter. Nenhum dado foi apagado, inventado ou complementado manualmente.

O teste local de compatibilidade confirmou o mesmo UUID legado após backfill e equivalência `1 material / 3 etiquetas / item com quantidade 3`.

## 10. Snapshots

Cada item possui `material_snapshot`; o cabeçalho possui `modelo_snapshot`, incluindo versão, dimensões, margem interna e espaçamento interno. Alterações posteriores do cadastro canônico não reescrevem o histórico.

UPDATE/DELETE diretos são bloqueados por privilégios e triggers imutáveis.

## 11. RLS, grants/revokes e helpers

- RLS habilitado em `etiqueta_solicitacoes` e `etiqueta_solicitacao_itens`;
- SELECT autenticado condicionado por `can_read_company_module`;
- escrita direta revogada para frontend;
- RPC multi-material concedida apenas a `authenticated`;
- anon e service role sem EXECUTE nas fachadas definidas pela 6.1;
- helpers internos sem EXECUTE para anon/authenticated/service role;
- smoke remoto anon confirmou tabela bloqueada, RPC autenticada bloqueada e helper interno bloqueado.

## 12. Multiempresa

FKs compostas por `empresa_id` ligam cabeçalho, itens, modelos e materiais. Modelo ou material de outra empresa faz a operação inteira falhar. Não existe lote parcial nem mistura de tenants.

A autoridade permanece no backend e reutiliza o sistema modular e as permissões canônicas.

## 13. Paginação

O histórico usa a RPC paginada no servidor, com 10 registros por página na interface. Foram implementados:

- Anterior;
- Próxima;
- página atual e total de páginas;
- total de solicitações;
- loading durante troca;
- bloqueio correto nos limites;
- detalhe com cada material, quantidade e snapshot.

O frontend não carrega todo o histórico para paginar localmente.

## 14. Preview

O preview representa todos os materiais selecionados, suas quantidades e ordem. Ele reutiliza o mesmo modelo e os mesmos dados canônicos que formam o payload. A impressão final usa os snapshots retornados pelo backend.

Preview React e documento HTML de impressão possuem renderizadores visuais diferentes; o conteúdo e a ordem são compartilhados, mas browser/driver podem causar diferença visual.

## 15. Impressão e margens

QR Code, Code 128 e formato combinado continuam usando exclusivamente os identificadores canônicos de `materiais`.

Foram adicionados:

- `margem_interna_mm`, padrão 1,50 mm;
- `espacamento_interno_mm`, padrão 1,50 mm;
- validação de 0 a 10 mm.

Esses valores controlam apenas o layout interno. **A escala e margens físicas finais dependem do navegador, driver, impressora e configuração de escala.**

## 16. Tipos Supabase

`src/integrations/supabase/types.ts` foi regenerado oficialmente por `supabase gen types typescript --linked --schema public`.

O arquivo contém as duas novas tabelas, seus relacionamentos e as RPCs `registrar_solicitacao_impressao_lote_etiquetas` e `salvar_modelo_etiqueta_v2`. Não houve edição manual do conteúdo gerado.

## 17. Testes

- pgTAP histórico: `38/38`;
- pgTAP 6.1: `27/27`;
- total SQL: `65/65`;
- PostgreSQL: `16.14`;
- replay desde banco vazio: aprovado;
- rollback/recriação/backfill: aprovados;
- atomicidade: aprovada;
- concorrência real: aprovada;
- Vitest: `311/311`, 46 arquivos;
- `npx tsc --noEmit`: aprovado;
- build Vite: aprovado;
- ESLint direcionado: aprovado;
- `git diff --check`: aprovado;
- Supabase lint remoto: 0 erros.

Warnings globais de build sobre bundle, PDF e `buffer` permanecem preexistentes e fora do domínio.

## 18. npm audit

Resultado pós-deploy: 12 vulnerabilidades — 1 baixa, 2 moderadas, 9 altas, 0 críticas.

Pacotes: `@tootallnate/once`, `brace-expansion`, `fast-uri`, `flatted`, `form-data`, `js-yaml`, `lodash`, `postcss`, `react-router`, `react-router-dom`, `vite` e `ws`.

A dependência funcional da Etapa 6 é `jsbarcode`, que não aparece no relatório. Nenhuma vulnerabilidade foi introduzida pela correção 6.1. Não foi executado `npm audit fix --force`.

## 19. Pendências físicas

- Validação física em impressora real: **PENDENTE**;
- scanner físico: **PENDENTE**;
- roteiro de homologação: disponível em `docs/stage-6-physical-printing-homologation.md`.

Essas pendências são homologação operacional e não bloqueiam a conclusão técnica.

## 20. E2E remoto

E2E manual autenticado remoto: **PENDENTE**.

Não havia sessão de navegador autenticada adequada. Foram executados somente lint/inspeções oficiais read-only e smoke anon sem escrita. Nenhuma fixture permaneceu no remoto.

## 21. Riscos restantes

- variação física entre browser, driver, mídia e impressora;
- E2E autenticado ainda não homologado;
- 12 vulnerabilidades npm mantidas como dívida separada;
- 31 warnings STABLE/VOLATILE/IMMUTABLE no lint remoto, sem erros;
- dump de schema pela CLI ficou indisponível sem Docker Desktop; a auditoria usou migration list, lint, geração oficial de tipos, inspect de tabelas/índices e smoke anon.

## EVOLUÇÃO DA INFRAESTRUTURA DE IMPRESSÃO

### Direção arquitetural

A implementação da Etapa 6 pode evoluir incrementalmente para uma infraestrutura canônica de impressão com três famílias de saída:

`Infraestrutura de Impressão` → `Etiqueta` | `Cupom térmico` | `Documento/A4`

O domínio de origem continuará responsável por preparar o conteúdo e suas referências canônicas. A infraestrutura compartilhada deverá receber uma especificação de impressão já resolvida e cuidar de perfil de página, dimensões físicas, orientação, margens, preview, renderização, abertura da janela de impressão, saída PDF quando aplicável e tratamento uniforme de erros.

Uma infraestrutura única não significa obrigar todos os formatos a usar o mesmo renderizador. Etiquetas e cupons podem usar um adaptador HTML/CSS orientado a impressão térmica, enquanto documentos A4 podem usar um adaptador PDF. O contrato da solicitação, os parâmetros de página, a preparação do preview e a ação de imprimir/exportar é que devem ser canônicos.

### O que já pode ser reutilizado

- dimensões em milímetros e uso de `@page` no fluxo de impressão pelo navegador;
- abertura controlada da janela de impressão e detecção de bloqueio de pop-up;
- declaração explícita de margem interna, espaçamento, borda, fonte e tamanho físico;
- preparação de conteúdo antes da impressão e uso de snapshots imutáveis quando o domínio exige histórico auditável;
- idempotência, paginação, multiempresa e proteção de histórico como padrões para futuras solicitações persistidas;
- geração de QR Code e Code 128 como blocos de conteúdo reutilizáveis quando outro documento realmente precisar deles;
- `pdf-branding.ts`, `pdf-save.ts` e os exportadores jsPDF existentes como base do futuro adaptador de documento/PDF;
- identidade visual, nome de arquivo, download PDF/PNG e rotinas de branding já existentes no domínio de relatórios.

### O que permanece específico de etiquetas

Os nomes atuais `material-label-*`, `LabelCanvas`, `LabelPrintDialog`, `etiqueta_modelos`, `etiqueta_solicitacoes`, `etiqueta_solicitacao_itens` e suas RPCs estão corretamente ligados ao domínio de identificação de materiais. Não devem ser renomeados nem usados artificialmente para cupons ou documentos.

Também permanecem específicos de etiquetas:

- vínculo obrigatório com materiais e seus identificadores canônicos;
- seleção QR Code, Code 128 ou formato combinado;
- lote multi-material e quantidade de cópias por material;
- snapshot de material e de modelo dimensional;
- limites físicos e campos próprios da etiqueta;
- entitlement `etiquetas_materiais` e histórico de reimpressão de etiquetas.

As tabelas atuais não constituem um cadastro genérico de templates nem um histórico universal de impressão. Generalizá-las agora exigiria abstrações sem casos reais suficientes e aumentaria o risco sobre uma implementação já validada.

### Núcleo compartilhado a extrair quando houver demanda

Antes de implementar a impressão da Etapa 7, a evolução recomendada é extrair, sem mudar o schema de etiquetas, um núcleo pequeno e independente de domínio com conceitos equivalentes a:

- `PrintPageSpec`: família da mídia, largura/altura ou formato nominal, orientação, margens, espaçamentos e política de escala;
- `PreparedPrintJob`: identificador, título, conteúdo já resolvido, perfil de página, quantidade e metadados opcionais;
- `PrintRenderer`: adaptador responsável por transformar o mesmo job preparado em preview e saída final;
- `BrowserPrintAdapter`: janela, documento HTML, estilos de impressão e chamada a `window.print`;
- `PdfPrintAdapter`: integração com as rotinas atuais de jsPDF, branding, paginação e download;
- componentes visuais compartilháveis para moldura de preview, seleção de perfil de página, ação de imprimir/exportar, loading e erro.

O primeiro passo deve ser envolver o comportamento atual com esses contratos e adaptadores, não reescrever o módulo nem renomear suas tabelas. A extração deve ocorrer somente quando a Etapa 7 ou o primeiro cupom fornecer um segundo consumidor real e permitir validar a abstração.

### Suporte futuro a cupom térmico

O cupom deverá fornecer um conteúdo próprio — retirada, devolução, recibo ou resumo de locação — sem reutilizar snapshots de materiais de etiquetas. O adaptador térmico poderá compartilhar a janela de impressão, o perfil físico e o pipeline de preview/print, adicionando apenas capacidades específicas:

- perfis de largura de 58 mm e 80 mm;
- altura contínua ou calculada pelo conteúdo;
- layout monocromático, quebra de linha e separadores;
- margens internas, densidade tipográfica e quantidade de vias;
- eventual comando de corte apenas quando existir integração segura com hardware.

A escala e as margens físicas continuarão dependentes do navegador, driver e impressora. Perfis de 58/80 mm representam intenção de layout, não garantia física sem homologação do equipamento.

### Suporte futuro a A4 e documentos

Relatórios, orçamentos, propostas, contratos, termos e comprovantes deverão produzir um `PreparedPrintJob` com perfil A4, orientação, margens, cabeçalho, rodapé e regras de paginação. O adaptador PDF poderá encapsular progressivamente `pdf-branding.ts`, `pdf-save.ts`, `pdf-export*.ts` e jsPDF, preservando os exportadores atuais enquanto eles migram para o contrato compartilhado.

A Etapa 7 não deverá criar um novo gerenciador de janela de impressão, um segundo contrato de preview ou outro modelo incompatível de parâmetros de página. Ela deverá ser o primeiro consumidor de documento/A4 da infraestrutura comum. Orçamentos e demais documentos futuros deverão fornecer apenas conteúdo e regras do domínio, reutilizando o mesmo pipeline.

### Preview e impressão

Hoje o preview de etiquetas usa `LabelCanvas`, enquanto a impressão usa HTML estático gerado por `material-label-print.tsx`. Dados, modelo e ordem são compartilhados, mas os renderizadores visuais são distintos. Essa é a principal fronteira de evolução: o mesmo `PreparedPrintJob` e o mesmo adaptador de layout devem alimentar preview e impressão, evitando que mudanças futuras sejam aplicadas em apenas um deles.

Não é necessário corrigir essa fronteira com uma refatoração ampla agora. Até a extração do núcleo, qualquer alteração visual de etiqueta deve continuar sendo revisada nos dois renderizadores e homologada fisicamente.

### Persistência, templates e histórico

Nem todo documento precisa de histórico persistente. Etiquetas exigem snapshots e auditoria; um preview descartável de relatório pode não exigir. O futuro núcleo deverá permitir persistência opcional, definida pelo domínio.

Uma tabela genérica de jobs ou templates só deve ser criada quando cupom ou A4 apresentarem requisitos reais compartilhados de versionamento, reimpressão, auditoria ou modelos por empresa. Até lá:

- modelos e histórico de etiquetas permanecem nas estruturas atuais;
- relatórios continuam usando seus dados canônicos e exportadores existentes;
- novos formatos não devem gravar conteúdo nas tabelas de etiquetas;
- não será criada migration genérica apenas para antecipar cenários futuros.

### Regra para evitar duplicação

Antes de iniciar Relatórios, Orçamentos ou qualquer novo documento imprimível, deve ser feita uma revisão arquitetural obrigatória para reutilizar o contrato de página, preview, renderização e saída. Código específico de domínio pode existir para compor conteúdo, mas abertura de impressão, parâmetros físicos, branding, paginação e tratamento da saída devem permanecer atrás da infraestrutura canônica.

Esta estratégia preserva integralmente a Etapa 6 e permite evolução progressiva, sem transformar prematuramente o domínio de etiquetas em um motor genérico incompleto.

## Conclusão

**A Etapa 6 pode agora ser declarada tecnicamente concluída? Sim.**

O lote multi-material, atomicidade, idempotência, snapshots, multiempresa, paginação e margens internas foram implementados e validados. A homologação física e o E2E autenticado permanecem separados e explicitamente pendentes.
