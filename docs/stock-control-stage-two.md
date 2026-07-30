# Etapa 2 — Controle de Estoque

Documentos complementares:

- [Relatório de entrega](./stock-control-stage-two-delivery-report.md)
- [Roteiro de validação manual](./stock-control-stage-two-manual-test.md)

## Decisões canônicas

- As tabelas oficiais são `estoque_localizacoes`, `estoque_saldos` e
  `estoque_movimentacoes`. Não existe um conjunto paralelo com prefixo
  `materiais_`.
- `estoque_saldos` é a única fonte do saldo atual por localização.
- `estoque_movimentacoes` é o ledger imutável e auditável.
- `materiais.quantidade` foi mantido temporariamente apenas como projeção
  técnica, atualizada por trigger com a soma de `estoque_saldos`. O frontend e
  os serviços comuns não enviam esse campo.
- O valor anterior à Etapa 2 é preservado em
  `materiais.quantidade_legada_etapa1`. Ele não cria saldo nem movimentação. A
  view `estoque_reconciliacao_legado` apoia a conferência e a ação explícita
  **Registrar saldo inicial**.
- `materiais.localizacao` permanece somente por compatibilidade histórica. Não
  é sincronizado, exibido como localização oficial ou utilizado no estoque.
  Ambos os campos legados podem ser removidos em migration futura depois da
  reconciliação validada.
- Quantidades são inteiras. O cadastro atual não possui uma distinção segura
  para unidades fracionárias.
- Código e nome de localização são únicos por empresa, ignorando caixa e
  espaços externos. Isso impede seletores e caminhos hierárquicos ambíguos.

## Concorrência e saldo negativo

Cada RPC:

1. resolve a empresa canônica do ator;
2. valida empresa operacional, módulo, dependência e permissão;
3. adquire lock de idempotência por empresa + `client_uuid`;
4. bloqueia o material com `FOR UPDATE`;
5. cria, ordena e bloqueia as linhas de saldo envolvidas;
6. valida e atualiza saldo, projeção e ledger na mesma transação.

O check `estoque_saldos_nonnegative` é a última barreira. Materiais
individuais também possuem trigger de segunda barreira, limitando a soma a
zero ou um e uma única localização positiva.

### Ensaio real de duas sessões

Preparação: material quantitativo com saldo `1` na localização A e dois
administradores autenticados da mesma empresa.

Sessão A:

```sql
BEGIN;
SELECT public.registrar_movimentacao_estoque(
  '<material>', 'saida', 1, '<uuid-a>', '<local-a>',
  NULL, 'ensaio concorrente A', NULL, NULL, NULL, 'manual', NULL, NULL
);
-- manter a transação aberta
```

Sessão B, enquanto A está aberta:

```sql
BEGIN;
SELECT public.registrar_movimentacao_estoque(
  '<material>', 'saida', 1, '<uuid-b>', '<local-a>',
  NULL, 'ensaio concorrente B', NULL, NULL, NULL, 'manual', NULL, NULL
);
```

A sessão B deve aguardar. Após `COMMIT` da sessão A, B deve falhar com
`ST001`. O saldo final deve ser zero, deve existir uma única saída e a view
`estoque_divergencias_saldo` deve permanecer vazia. O mesmo ensaio pode
inverter a ordem dos commits sem alterar o resultado.

## Idempotência e auditoria

O cliente gera um UUID por tentativa lógica e o mantém durante envio e
reenvio. A repetição do mesmo UUID e payload retorna a movimentação existente.
O mesmo UUID com payload diferente falha com `ST013`.

O ledger registra ator, data efetiva, origem funcional, referência externa,
motivo/justificativa, localizações, saldos antes/depois por localização e
saldo total antes/depois. Não há `UPDATE` ou `DELETE`; correções são estornos
compensatórios com vínculo único ao registro original.

### Regras de estorno por operação

- **Entrada, saldo inicial e ajuste positivo:** o estorno retira da localização
  que recebeu o material. Ele é recusado quando o saldo atual desse local não
  comporta a compensação.
- **Saída e ajuste negativo:** o estorno devolve o material à localização de
  origem. A localização histórica pode receber exclusivamente essa compensação
  mesmo que tenha sido inativada, preservando a capacidade de recompor o saldo.
- **Transferência:** o estorno executa a transferência inversa em uma única
  transação, debitando o destino original e creditando a origem original. É
  recusado quando o destino original não possui saldo suficiente.
- **Material individual:** toda compensação continua sujeita ao saldo total
  zero ou um e à regra de uma única localização positiva.
- **Imutabilidade:** a movimentação original nunca é alterada ou excluída. O
  evento compensatório usa `tipo_movimentacao = 'estorno'`, referencia
  `movimentacao_estornada_id` e registra justificativa, ator e novos snapshots.
- **Unicidade e idempotência:** uma movimentação admite somente um estorno. O
  retry com o mesmo `client_uuid` e payload retorna o estorno existente; a mesma
  chave com payload diferente é rejeitada.

Origens futuras já existem no enum para compatibilidade estrutural, mas os
RPCs desta etapa autorizam somente `manual` e `controle_estoque`.

## Publicação

A migration `20260730080000_stock_control_stage_two.sql` é incremental. Antes
de qualquer `supabase db push --linked`, aplicar e executar os testes pgTAP em
uma transação descartável, finalizar com `ROLLBACK` e revisar o resultado.
