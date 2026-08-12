-- Regression test for the canonical Master plan-transition RPC fixed by
-- 20260811130000_master_set_company_plan.sql (Codex review cycle 3,
-- problem 2 and problem 3):
--   * a company assigned a paid plan by the Master used to keep
--     status_pagamento = 'pendente' with no pagamentos row - blocked with
--     no path to ever reach 'pago';
--   * assigning the trial plan used to leave plano_id set, contradicting
--     the canonical access-control model (trial => plano_id IS NULL);
--   * precisa_escolher_plano was never cleared on an admin-driven
--     transition;
--   * switching plans never reconciled a pending charge left by the
--     previous plan;
--   * the Vitalícia grant on creation/edit could silently ignore the
--     status the Master actually picked (including "inativo").
--
-- This test is fully self-contained: its own paid-plan and empresa
-- fixtures, and it only ever *reads* the pre-existing canonical trial and
-- lifetime plans (both are protected singletons - see
-- lifetime_subscription_test.sql).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(37);

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, periodicidade, categoria, ativo, disponivel_novo_cadastro, trial_days
) VALUES (
  'b0000000-0000-4000-8000-000000000001', '__master_plan_rpc_test_paid__',
  100, 'mensal', 'plano_base', true, true, 0
);

-- Simulates the exact broken scenario the review flagged: an empresa with
-- no plano_id yet, awaiting the Master's decision, default 'pendente'
-- payment status and no pagamentos row at all.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES (
  'b1000000-0000-4000-8000-000000000001', '__master_plan_rpc_test_company__',
  'ativo', 'basico', NULL, false, true, 'pendente', NULL, NULL
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'plan-rpc-master@example.test', '', now(),
   '{}', '{"full_name":"Plan RPC Test Master"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'plan-rpc-non-master@example.test', '', now(),
   '{}', '{"full_name":"Plan RPC Test Non Master"}', now(), now());

UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'b2000000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 1. anon has no grant at all on the wrapper.
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.master_set_company_plan(uuid, uuid, text, timestamptz, boolean)', 'EXECUTE'
  ),
  'anon cannot execute master_set_company_plan'
);

-- ----------------------------------------------------------------------------
-- 2. A non-master authenticated user is rejected.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'ativo',
    NULL
  )$test$,
  'P0001',
  'Only a global master administrator can change a company plan',
  'a non-master authenticated user cannot change a company plan'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- 3. Unknown/inactive plan and unknown company are rejected.
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000000',
    'ativo',
    NULL
  )$test$,
  'P0001',
  'Plan was not found or is inactive',
  'an unknown plan id is rejected'
);

SELECT throws_ok(
  $test$SELECT public.master_set_company_plan(
    '00000000-0000-4000-8000-000000000000',
    'b0000000-0000-4000-8000-000000000001',
    'ativo',
    NULL
  )$test$,
  'P0001',
  'Company was not found',
  'an unknown company id is rejected'
);

-- ----------------------------------------------------------------------------
-- 4. Assigning a paid plan gives the company an immediate activation path:
--    status_pagamento = 'pago' with the Master's chosen due date, no
--    fictitious pagamentos/asaas charge, precisa_escolher_plano cleared.
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'ativo',
    '2027-01-01T00:00:00Z'
  )$test$,
  'a master_admin can assign a paid plan to a pending company'
);

RESET ROLE;

SELECT is(
  (SELECT plano_id FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'plano_id was assigned'
);

SELECT is(
  (SELECT status_pagamento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'pago',
  'a master-assigned paid plan is marked pago, giving it an immediate activation path'
);

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  '2027-01-01T00:00:00Z'::timestamptz,
  'vencimento matches the due date the master picked'
);

SELECT is(
  (SELECT precisa_escolher_plano FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  false,
  'precisa_escolher_plano is cleared by the admin-driven transition'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.pagamentos WHERE empresa_id = 'b1000000-0000-4000-8000-000000000001'),
  0::bigint,
  'no fictitious pagamentos charge was created for the admin-assigned plan'
);

-- ----------------------------------------------------------------------------
-- 5. A pending charge left by the outgoing plan is cancelled when the
--    master switches the company to the trial plan, and the trial
--    transition keeps plano_id NULL per the canonical access-control model.
-- ----------------------------------------------------------------------------
INSERT INTO public.pagamentos (id, empresa_id, plano_id, valor, status)
VALUES (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  100,
  'pendente'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL
  )$test$,
  'a master_admin can switch the company to the canonical trial plan'
);

RESET ROLE;

SELECT is(
  (SELECT plano_id FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  NULL::uuid,
  'trial companies carry plano_id = NULL, per the canonical access-control model'
);

SELECT is(
  (SELECT status_pagamento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  NULL::text,
  'trial companies have no status_pagamento'
);

SELECT ok(
  (SELECT trial_expires_at FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001') > now(),
  'trial_expires_at was set in the future'
);

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  (SELECT trial_expires_at FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'vencimento mirrors trial_expires_at for display purposes'
);

SELECT is(
  (SELECT status FROM public.pagamentos WHERE id = 'b3000000-0000-4000-8000-000000000001'),
  'cancelado',
  'the pending charge left by the outgoing paid plan was cancelled by the transition'
);

-- ----------------------------------------------------------------------------
-- 6. Switching to Vitalícia delegates to set_company_lifetime_subscription
--    and applies the master's chosen status atomically - including
--    "inativo", which the pre-fix creation flow silently discarded.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    (SELECT id FROM public.planos WHERE periodicidade = 'vitalicio'),
    'inativo',
    NULL
  )$test$,
  'a master_admin can grant Vitalícia through the canonical wrapper'
);

RESET ROLE;

SELECT is(
  (SELECT status FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'inativo',
  'Vitalícia granted as inativo keeps that exact status instead of forcing ativo'
);

SELECT is(
  (SELECT status_pagamento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'isento',
  'Vitalícia companies are marked isento'
);

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  NULL::timestamptz,
  'Vitalícia companies have no vencimento'
);

SELECT is(
  (SELECT trial_expires_at FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  NULL::timestamptz,
  'Vitalícia companies have no trial_expires_at'
);

SELECT is(
  (SELECT plano_id FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  (SELECT id FROM public.planos WHERE periodicidade = 'vitalicio'),
  'the company is now assigned to the canonical lifetime plan'
);

-- ----------------------------------------------------------------------------
-- 7. Re-invoking the wrapper for the same Vitalícia company with a
--    different status still only touches status (idempotent grant).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    (SELECT id FROM public.planos WHERE periodicidade = 'vitalicio'),
    'ativo',
    NULL
  )$test$,
  'the Vitalícia status can be flipped back to ativo through the wrapper'
);

RESET ROLE;

SELECT is(
  (SELECT status FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000001'),
  'ativo',
  'the status change was applied atomically without disturbing the lifetime grant'
);

-- ----------------------------------------------------------------------------
-- 8. Exact repeat of the same Vitalícia assignment (identical status) is a
--    true no-op per set_company_lifetime_subscription's own idempotency.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000001',
    (SELECT id FROM public.planos WHERE periodicidade = 'vitalicio'),
    'ativo',
    NULL
  ) ->> 'alterado')::boolean,
  false,
  'repeating the exact same Vitalícia assignment reports alterado = false'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 9. Exact repeat of the same paid assignment (identical explicit due date)
--    yields an identical vencimento/status_pagamento, not a fresh 30/365-day
--    calculation from clock_timestamp().
-- ----------------------------------------------------------------------------
INSERT INTO public.empresas (
  id, nome_empresa, status, plano, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES (
  'b1000000-0000-4000-8000-000000000003', '__master_plan_rpc_test_company_3__',
  'ativo', 'basico', NULL, false, true, 'pendente', NULL, NULL
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',
    'ativo',
    '2028-06-01T00:00:00Z'
  )$test$,
  'assigning a paid plan the first time'
);

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',
    'ativo',
    '2028-06-01T00:00:00Z'
  )$test$,
  'repeating the exact same paid assignment'
);

RESET ROLE;

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000003'),
  '2028-06-01T00:00:00Z'::timestamptz,
  'repeating the same explicit paid assignment yields the identical vencimento'
);

SELECT is(
  (SELECT status_pagamento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000003'),
  'pago',
  'repeating the same explicit paid assignment stays pago'
);

-- ----------------------------------------------------------------------------
-- 10. A pending charge that is already live at the provider (has a real
--     asaas_payment_id) blocks the transition entirely - for both base-plan
--     and module charges - instead of only cancelling local bookkeeping and
--     leaving the provider charge payable, which would let a later webhook
--     silently overwrite whatever plan the master just assigned.
-- ----------------------------------------------------------------------------
INSERT INTO public.empresas (
  id, nome_empresa, status, plano, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES (
  'b1000000-0000-4000-8000-000000000002', '__master_plan_rpc_test_company_2__',
  'ativo', 'basico', 'b0000000-0000-4000-8000-000000000001', false, false, 'pago',
  now() + interval '30 days', NULL
);

INSERT INTO public.asaas_payments (
  id, payment_type, asaas_payment_id, empresa_id, amount, status, related_plano_id
) VALUES (
  'b5000000-0000-4000-8000-000000000001', 'base_plan', 'asaas_live_charge_base_plan',
  'b1000000-0000-4000-8000-000000000002', 100, 'pending',
  'b0000000-0000-4000-8000-000000000001'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000002',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL
  )$test$,
  'P0001',
  'Company has an open provider charge that must be cancelled first',
  'a live provider base-plan charge blocks the transition'
);

RESET ROLE;

UPDATE public.asaas_payments
SET status = 'cancelled'
WHERE id = 'b5000000-0000-4000-8000-000000000001';

INSERT INTO public.asaas_payments (
  id, payment_type, asaas_payment_id, empresa_id, amount, status
) VALUES (
  'b5000000-0000-4000-8000-000000000002', 'modules', 'asaas_live_charge_modules',
  'b1000000-0000-4000-8000-000000000002', 50, 'overdue'
);

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000002',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL
  )$test$,
  'P0001',
  'Company has an open provider charge that must be cancelled first',
  'a live provider module charge also blocks the transition'
);

RESET ROLE;

UPDATE public.asaas_payments
SET status = 'cancelled'
WHERE id = 'b5000000-0000-4000-8000-000000000002';

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000002',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL
  )$test$,
  'the transition proceeds once no live provider charge remains'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 11. Re-invoking the exact same trial assignment on a company already on it
--     is idempotent: trial_expires_at (and vencimento, its mirror) must not
--     be pushed further out. This matters because Empresas.tsx now calls
--     this RPC on every "editar empresa" save while the trial plan is
--     selected, even when the master didn't intend to renew the trial.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE tmp_trial_idempotency AS
SELECT trial_expires_at AS before_value
FROM public.empresas
WHERE id = 'b1000000-0000-4000-8000-000000000002';

SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000002',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL
  )$test$,
  'the same trial assignment can be re-invoked on a company already on it'
);

RESET ROLE;

SELECT is(
  (SELECT trial_expires_at FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000002'),
  (SELECT before_value FROM tmp_trial_idempotency),
  'repeating the same trial assignment does not push trial_expires_at further out'
);

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000002'),
  (SELECT before_value FROM tmp_trial_idempotency),
  'vencimento mirror stays in sync with the unchanged trial_expires_at'
);

-- ----------------------------------------------------------------------------
-- 12. Passing _renew_trial explicitly does grant a fresh trial_days window,
--     so a genuine renewal is still possible - only the default repeat
--     behaviour changed.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_company_plan(
    'b1000000-0000-4000-8000-000000000002',
    (SELECT id FROM public.planos WHERE periodicidade = 'trial'),
    'ativo',
    NULL,
    true
  )$test$,
  'an explicit _renew_trial grants a fresh trial window'
);

RESET ROLE;

SELECT ok(
  (SELECT trial_expires_at FROM public.empresas WHERE id = 'b1000000-0000-4000-8000-000000000002')
    > (SELECT before_value FROM tmp_trial_idempotency),
  '_renew_trial pushes trial_expires_at forward from the original grant'
);

SELECT * FROM finish();

ROLLBACK;
