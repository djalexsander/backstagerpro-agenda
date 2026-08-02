BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.materiais',
    'localizacao',
    'UPDATE'
  ),
  'ordinary material CRUD cannot update the deprecated location'
);

SELECT ok(
  col_description(
    'public.materiais'::regclass,
    (
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'public.materiais'::regclass
        AND attname = 'localizacao'
    )
  ) ILIKE '%read-only%',
  'deprecated material location is documented as read-only'
);

SELECT has_column(
  'public',
  'estoque_reconciliacao_legado',
  'localizacao_legada',
  'legacy reconciliation exposes the historical location for human review'
);

SELECT has_column(
  'public',
  'estoque_reconciliacao_legado',
  'status_reconciliacao',
  'legacy reconciliation classifies records without moving stock'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.estoque_reconciliacao_legado',
    'SELECT'
  ),
  'legacy reconciliation remains an administrative diagnostic'
);

SELECT * FROM finish();
ROLLBACK;
