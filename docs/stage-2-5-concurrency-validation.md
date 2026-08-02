# Etapa 2.5 — Validação concorrente em duas sessões

## Estado

Não executado em 02/08/2026. O ambiente não possui Docker, Podman, `psql` ou
outro cliente PostgreSQL capaz de manter duas transações simultâneas. O CLI
conecta ao remoto para lint e migrations, mas `supabase test db --linked` também
encerra com `LegacyDockerRunError` antes de rodar pgTAP.

Não executar estes cenários em produção. Usar banco descartável ou staging,
com dois usuários administradores da mesma empresa e IDs/UUIDs exclusivos.

## Critério comum

Em cada cenário, a sessão A deve manter a transação aberta depois da RPC. A
sessão B executa a operação conflitante e deve aguardar o lock. Após o commit da
sessão A, a sessão B deve produzir o resultado determinístico indicado. Ao fim:

- `estoque_saldos` não pode ficar negativo;
- `materiais.quantidade` deve ser igual à soma dos saldos;
- `estoque_divergencias_saldo` deve permanecer vazia;
- cada `client_uuid` deve aparecer no máximo uma vez;
- o ledger original nunca pode ser atualizado ou excluído.

## Saída

Preparar saldo 1 no local A. Duas sessões tentam retirar 1 unidade com UUIDs
distintos. Uma saída confirma; a outra aguarda e falha com `ST001`. Saldo final:
zero; exatamente uma nova saída.

## Transferência

Preparar saldo 1 no local A e zero nos locais B/C. A transfere A→B; B tenta
A→C. Depois do primeiro commit, a segunda falha com `ST001`. Total permanece 1
e apenas um destino recebe saldo.

## Saldo inicial

Preparar material sem movimentos e saldo zero. As duas sessões tentam saldo
inicial com UUIDs distintos. Uma confirma; a outra falha pela unicidade de saldo
inicial (`ST012` ou constraint traduzida). Deve existir um único ledger de
`saldo_inicial`.

## Estorno

Preparar uma entrada ainda não estornada e saldo suficiente no destino. As duas
sessões tentam estornar a mesma movimentação com UUIDs distintos. Uma confirma;
a outra aguarda e falha com `ST014`. Deve existir um único estorno ligado ao
original e a compensação deve ser aplicada uma única vez.
