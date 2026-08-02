# Etapa 2.5 — Reconciliação do estoque legado

## Princípio de segurança

`materiais.quantidade_legada_etapa1` é uma fotografia imutável do valor anterior
à Etapa 2. Ela não é saldo, não escolhe localização e nunca deve gerar
movimentações automaticamente. O saldo oficial continua exclusivamente em
`estoque_saldos`; o histórico oficial, em `estoque_movimentacoes`.

`materiais.localizacao` também permanece preservada, mas somente como texto
histórico. Ela não deve ser convertida automaticamente em
`estoque_localizacoes`, pois nomes livres não identificam com segurança um
depósito, sala, veículo ou estrutura canônica.

## Classificação segura

A view administrativa `estoque_reconciliacao_legado` passa a classificar cada
registro como:

- `sem_saldo_legado`: legado e saldo oficial iguais a zero; nenhuma carga é
  necessária;
- `saldo_equivalente`: saldo oficial já equivale ao legado; revisar o histórico
  antes de encerrar;
- `decisao_humana_pendente`: existe valor legado divergente e ainda não há
  movimentação; uma pessoa deve confirmar quantidade física e localização;
- `revisao_historica_pendente`: já existem movimentos e o valor legado diverge;
  não registrar saldo inicial sem revisar o ledger.

## Consulta de decisão

Executar com acesso administrativo somente leitura:

```sql
SELECT
  empresa_id,
  material_id,
  codigo_interno,
  nome,
  tipo_controle,
  quantidade_legada_etapa1,
  saldo_atual,
  localizacao_legada,
  tem_movimentacoes,
  saldo_inicial_pendente,
  status_reconciliacao
FROM public.estoque_reconciliacao_legado
WHERE status_reconciliacao IN (
  'decisao_humana_pendente',
  'revisao_historica_pendente'
)
ORDER BY empresa_id, codigo_interno;
```

Cada linha retornada exige uma decisão registrada com, no mínimo: material,
empresa, contagem física confirmada, localização oficial escolhida, responsável
pela conferência e data. Somente depois disso deve-se usar a ação explícita de
saldo inicial ou um ajuste, conforme o histórico existente.

## Estado da análise em 02/08/2026

A migration 2.5 foi aplicada e os tipos remotos confirmam as novas colunas da
view. A listagem dos valores reais não foi obtida: Docker, PostgreSQL, `psql` e
sessão autenticada no navegador continuam indisponíveis. Uma consulta REST
administrativa direcionada foi recusada pela política de chaves do endpoint; não
houve tentativa de contornar essa proteção. Portanto, nenhum registro foi
inventado e nenhuma movimentação foi criada. A consulta acima permanece a
pendência objetiva para produzir a lista nominal de decisões humanas.
