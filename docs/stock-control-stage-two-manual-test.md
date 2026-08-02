# Etapa 2 — Roteiro de validação manual

## Objetivo e ambiente

Executar este roteiro somente em ambiente local ou de homologação. A migration
da Etapa 2 já está aplicada no remoto; testes que criem massa, concorrência ou
movimentações não devem ser executados em produção.

Registrar para cada cenário:

- resultado: `APROVADO`, `REPROVADO` ou `NÃO EXECUTADO`;
- usuário e empresa utilizados;
- data e hora;
- captura da tela;
- mensagens exibidas;
- evidência do Console e da aba Network quando aplicável.

Não usar dados reais de produção.

## Massa de teste recomendada

Preparar empresas e usuários independentes:

| Identificador | Configuração |
| --- | --- |
| Empresa A | Plano pago operacional; `gestao_materiais` e `controle_estoque` ativos |
| Empresa B | Plano pago operacional; somente `gestao_materiais` ativo |
| Empresa C | Plano pago operacional; sem os dois módulos |
| Empresa D | Licença Vitalícia operacional |
| Empresa E | Empresa bloqueada, expirada ou em modo somente leitura |
| Master | Usuário com papel `master_admin` |
| Admin A | `admin_empresa` da Empresa A |
| Usuário A | `usuario` da Empresa A |
| Admin B | `admin_empresa` da Empresa B |

Na Empresa A, preparar:

- categoria `Teste Estoque`;
- material quantitativo `CABO-EST-001`, unidade `unidade`, estoque mínimo `3`,
  UUID e código de barras conhecidos;
- material individual `MIC-EST-001`, com UUID, QR e código de barras conhecidos;
- localizações `Depósito Central`, `Corredor A`, `Prateleira 03` e
  `Depósito Secundário`;
- ao menos 15 materiais adicionais para paginação;
- ao menos 15 movimentações com tipos, documentos, datas e usuários variados.

Limpar Console e Network antes de cada grupo de testes.

## A. Integração modular e permissões

### 1. Ativação do módulo pelo Master

1. Entrar como Master.
2. Abrir `/master/modulos` e confirmar que `Controle de Estoque` está ativo no
   catálogo e não está marcado como planejado.
3. Abrir `/master/empresas`, selecionar a Empresa B e acessar o gerenciamento de
   módulos.
4. Ativar `Controle de Estoque`.
5. Entrar novamente como Admin B.

Resultado esperado:

- a ativação é aceita porque `gestao_materiais` já está ativo;
- o menu `Estoque` aparece;
- `/estoque` abre com os dados da Empresa B;
- nenhuma outra empresa recebe entitlement automaticamente.

### 2. Bloqueio sem entitlement

1. Entrar como Admin da Empresa C.
2. Verificar o menu lateral.
3. Digitar `/estoque` diretamente na barra de endereço.
4. Se houver uma sessão autenticada de API disponível, tentar consultar uma das
   tabelas de estoque.

Resultado esperado:

- o menu `Estoque` não aparece;
- a rota é bloqueada pelo `ModuleGate`;
- o banco não retorna localizações, saldos ou movimentos;
- nenhuma mensagem técnica do PostgreSQL é exibida.

### 3. Bloqueio sem dependência

1. Como Master, usar uma empresa de teste sem `gestao_materiais`.
2. Tentar ativar `controle_estoque`.
3. Ativar `gestao_materiais` e repetir.
4. Com ambos ativos, tentar desativar `gestao_materiais`.

Resultado esperado:

- a primeira ativação é recusada;
- após ativar a dependência, o estoque pode ser ativado;
- `gestao_materiais` não pode ser desativado enquanto
  `controle_estoque` estiver ativo;
- a mensagem é amigável e os estados dos módulos permanecem consistentes.

### 4. Acesso com licença Vitalícia

1. Entrar como administrador da Empresa D.
2. Abrir `/estoque`.
3. Consultar materiais e registrar uma movimentação de teste.

Resultado esperado:

- a regra canônica da licença Vitalícia libera os módulos ativos do catálogo;
- menu, leitura e escrita funcionam;
- nenhuma validade mensal é exigida;
- dependências modulares continuam respeitadas.

### 5. Empresa somente leitura

1. Entrar como Admin da Empresa E.
2. Abrir `/estoque`.
3. Consultar saldos e histórico.
4. Tentar abrir ou executar entrada, saída, ajuste, estorno e edição de
   localização.

Resultado esperado:

- dados existentes permanecem legíveis quando o contrato permitir leitura;
- ações de escrita ficam ocultas ou desabilitadas;
- qualquer tentativa residual é bloqueada no banco;
- nenhum saldo ou movimento é criado.

### 6. Usuário comum

1. Entrar como Usuário A.
2. Abrir `/estoque`.
3. Consultar saldos, detalhes e histórico.
4. Verificar as ações disponíveis.

Resultado esperado:

- leitura permitida;
- ações de saldo inicial, entrada, saída, transferência, ajuste, estorno e
  gerenciamento de localizações não aparecem;
- chamadas RPC de escrita feitas fora da interface são recusadas.

### 7. Administrador da empresa

1. Entrar como Admin A.
2. Abrir `/estoque`.
3. Abrir `Localizações`.
4. Abrir os dialogs de todas as operações.

Resultado esperado:

- leitura e ações administrativas estão disponíveis;
- todas as operações permanecem restritas à Empresa A;
- o contexto de empresa não pode ser alterado pelo payload do navegador.

## B. Localizações

### 8. Criação de localização

1. Abrir `Localizações`.
2. Criar `Depósito Central`, código `DEP-CENTRAL`, tipo `deposito`.
3. Tentar criar outro local com código ` dep-central `.
4. Tentar criar outro local com nome ` depósito central `.

Resultado esperado:

- a primeira localização é criada;
- duplicidades de código e nome, ignorando caixa e espaços externos, são
  recusadas com mensagens amigáveis;
- nomes de índices ou constraints não aparecem.

### 9. Hierarquia

1. Criar `Corredor A` com pai `Depósito Central`.
2. Criar `Prateleira 03` com pai `Corredor A`.
3. Reabrir o gerenciador.

Resultado esperado:

- o caminho completo é mostrado como
  `Depósito Central → Corredor A → Prateleira 03`;
- o pai pertence à mesma empresa;
- a hierarquia permanece após recarregar a página.

### 10. Ciclo bloqueado

1. Editar `Depósito Central`.
2. Tentar selecionar `Corredor A` ou `Prateleira 03` como pai.
3. Tentar selecionar a própria localização como pai.

Resultado esperado:

- a interface não oferece a própria localização nem descendentes;
- uma tentativa forçada é recusada pelo banco;
- a mensagem informa que a hierarquia não pode conter ciclos.

### 11. Inativação de localização

1. Inativar `Depósito Secundário`.
2. Abrir uma nova entrada e uma transferência.
3. Conferir o histórico antigo do local.
4. Se o local tiver saldo, abrir o ajuste físico e reduzi-lo.

Resultado esperado:

- o local inativo não aparece como destino de novas entradas ou transferências;
- o histórico permanece legível;
- saldo existente pode sair ou ser reduzido;
- acréscimo forçado em local inativo é bloqueado.

## C. Movimentações

### 12. Saldo inicial

1. Abrir o material `CABO-EST-001`, ainda sem movimentos.
2. Escolher `Registrar saldo inicial`.
3. Informar `Depósito Central`, quantidade `5`, observação e confirmar.

Resultado esperado:

- saldo total e saldo local passam de `0` para `5`;
- um único ledger `saldo_inicial` é criado;
- ator, data, UUID do cliente e snapshots anterior/posterior são registrados;
- quantidade legada, se houver, aparece apenas como referência.

### 13. Segundo saldo inicial bloqueado

1. No mesmo material, tentar registrar outro saldo inicial com outro
   `client_uuid`.

Resultado esperado:

- operação recusada com `O saldo inicial deste material já foi registrado`;
- saldo e ledger permanecem inalterados.

### 14. Entrada

1. Registrar entrada de `4` unidades no `Depósito Central`.
2. Informar motivo, documento, observação e data efetiva.

Resultado esperado:

- saldo local e total aumentam de `5` para `9`;
- ledger registra tipo `entrada`, documento, motivo, ator e snapshots;
- status operacional do material não muda.

### 15. Saída

1. Registrar saída de `2` unidades do `Depósito Central`.
2. Informar motivo e data efetiva.

Resultado esperado:

- saldo local e total passam de `9` para `7`;
- ledger registra tipo `saida`;
- nenhum status operacional é alterado.

### 16. Saldo insuficiente

1. Tentar retirar quantidade superior ao saldo do local.

Resultado esperado:

- mensagem `Saldo insuficiente na localização de origem`;
- saldo nunca fica negativo;
- nenhum ledger efetivo é criado.

### 17. Transferência

1. Transferir `3` unidades do `Depósito Central` para
   `Depósito Secundário` ativo.

Resultado esperado:

- origem reduz em `3` e destino aumenta em `3`;
- saldo total não muda;
- existe uma única movimentação lógica;
- não existe estado intermediário visível.

### 18. Origem igual ao destino

1. Tentar transferir usando o mesmo local como origem e destino.

Resultado esperado:

- a interface exige locais diferentes;
- tentativa forçada é recusada com mensagem amigável;
- saldo e ledger não mudam.

### 19. Ajuste positivo

1. Escolher um local com saldo `4`.
2. Informar quantidade física `6`, motivo e justificativa.

Resultado esperado:

- diferença exibida `+2`;
- movimento `ajuste_positivo` de `2`;
- saldo posterior do local é `6`;
- justificativa, motivo e ator ficam preservados.

### 20. Ajuste negativo

1. No mesmo local com saldo `6`, informar quantidade física `3`.
2. Informar motivo e justificativa.

Resultado esperado:

- diferença exibida `-3`;
- movimento `ajuste_negativo` de `3`;
- saldo posterior é `3`;
- status operacional não muda.

### 21. Estorno

1. No histórico, escolher uma entrada, saída, transferência ou ajuste.
2. Abrir `Estornar movimentação`.
3. Conferir o resumo e o impacto previsto.
4. Informar justificativa e confirmar.

Resultado esperado:

- registro original permanece intacto;
- um movimento compensatório `estorno` é criado;
- `movimentacao_estornada_id` referencia o original;
- saldo é recomposto atomicamente;
- estorno de transferência executa o caminho inverso.

### 22. Segundo estorno bloqueado

1. Tentar estornar novamente a mesma movimentação.

Resultado esperado:

- operação recusada como já estornada;
- nenhum segundo movimento compensatório é criado.

### 23. Material individual

1. Registrar saldo inicial `1` para `MIC-EST-001`.
2. Tentar nova entrada de `1`.
3. Transferir a unidade para outro local.
4. Registrar saída de `1`.
5. Tentar nova saída e tentar qualquer quantidade diferente de `1`.

Resultado esperado:

- saldo total aceita somente `0` ou `1`;
- nova entrada quando já há saldo é recusada;
- transferência move a única unidade sem duplicá-la;
- saída `1 → 0` funciona;
- saída sem saldo e quantidades diferentes de `1` são recusadas;
- nunca existem dois locais com saldo positivo.

### 24. Material por quantidade

1. Distribuir o material `CABO-EST-001` em dois locais.
2. Executar entradas, saídas e transferência.
3. Tentar quantidade zero, negativa e fracionária.

Resultado esperado:

- múltiplos locais são aceitos;
- saldo consolidado é a soma dos locais;
- apenas inteiros positivos são aceitos nas movimentações;
- saldo negativo permanece impossível.

### 25. Estoque mínimo

1. Definir estoque mínimo `3` no cadastro do material.
2. Ajustar o saldo para `4`, depois `3`, depois `0`.

Resultado esperado:

- saldo `4` é normal;
- saldo `3` é sinalizado como abaixo ou igual ao mínimo;
- saldo `0` é sinalizado como sem saldo;
- mudar o mínimo não cria movimentação nem altera saldo.

## D. Consulta, pesquisa e integração

### 26. Histórico

1. Abrir a aba `Histórico`.
2. Conferir movimentos de todos os tipos.
3. Abrir um registro estornado.

Resultado esperado:

- data, material, tipo, quantidade, origem, destino, saldos, motivo, documento,
  usuário, origem do módulo e estorno são exibidos;
- não há editar ou excluir;
- ordem padrão é da movimentação mais recente para a mais antiga.

### 27. Filtros

1. Testar separadamente e em combinação: período, material, localização, tipo,
   usuário, documento e origem do módulo.
2. Na aba de saldos, combinar categoria, localização, controle, situação de
   saldo e ativo/inativo.

Resultado esperado:

- apenas registros compatíveis são retornados;
- remover filtros restaura o conjunto;
- contagem e páginas são recalculadas.

### 28. Paginação

1. Usar massa com mais de dez materiais e movimentos.
2. Navegar entre páginas de saldos e histórico.
3. Alterar um filtro na página 2.

Resultado esperado:

- somente o subconjunto da página é transferido;
- botões anterior/próxima respeitam os limites;
- alteração de filtro retorna para a página 1;
- o ledger inteiro não é carregado no navegador.

### 29. Busca por UUID

1. Copiar o UUID técnico completo de um material.
2. Pesquisar na página de estoque.

Resultado esperado:

- somente o material correspondente aparece.

### 30. Busca por QR

1. Pesquisar por `BACKSTAGE-PRO:MATERIAL:<uuid>` usando o conteúdo canônico do
   QR.

Resultado esperado:

- o material correspondente aparece;
- a busca não depende de nome ou código mutável.

### 31. Busca por código de barras

1. Pesquisar pelo código de barras integral do material.

Resultado esperado:

- o material correspondente aparece;
- materiais de outras empresas nunca aparecem.

### 32. Integração na tela Materiais

1. Abrir `/materiais` e os detalhes de um material.
2. Conferir a seção `Estoque`.
3. Usar os botões para movimentar e abrir o histórico.
4. Abrir a edição do material.

Resultado esperado:

- detalhes mostram saldo total, saldos por localização, estoque mínimo,
  situação e últimas movimentações;
- material individual mostra uma única localização ou `Fora de estoque`;
- links abrem `/estoque` no material/aba corretos;
- `quantidade` e localização textual não são editáveis;
- `estoque_minimo` continua editável sem alterar saldo.

## E. Preservação, tenancy e responsividade

### 33. Desativação do módulo

1. Como Master, remover ou inativar o entitlement de `controle_estoque` da
   Empresa A.
2. Entrar como Admin A e tentar menu, rota, leitura e RPC.

Resultado esperado:

- menu oculto, rota bloqueada, leitura e escrita bloqueadas;
- nenhuma tabela é apagada.

### 34. Preservação dos dados

1. Enquanto o módulo está desativado, verificar como Master ou por consulta
   administrativa controlada a existência dos dados.

Resultado esperado:

- localizações, saldos e ledger permanecem com as mesmas quantidades e IDs;
- desativação não gera movimento nem zera projeções.

### 35. Reativação

1. Reativar o entitlement.
2. Entrar novamente como Admin A.

Resultado esperado:

- menu e rota voltam a funcionar;
- todos os dados anteriores reaparecem intactos;
- novas movimentações podem ser registradas.

### 36. Isolamento multiempresa

1. Entrar como Admin B.
2. Pesquisar UUID, QR e código de barras pertencentes à Empresa A.
3. Tentar usar IDs de material, localização e movimentação da Empresa A em
   chamadas forçadas.

Resultado esperado:

- nenhuma busca retorna dados da Empresa A;
- relacionamentos cruzados e RPCs são recusados;
- nenhum erro revela detalhes internos ou dados de outra empresa.

### 37. Layout desktop

1. Testar em largura igual ou superior a `1280px`.
2. Percorrer indicadores, filtros, tabela, ações, dialogs, histórico e
   localizações.

Resultado esperado:

- tabela e colunas permanecem legíveis;
- ações não se sobrepõem;
- dialogs cabem na área visível e permitem rolagem;
- não há overflow horizontal inesperado.

### 38. Layout mobile

1. Testar em `375x667` e `390x844`.
2. Percorrer saldos, cards, filtros, paginação, histórico e dialogs.

Resultado esperado:

- cards substituem a tabela de saldos;
- campos e botões permanecem acessíveis;
- textos longos quebram corretamente;
- não há elementos cortados ou ações impossíveis de tocar.

## F. Diagnóstico do navegador

### 39. Console

1. Limpar o Console.
2. Executar um fluxo bem-sucedido de cada operação.
3. Executar erros previstos: duplicidade, saldo insuficiente, segundo saldo
   inicial, segundo estorno e ciclo.

Resultado esperado:

- fluxos válidos não geram erros;
- erros conhecidos são traduzidos e não despejam stack trace desnecessário;
- constraint, SQL e mensagem bruta do PostgreSQL não aparecem para o usuário;
- erros desconhecidos usam fallback seguro e preservam diagnóstico útil somente
  no Console.

### 40. Network

1. Filtrar requisições por `estoque`.
2. Registrar entrada, saída, transferência, ajuste e estorno.
3. Dar duplo clique no botão de confirmação durante uma operação.
4. Inspecionar paginação de saldos e histórico.

Resultado esperado:

- mutações usam somente as RPCs canônicas;
- não existem `INSERT/UPDATE/DELETE` diretos em saldos ou ledger;
- botão fica desabilitado durante envio;
- uma tentativa lógica mantém o mesmo `client_uuid`;
- resposta não contém stack trace ou SQL;
- paginação transfere apenas o intervalo solicitado.

## G. Regressões

### 41. Regressão de Materiais

1. Criar, editar, inativar e reativar material.
2. Criar e editar categoria.
3. Testar foto principal, UUID, QR e código de barras.
4. Tentar duplicidades de código, patrimônio, série, código de barras e
   categoria.

Resultado esperado:

- CRUD cadastral continua operacional;
- saldo não pode ser editado pelo CRUD;
- QR permanece `BACKSTAGE-PRO:MATERIAL:<uuid>`;
- mensagens de unicidade continuam amigáveis;
- nenhuma alteração cadastral muda o estoque.

### 42. Regressão de Agenda

1. Abrir `/agenda`.
2. Criar e editar um evento de teste.
3. Navegar entre datas e abrir detalhes.

Resultado esperado:

- agenda carrega e salva normalmente;
- nenhuma consulta ou erro de estoque interfere no módulo.

### 43. Regressão de Financeiro

1. Abrir `/financeiro` com administrador autorizado.
2. Consultar filtros e detalhes.
3. Criar ou editar um lançamento de teste, se o ambiente permitir.

Resultado esperado:

- consultas e mutações financeiras mantêm o comportamento anterior;
- nenhuma movimentação de estoque é gerada;
- permissões financeiras não são alteradas.

### 44. Regressão de Dashboard

1. Abrir `/dashboard`.
2. Conferir indicadores, gráficos e navegação.
3. Atualizar a página após movimentações de estoque.

Resultado esperado:

- Dashboard permanece funcional;
- não surgem erros de consultas ou módulos;
- a Etapa 2 não cria notificações ou indicadores automáticos fora do escopo.

## Critério de aprovação

A Etapa 2 pode avançar para publicação somente quando:

- todos os cenários aplicáveis estiverem aprovados;
- pgTAP, `db lint`, dry-run e ensaio concorrente tiverem evidência positiva;
- a view `estoque_divergencias_saldo` estiver vazia;
- Console e Network não apresentarem vazamento técnico;
- não houver regressões em Materiais, Agenda, Financeiro ou Dashboard;
- a migration revisada for a única migration incremental da Etapa 2.
