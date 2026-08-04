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
