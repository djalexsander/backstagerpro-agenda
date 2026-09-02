# ETAPA 6 — ROTEIRO DE HOMOLOGAÇÃO FÍSICA DE IMPRESSÃO

Status: **PENDENTE**

Este roteiro exige impressora e scanner reais. A geração correta do valor no
SVG/HTML não comprova dimensão física, alimentação da mídia ou leitura óptica.

## Preparação

1. Usar uma empresa de homologação com o módulo de Etiquetas ativo.
2. Selecionar materiais de teste que tenham QR Code e Code 128 canônicos ativos.
3. Criar modelos separados para QR Code, Code 128 e formato combinado.
4. Registrar fabricante, modelo, driver, navegador, sistema operacional, mídia
   e resolução de cada impressora usada.
5. Configurar o diálogo do navegador com escala 100%, margens desativadas e sem
   cabeçalhos/rodapés.

## Impressora térmica

- configurar no driver exatamente a largura e a altura do modelo;
- imprimir uma etiqueta de QR Code, uma de Code 128 e uma combinada;
- medir largura, altura e margens com régua ou paquímetro;
- verificar corte, avanço, orientação, centralização e áreas não imprimíveis;
- confirmar ausência de redimensionamento automático do driver;
- repetir com lote de pelo menos 10 etiquetas e verificar alinhamento cumulativo.

## Impressora comum A4

- usar somente se a mídia/folha suportar o tamanho escolhido;
- manter escala 100% e desativar ajuste à página;
- validar quebra de página, orientação, margem física e ausência de cabeçalhos;
- verificar se uma etiqueta não invade a página seguinte;
- repetir com múltiplas etiquetas e conferir a ordem do lote.

## Legibilidade e scanners

- ler o QR Code com ao menos um celular e um scanner compatível;
- ler o Code 128 com scanner físico;
- comparar byte a byte o valor lido com `conteudo_qr_code` ou `codigo_barras` do
  material canônico;
- testar o formato combinado sem interferência óptica entre os dois códigos;
- testar distância, inclinação, iluminação e superfície de aplicação reais;
- reprovar códigos cortados, borrados, pequenos demais ou com baixo contraste.

## Histórico e lote

- confirmar material, modelo/versão, quantidade, usuário e data/hora no histórico;
- alterar o nome do material depois da solicitação e confirmar que o snapshot
  anterior permanece inalterado;
- simular retry com a mesma chave idempotente e confirmar ausência de duplicação;
- validar lote de múltiplas cópias e, após implementação específica, lote com
  múltiplos materiais.

## Navegadores

Executar ao menos em Chromium/Chrome ou Edge usado em produção. Registrar:

- bloqueio/liberação de pop-up;
- abertura do diálogo de impressão;
- escala aplicada;
- margens e cabeçalhos;
- orientação e tamanho de papel;
- comportamento ao cancelar;
- comportamento após reabrir/reimprimir.

## Critério de aceite

A homologação física somente pode ser aprovada quando dimensões, margens,
legibilidade, scanner, lote, quebra de página e valores codificados forem
confirmados em hardware real. Até lá:

`Validação física em impressoras: PENDENTE`

`Validação com scanner físico: PENDENTE`

---

## ETAPA 9 — matriz final 50 × 30 e 60 × 40

Status automatizado: **APROVADO**

Status físico: **PENDENTE DE EXECUÇÃO EM HARDWARE REAL**

Esta matriz complementa o roteiro acima após as ET1–ET8. Não substitui a
medição da mídia nem a leitura com scanner físico.

### Evidências automatizadas

| Item | Evidência |
| --- | --- |
| 50 × 30 e 60 × 40 mm | `material-label-print.test.tsx` valida as duas dimensões e a largura útil do SVG. |
| 203 e 300 DPI | os quatro pares dimensão/DPI validam módulos em quantidade inteira de dots. |
| Barcode numérico | valor de 10 dígitos usa `CODE128C`, quiet zone de 10 módulos e texto humano quando há espaço. |
| BSP legado | os quatro pares dimensão/DPI usam `CODE128`, nunca módulo fracionário e preservam as barras antes do texto humano. |
| Nome e empresa longos | nome limitado a duas linhas; empresa limitada a uma linha com elipse. |
| QR + barcode | blocos separados, QR com proporção preservada e barcode sem compressão por CSS. |
| Margens e offsets | `LabelCanvas.test.tsx`, `LabelPrintDialog.test.tsx` e `label-layout-engine.test.ts` validam a geometria efetiva do perfil. |
| Prévia e impressão | `LabelCanvas` e impressão reutilizam `renderLabelMarkup` e `buildLabelContentCss`; o perfil resolvido é encaminhado ao lote real. |

### Materiais obrigatórios

- [ ] Material A: barcode numérico novo de 10 dígitos e QR atual.
- [ ] Material B: barcode legado `BSP-*` e QR atual.
- [ ] Material C: nome longo, suficiente para ocupar duas linhas.
- [ ] Empresa de homologação com nome longo, suficiente para testar a linha única.
- [ ] Confirmar no cadastro os valores exatos de `codigo_barras`,
      `conteudo_qr_code` e `identificador_unico` antes de imprimir.

### Ordem obrigatória F1–F8

Antes de F1, configurar escala 100%, margens e cabeçalhos do navegador
desativados e a opção “ajustar à página” desligada. Registrar fabricante,
modelo, driver, tipo de mídia e valores de margem/offset do perfil. Não alterar
essas opções entre casos do mesmo perfil.

1. **F1 — 50 × 30 mm / 203 DPI / numérico + QR:** imprimir uma unidade do
   Material A com nome e empresa longos.
2. **F2 — 50 × 30 mm / 203 DPI / BSP + QR:** imprimir uma unidade do Material
   B com o mesmo modelo combinado.
3. **F3 — 50 × 30 mm / 203 DPI / lote de 10:** imprimir dez etiquetas sem
   interrupção e conferir avanço, GAP e desvio acumulado da primeira à décima.
4. **F4 — 60 × 40 mm / 203 DPI / numérico + QR:** imprimir uma unidade do
   Material A com nome e empresa longos.
5. **F5 — 60 × 40 mm / 203 DPI / BSP + QR:** imprimir uma unidade do Material
   B com o mesmo modelo combinado.
6. **F6 — 60 × 40 mm / 203 DPI / lote de 10:** imprimir dez etiquetas sem
   interrupção e conferir avanço, GAP e desvio acumulado da primeira à décima.
7. **F7 — 50 × 30 mm / 300 DPI, se disponível:** repetir F1 e F2; repetir o
   lote de F3 se a impressora, driver ou mídia forem diferentes dos usados em
   203 DPI.
8. **F8 — 60 × 40 mm / 300 DPI, se disponível:** repetir F4 e F5; repetir o
   lote de F6 se a impressora, driver ou mídia forem diferentes dos usados em
   203 DPI.

Não havendo equipamento 300 DPI, registrar F7 e F8 como “N/A — equipamento
indisponível”; isso não deve ser confundido com aprovação física em 300 DPI.

### Registro objetivo por teste

Preencher `OK`, `FALHA` ou `N/A` em cada resultado. Em F3 e F6, considerar
`OK` somente se as dez etiquetas mantiverem o mesmo alinhamento e GAP.

| Caso | Leitura barcode | Leitura QR | Centralização | Corte nome/empresa | Avanço/GAP | Observação | Foto/referência |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 — 50 × 30 / 203 / numérico + QR |  |  |  |  |  |  |  |
| F2 — 50 × 30 / 203 / BSP + QR |  |  |  |  |  |  |  |
| F3 — 50 × 30 / 203 / lote de 10 |  |  |  |  |  |  |  |
| F4 — 60 × 40 / 203 / numérico + QR |  |  |  |  |  |  |  |
| F5 — 60 × 40 / 203 / BSP + QR |  |  |  |  |  |  |  |
| F6 — 60 × 40 / 203 / lote de 10 |  |  |  |  |  |  |  |
| F7 — 50 × 30 / 300 / repetições |  |  |  |  |  |  |  |
| F8 — 60 × 40 / 300 / repetições |  |  |  |  |  |  |  |

### Checklist por impressão

- [ ] A largura e a altura impressas correspondem ao perfil selecionado.
- [ ] Margens e offsets medidos correspondem aos valores configurados.
- [ ] A prévia mostra a mesma posição, ordem e proporção do resultado físico.
- [ ] O nome ocupa no máximo duas linhas e não é cortado verticalmente.
- [ ] A empresa ocupa uma linha e não invade a área dos códigos.
- [ ] O QR não invade texto nem barcode e pode ser lido pelo celular/scanner.
- [ ] O barcode não está cortado nas laterais ou na base.
- [ ] As quiet zones laterais estão livres de texto, borda ou outro código.
- [ ] As barras estão nítidas, sem redimensionamento aparente ou borramento.
- [ ] O texto humano, quando presente, está legível e separado das barras.
- [ ] O valor lido do QR corresponde exatamente a `conteudo_qr_code`.
- [ ] O valor lido do Code 128 corresponde exatamente a `codigo_barras`.
- [ ] O formato combinado permite ler QR e barcode independentemente.
- [ ] Uma reimpressão produz o mesmo conteúdo persistido.
- [ ] Um lote de 10 etiquetas não apresenta desvio cumulativo de alinhamento.

### Registro da homologação

| Campo | Valor |
| --- | --- |
| Data e responsável | |
| Impressora / firmware | |
| Driver / versão | |
| Sistema / navegador | |
| Mídia / fabricante | |
| Dimensão medida 50 × 30 | |
| Dimensão medida 60 × 40 | |
| Margens e offsets medidos | |
| Leitor de QR utilizado | |
| Scanner de Code 128 utilizado | |
| Casos aprovados | |
| Casos reprovados e evidências | |

A ET9 física somente deve ser marcada como aprovada quando F1–F8 e todos os
itens aplicáveis da checklist estiverem registrados.
