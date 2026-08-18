-- Regression tests for P1-1: one active recurring commercial base plan,
-- enforced by a partial unique index (including concurrent writers).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(11);

SELECT has_index(
  'public',
  'planos',
  'planos_single_active_commercial_base_idx',
  'single commercial base plan index exists'
);

SELECT ok(
  (
    SELECT index_definition.indisunique
    FROM pg_catalog.pg_class AS index_name
    JOIN pg_catalog.pg_index AS index_definition
      ON index_definition.indexrelid = index_name.oid
    WHERE index_name.oid =
      'public.planos_single_active_commercial_base_idx'::regclass
  ),
  'database uniqueness arbitrates simultaneous base-plan writes'
);

-- Isolate the fixture without deleting history. Existing recurring base rows
-- become inactive only inside this rolled-back test transaction.
UPDATE public.planos
SET ativo = false
WHERE categoria = 'plano_base'
  AND periodicidade IN ('mensal', 'anual')
  AND ativo = true;

SELECT lives_ok(
  $test$
    INSERT INTO public.planos (
      id, nome, valor, ativo, periodicidade, categoria,
      disponivel_novo_cadastro
    ) VALUES (
      'fa000000-0000-4000-8000-000000000001',
      '__single_base_first__', 100, true, 'mensal', 'plano_base', true
    )
  $test$,
  'first active commercial base plan can be created'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.planos (
      id, nome, valor, ativo, periodicidade, categoria,
      disponivel_novo_cadastro
    ) VALUES (
      'fa000000-0000-4000-8000-000000000002',
      '__single_base_second__', 200, true, 'anual', 'plano_base', true
    )
  $test$,
  '23505',
  'duplicate key value violates unique constraint "planos_single_active_commercial_base_idx"',
  'a second active commercial base plan is rejected'
);

SELECT lives_ok(
  $test$
    UPDATE public.planos
    SET descricao = 'edited safely', valor = 125
    WHERE id = 'fa000000-0000-4000-8000-000000000001'
  $test$,
  'the existing active base plan remains editable'
);

SELECT lives_ok(
  $test$
    INSERT INTO public.planos (
      id, nome, valor, ativo, periodicidade, categoria,
      disponivel_novo_cadastro
    ) VALUES (
      'fa000000-0000-4000-8000-000000000003',
      '__single_base_history__', 80, false, 'mensal', 'plano_base', false
    )
  $test$,
  'an inactive historical base plan remains allowed'
);

SELECT lives_ok(
  $test$
    UPDATE public.planos
    SET descricao = descricao
    WHERE periodicidade = 'trial'
  $test$,
  'the canonical Trial remains editable under its existing rules'
);

SELECT lives_ok(
  $test$
    UPDATE public.planos
    SET descricao = descricao
    WHERE periodicidade = 'vitalicio'
  $test$,
  'the canonical lifetime plan remains valid under its existing protection'
);

SELECT throws_ok(
  $test$
    UPDATE public.planos
    SET ativo = true
    WHERE id = 'fa000000-0000-4000-8000-000000000003'
  $test$,
  '23505',
  'duplicate key value violates unique constraint "planos_single_active_commercial_base_idx"',
  'historical base cannot be reactivated while the canonical base is active'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.planos
    WHERE categoria = 'plano_base'
      AND ativo = true
      AND periodicidade IN ('mensal', 'anual')
  ),
  1::bigint,
  'failed competing writes leave exactly one active commercial base plan'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.planos
    WHERE periodicidade = 'vitalicio'
      AND ativo = true
  ),
  'lifetime remains active separately from the commercial base plan'
);

SELECT * FROM finish();
ROLLBACK;
