-- Regression coverage for P1-15 (20260911090000_financials_non_negative_amounts.sql):
-- public.financials.financials_amounts_non_negative rejects a negative
-- cache/transport/food/lodging/other_costs on both INSERT and UPDATE, while
-- still allowing zero and NULL (not-entered).
--
-- NOTE: `supabase test db` doesn't work in this environment (no
-- Docker/`supabase start` here). Actually executed instead against a plain
-- WSL Postgres 16 harness (bootstrap + all 147 migrations replayed in order,
-- then this file) - all 9 assertions pass. See
-- supabase/tests/local_supabase_postgres_bootstrap.sql for the general
-- replay approach this repo uses.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(9);

INSERT INTO public.planos (id, nome, valor, periodicidade, ativo)
VALUES ('fa100000-0000-4000-8000-000000000001', '__financials_amounts_test_plan__', 99, 'mensal', true);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES (
  'fa200000-0000-4000-8000-000000000001', '__financials_amounts_company__',
  'ativo', 'fa100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO public.events (id, name, artist, date, status, city, venue, empresa_id, num_days)
VALUES (
  'fa300000-0000-4000-8000-000000000001', '__financials_amounts_event__', 'Artist',
  current_date, 'confirmado', 'City', 'Venue', 'fa200000-0000-4000-8000-000000000001', 1
);

-- 1: all-zero amounts are valid (a pro-bono event with no costs yet).
SELECT lives_ok(
  $$ INSERT INTO public.financials (id, event_id, empresa_id, cache, transport, food, lodging, other_costs)
     VALUES ('fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001',
             'fa200000-0000-4000-8000-000000000001', 0, 0, 0, 0, 0) $$,
  'zero on every amount column is accepted'
);

-- 2: ordinary positive amounts remain valid.
SELECT lives_ok(
  $$ UPDATE public.financials SET cache = 5000, transport = 300, food = 150, lodging = 400, other_costs = 50
     WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  'ordinary positive amounts are accepted'
);

-- 3: NULL (not entered yet) stays allowed - the constraint only forbids
-- negative, not missing.
SELECT lives_ok(
  $$ UPDATE public.financials SET other_costs = NULL WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  'NULL (not entered) is still accepted after the CHECK constraint'
);

-- 4-8: a negative value on any of the five columns is rejected by the CHECK.
SELECT throws_ok(
  $$ UPDATE public.financials SET cache = -1 WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  '23514',
  NULL,
  'a negative cache is rejected by the CHECK constraint'
);
SELECT throws_ok(
  $$ UPDATE public.financials SET transport = -1 WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  '23514',
  NULL,
  'a negative transport is rejected by the CHECK constraint'
);
SELECT throws_ok(
  $$ UPDATE public.financials SET food = -1 WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  '23514',
  NULL,
  'a negative food is rejected by the CHECK constraint'
);
SELECT throws_ok(
  $$ UPDATE public.financials SET lodging = -1 WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  '23514',
  NULL,
  'a negative lodging is rejected by the CHECK constraint'
);
SELECT throws_ok(
  $$ UPDATE public.financials SET other_costs = -1 WHERE id = 'fa400000-0000-4000-8000-000000000001' $$,
  '23514',
  NULL,
  'a negative other_costs is rejected by the CHECK constraint'
);

-- 9: the same rule applies on INSERT, not just UPDATE.
SELECT throws_ok(
  $$ INSERT INTO public.financials (event_id, empresa_id, cache)
     VALUES ('fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', -200) $$,
  '23514',
  NULL,
  'a negative amount is rejected on INSERT as well as UPDATE'
);

SELECT * FROM finish();
ROLLBACK;
