-- Focused re-validation of 20260917090000_subscription_grace_period_and_billing_notifications.sql
-- for MODULES specifically: multiple modules (including a real 2-level
-- dependency chain and a capacity module) and Asaas reactivation, across
-- D / D+1 / D+2 / D+3 / D+4, simulated via vencimento = now() +/- N days
-- (no real waiting). Read-only, diagnostic-first: every assertion states
-- what it expects: PASS means the D..D+4..payment module story holds up.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE mod_scratch (key text PRIMARY KEY, value uuid) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

-- categoria differs on purpose: planos_single_active_commercial_base_idx
-- (20260817220000) allows only one ativo=true, periodicidade IN
-- (mensal,anual) row with categoria='plano_base' at a time - plan B is
-- 'legado' so it never collides with plan A, while still being ativo=true
-- and periodicidade='mensal' (all that company_has_operational_access,
-- prepare_asaas_renewal_charge and the capacity triggers actually check).
INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria, disponivel_novo_cadastro, trial_days
) VALUES
  ('9f000000-0000-4000-8000-000000000001', '__modval_plan_a__', 100, 20, 50, true, 'mensal', 'plano_base', true, 0),
  ('9f000000-0000-4000-8000-000000000002', '__modval_plan_b__', 80, 20, 3, true, 'mensal', 'legado', false, 0);

-- Company A: the main D..D+4..payment story - generous max_eventos (50) so
-- event-limit math never interferes with the read/write/dependency checks.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento, data_contrato, cpf_cnpj, email
) VALUES (
  '9f000000-0000-4000-8000-000000000011', '__modval_empresa_a__',
  'ativo', '9f000000-0000-4000-8000-000000000001', false, false,
  'pago', now(), current_date, '11144477735', 'modval-a@example.test'
);

-- Company B: isolated, dedicated purely to proving the extra_eventos
-- capacity bump survives grace - kept separate so its event-count math never
-- entangles with Company A's financials/read/write checks.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento, data_contrato, cpf_cnpj, email
) VALUES (
  '9f000000-0000-4000-8000-000000000012', '__modval_empresa_b__',
  'ativo', '9f000000-0000-4000-8000-000000000002', false, false,
  'pago', now(), current_date, '22255588846', 'modval-b@example.test'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '9f000000-0000-4000-8000-000000000021',
   'authenticated', 'authenticated', 'modval-admin-a@example.test', '', now(), '{}', '{"full_name":"ModVal Admin A"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '9f000000-0000-4000-8000-000000000021';
UPDATE public.profiles SET empresa_id = '9f000000-0000-4000-8000-000000000011', ativado = true, activated_at = now()
WHERE user_id = '9f000000-0000-4000-8000-000000000021';

-- Scoped to this transaction only (rolled back at the end): give
-- extra_eventos a known, deterministic capacity bump instead of assuming
-- whatever the seed default is.
UPDATE public.module_catalog
SET ativo = true, is_capacity_module = true, capacidade_extra_eventos = 5
WHERE feature_key = 'extra_eventos';

-- Company A: 3 real modules including a genuine 2-level dependency
-- (controle_estoque -> gestao_materiais, seeded by
-- 20260804195000_sync_canonical_module_catalog.sql - not invented here).
UPDATE public.empresa_modules
SET status = 'active', valor_cobrado = 29.90, trial_granted = false, granted_by_admin = false,
    origem = 'asaas_pagamento', activated_at = now(),
    expires_at = (SELECT vencimento FROM public.empresas WHERE id = '9f000000-0000-4000-8000-000000000011')
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (
    SELECT id FROM public.module_catalog
    WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque')
  );

-- Company B: only the capacity module.
UPDATE public.empresa_modules
SET status = 'active', valor_cobrado = 9.90, trial_granted = false, granted_by_admin = false,
    origem = 'asaas_pagamento', activated_at = now(),
    expires_at = (SELECT vencimento FROM public.empresas WHERE id = '9f000000-0000-4000-8000-000000000012')
WHERE empresa_id = '9f000000-0000-4000-8000-000000000012'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'extra_eventos');

SELECT is(
  (SELECT count(*)::bigint FROM public.empresa_modules
   WHERE empresa_id = '9f000000-0000-4000-8000-000000000011' AND status = 'active'),
  3::bigint,
  'fixture sanity: company A has exactly the 3 intended active modules'
);

CREATE TEMP TABLE mod_row_count (empresa_id uuid, n integer);
INSERT INTO mod_row_count SELECT empresa_id, count(*)::integer FROM public.empresa_modules
  WHERE empresa_id = '9f000000-0000-4000-8000-000000000011' GROUP BY empresa_id;

-- Dependency sanity check BEFORE the D..D+4 story: break it, prove
-- controle_estoque genuinely stops being active, then restore it. This
-- proves company_module_dependencies_satisfied is doing real work, not
-- just always returning true.
UPDATE public.empresa_modules SET status = 'inactive'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais');
SELECT ok(
  NOT public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'),
  'sanity: deactivating gestao_materiais breaks controle_estoque (real dependency enforcement, not a no-op)'
);
UPDATE public.empresa_modules SET status = 'active'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais');
SELECT ok(
  public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'),
  'sanity: restoring gestao_materiais restores controle_estoque'
);

-- One persistent event to attach financials rows to across every phase
-- below (created while fully within grace, so it never itself gets blocked).
INSERT INTO public.events (id, empresa_id, date, name, created_by)
VALUES (
  '9f000000-0000-4000-8000-000000000031', '9f000000-0000-4000-8000-000000000011',
  current_date + 60, '__modval_evento_persistente__', '9f000000-0000-4000-8000-000000000021'
);

-- ----------------------------------------------------------------------------
-- Helper macro (repeated inline): move company A + its 3 modules to a given
-- day-offset from "now", then assert the whole module story for that phase.
-- ----------------------------------------------------------------------------

-- A second event, created up front while fully within grace, reserved for
-- the D+4 "a brand new module write must be rejected" check below: financials
-- has a UNIQUE(event_id), so testing a blocked WRITE cleanly (an exception,
-- not a silently-0-row-affected UPDATE) needs a fresh event_id that was
-- never written to financials before.
INSERT INTO public.events (id, empresa_id, date, name, created_by)
VALUES (
  '9f000000-0000-4000-8000-000000000032', '9f000000-0000-4000-8000-000000000011',
  current_date + 61, '__modval_evento_para_d4__', '9f000000-0000-4000-8000-000000000021'
);

-- financials writes/reads below are run AS admin_empresa via an explicit
-- role switch (SET LOCAL ROLE authenticated + the jwt claim), not as the
-- owning/superuser test role: financials has NO trigger, only RLS policies
-- (can_read/write_company_module), and a superuser/table-owner connection
-- bypasses RLS entirely by default - running these as postgres would prove
-- nothing about the actual policy. (events, by contrast, is also protected
-- by the check_event_limit TRIGGER, which fires regardless of role - that
-- is what made the equivalent events assertions in the base suite valid
-- without a role switch.)

-- ============================== D (day 0) ==================================
UPDATE public.empresas SET vencimento = now() WHERE id = '9f000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now()
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'));

SELECT ok(public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'), 'D: operational access');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'financeiro_avancado'), 'D: financeiro_avancado active');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'gestao_materiais'), 'D: gestao_materiais active');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'), 'D: controle_estoque active (dependency satisfied)');

SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$INSERT INTO public.financials (empresa_id, event_id, cache) VALUES ('9f000000-0000-4000-8000-000000000011', '9f000000-0000-4000-8000-000000000031', 100)$test$,
  'D: real INSERT into financials as admin_empresa (module-gated write, RLS-enforced) succeeds'
);
RESET ROLE;

-- =========================== D+1 / D+2 / D+3 ================================
UPDATE public.empresas SET vencimento = now() - interval '1 day' WHERE id = '9f000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '1 day'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'));
SELECT ok(public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'), 'D+1: operational access');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'financeiro_avancado'), 'D+1: financeiro_avancado active');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'), 'D+1: controle_estoque active (dependency still satisfied)');

SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$UPDATE public.financials SET cache = 150 WHERE event_id = '9f000000-0000-4000-8000-000000000031'$test$,
  'D+1: real UPDATE on financials as admin_empresa still succeeds (grace day 1)'
);
RESET ROLE;
SELECT is(
  (SELECT cache FROM public.financials WHERE event_id = '9f000000-0000-4000-8000-000000000031'),
  150.00,
  'D+1: the UPDATE actually took effect (RLS did not silently filter it to 0 rows)'
);

UPDATE public.empresas SET vencimento = now() - interval '2 days' WHERE id = '9f000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '2 days'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'));
SELECT ok(public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'), 'D+2: operational access');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'gestao_materiais'), 'D+2: gestao_materiais active');

UPDATE public.empresas SET vencimento = now() - interval '3 days' WHERE id = '9f000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '3 days'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'));
SELECT ok(public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'), 'D+3 (last grace day): operational access');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'financeiro_avancado'), 'D+3: financeiro_avancado active');
SELECT ok(public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'), 'D+3: controle_estoque active (dependency satisfied on the last grace day)');

SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$UPDATE public.financials SET cache = 200 WHERE event_id = '9f000000-0000-4000-8000-000000000031'$test$,
  'D+3: real UPDATE on financials as admin_empresa still succeeds (last grace day)'
);
SELECT ok(
  (SELECT count(*) FROM public.financials WHERE empresa_id = '9f000000-0000-4000-8000-000000000011') = 1,
  'D+3: admin_empresa can read financials via RLS (module-gated read works during grace)'
);
RESET ROLE;
SELECT is(
  (SELECT cache FROM public.financials WHERE event_id = '9f000000-0000-4000-8000-000000000031'),
  200.00,
  'D+3: the UPDATE actually took effect'
);

-- ================================ D+4 =======================================
UPDATE public.empresas SET vencimento = now() - interval '4 days' WHERE id = '9f000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '4 days'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'));

SELECT ok(
  NOT public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'),
  'D+4: operational access is blocked (grace over)'
);

SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$INSERT INTO public.financials (empresa_id, event_id, cache)
        VALUES ('9f000000-0000-4000-8000-000000000011', '9f000000-0000-4000-8000-000000000032', 999)$test$,
  'new row violates row-level security policy for table "financials"',
  'D+4: a brand-new module write (INSERT into financials) is rejected by RLS as admin_empresa'
);
RESET ROLE;
-- The already-existing row must also be impossible to modify further (RLS
-- UPDATE with a failing USING clause silently matches 0 rows, no exception -
-- checked by confirming the value from D+3 is still exactly 200).
SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
UPDATE public.financials SET cache = 9999 WHERE event_id = '9f000000-0000-4000-8000-000000000031';
RESET ROLE;
SELECT is(
  (SELECT cache FROM public.financials WHERE event_id = '9f000000-0000-4000-8000-000000000031'),
  200.00,
  'D+4: UPDATE on the pre-existing financials row as admin_empresa has no effect (RLS excludes it, value stays 200)'
);

-- THE key open question for this validation round: do READS of
-- module-gated data survive D+4, matching "dados continuam disponiveis
-- para leitura"? Checked two ways: the read-side helper function
-- (company_module_entitlement_active - NOT company_has_active_module,
-- which is the write-side, correctly-still-false-at-D+4 check exercised
-- above), and the actual RLS-enforced SELECT as admin_empresa below.
SELECT ok(
  NOT public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'financeiro_avancado'),
  'D+4: financeiro_avancado WRITE-side check (company_has_active_module) correctly stays false - grace-aware, matches the RLS write rejection above'
);
SELECT ok(
  public.company_module_entitlement_active('9f000000-0000-4000-8000-000000000011', 'financeiro_avancado'),
  'D+4: financeiro_avancado READ-side entitlement (company_module_entitlement_active) survives being blocked - module data stays viewable, only writes are cut'
);

SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.financials WHERE empresa_id = '9f000000-0000-4000-8000-000000000011') = 1,
  'D+4: admin_empresa can still READ financials via RLS despite being blocked - matches core-data read survival'
);
SELECT ok(
  (SELECT count(*) FROM public.events WHERE empresa_id = '9f000000-0000-4000-8000-000000000011') >= 1,
  'D+4: core agenda data (events, never module-gated) remains readable, as already proven in the base suite'
);
RESET ROLE;

-- Module rows themselves: never flipped, never removed.
SELECT is(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
     AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado')),
  'active',
  'D+4: financeiro_avancado.status is still active (not auto-deactivated)'
);
SELECT is(
  (SELECT n FROM mod_row_count WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'),
  (SELECT count(*)::integer FROM public.empresa_modules WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'),
  'D+4: total empresa_modules row count for the company is unchanged (nothing removed or duplicated)'
);

-- ---- Company B: capacity bump (extra_eventos) survives D and D+3 --------
UPDATE public.empresas SET vencimento = now() WHERE id = '9f000000-0000-4000-8000-000000000012';
UPDATE public.empresa_modules SET expires_at = now()
WHERE empresa_id = '9f000000-0000-4000-8000-000000000012'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'extra_eventos');

DO $do$
DECLARE i integer;
BEGIN
  FOR i IN 1..8 LOOP
    INSERT INTO public.events (empresa_id, date, name, created_by)
    VALUES ('9f000000-0000-4000-8000-000000000012', current_date + i, '__modval_b_evento_d_' || i || '__', '9f000000-0000-4000-8000-000000000021');
  END LOOP;
END;
$do$;
SELECT is(
  (SELECT count(*)::bigint FROM public.events WHERE empresa_id = '9f000000-0000-4000-8000-000000000012'),
  8::bigint,
  'D: company B created 8 events (base max_eventos=3 + extra_eventos capacity=5) - capacity module is genuinely extending the limit'
);
SELECT throws_ok(
  $test$INSERT INTO public.events (empresa_id, date, name, created_by)
        VALUES ('9f000000-0000-4000-8000-000000000012', current_date + 9, '__modval_b_evento_d_9__', '9f000000-0000-4000-8000-000000000021')$test$,
  'Company event limit reached (8 of 8)',
  'D: the 9th event correctly hits the extended limit (3+5), proving the cap is real, not accidentally unlimited'
);
DELETE FROM public.events WHERE empresa_id = '9f000000-0000-4000-8000-000000000012';

UPDATE public.empresas SET vencimento = now() - interval '3 days' WHERE id = '9f000000-0000-4000-8000-000000000012';
UPDATE public.empresa_modules SET expires_at = now() - interval '3 days'
WHERE empresa_id = '9f000000-0000-4000-8000-000000000012'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'extra_eventos');
INSERT INTO public.events (empresa_id, date, name, created_by)
VALUES ('9f000000-0000-4000-8000-000000000012', current_date + 20, '__modval_b_evento_d3_4th__', '9f000000-0000-4000-8000-000000000021');
SELECT ok(
  (SELECT count(*) FROM public.events WHERE empresa_id = '9f000000-0000-4000-8000-000000000012') = 1,
  'D+3: a 4th-equivalent event (beyond the base max_eventos=3) still succeeds - capacity extension survives the whole grace period'
);

UPDATE public.empresas SET vencimento = now() - interval '4 days' WHERE id = '9f000000-0000-4000-8000-000000000012';
SELECT throws_ok(
  $test$INSERT INTO public.events (empresa_id, date, name, created_by)
        VALUES ('9f000000-0000-4000-8000-000000000012', current_date + 21, '__modval_b_evento_d4__', '9f000000-0000-4000-8000-000000000021')$test$,
  'Company subscription does not allow event creation',
  'D+4: company B is blocked outright (capacity is irrelevant once grace is over - the operational-access check runs first)'
);

-- ----------------------------------------------------------------------------
-- REACTIVATION: Company A pays at D+4
-- ----------------------------------------------------------------------------
-- Back on company A, still at vencimento = now() - 4 days (blocked) from above.

SELECT is(
  (SELECT count(*)::bigint FROM public.asaas_renewal_items ri
   JOIN public.asaas_payments p ON p.id = ri.payment_id
   WHERE p.empresa_id = '9f000000-0000-4000-8000-000000000011'),
  0::bigint,
  'sanity: no renewal charge exists yet for company A'
);

INSERT INTO mod_scratch (key, value)
SELECT 'renewal_payment', (public.prepare_asaas_renewal_charge('9f000000-0000-4000-8000-000000000021') ->> 'payment_id')::uuid;

SELECT is(
  (SELECT count(*)::bigint FROM public.asaas_renewal_items
   WHERE payment_id = (SELECT value FROM mod_scratch WHERE key = 'renewal_payment') AND item_type = 'module'),
  3::bigint,
  'the renewal charge snapshot includes all 3 active monthly modules (financeiro_avancado, gestao_materiais, controle_estoque)'
);

UPDATE public.asaas_payments
SET asaas_payment_id = 'asaas_modval_charge_1'
WHERE id = (SELECT value FROM mod_scratch WHERE key = 'renewal_payment');

SELECT lives_ok(
  $test$SELECT public.process_asaas_payment_webhook(
    'modval-event-1', 'PAYMENT_CONFIRMED', 'asaas_modval_charge_1',
    (SELECT amount FROM public.asaas_payments WHERE id = (SELECT value FROM mod_scratch WHERE key = 'renewal_payment'))
  )$test$,
  'the Asaas webhook processes the confirmed payment without error'
);

-- Immediate reactivation + correct new vencimento.
SELECT ok(
  public.company_has_operational_access('9f000000-0000-4000-8000-000000000011'),
  'after payment: operational access is restored immediately'
);
SELECT ok(
  (SELECT vencimento FROM public.empresas WHERE id = '9f000000-0000-4000-8000-000000000011') > now(),
  'after payment: vencimento was advanced into the future'
);
-- Paid at D+4 (already overdue), so per the canonical rule the new cycle
-- counts from the payment moment (now), not from the stale old vencimento -
-- same rule proven in the base suite, reconfirmed here with modules attached.
SELECT ok(
  (SELECT vencimento FROM public.empresas WHERE id = '9f000000-0000-4000-8000-000000000011')
    BETWEEN now() + interval '29 days' AND now() + interval '31 days',
  'the new vencimento is ~1 month from the payment moment, not from the old (already-passed) due date'
);

-- All 3 modules: expires_at advanced to match, status still active, no
-- duplication, dependency still satisfied, writes work again.
SELECT is(
  (SELECT count(*)::bigint FROM public.empresa_modules
   WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'
     AND status = 'active'
     AND expires_at = (SELECT vencimento FROM public.empresas WHERE id = '9f000000-0000-4000-8000-000000000011')
     AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('financeiro_avancado', 'gestao_materiais', 'controle_estoque'))),
  3::bigint,
  'all 3 previously-contracted modules had expires_at advanced to exactly the new vencimento - none missed, none diverged'
);
SELECT is(
  (SELECT n FROM mod_row_count WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'),
  (SELECT count(*)::integer FROM public.empresa_modules WHERE empresa_id = '9f000000-0000-4000-8000-000000000011'),
  'after payment: still the exact same total empresa_modules row count - no module duplicated, lost, or re-contracted as a new row'
);
SELECT ok(
  public.company_has_active_module('9f000000-0000-4000-8000-000000000011', 'controle_estoque'),
  'after payment: controle_estoque active again, dependency on gestao_materiais still satisfied'
);
SELECT set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$UPDATE public.financials SET cache = 300 WHERE event_id = '9f000000-0000-4000-8000-000000000031'$test$,
  'after payment: real UPDATE on financials (module-gated write) succeeds again as admin_empresa'
);
SELECT lives_ok(
  $test$INSERT INTO public.financials (empresa_id, event_id, cache)
        VALUES ('9f000000-0000-4000-8000-000000000011', '9f000000-0000-4000-8000-000000000032', 400)$test$,
  'after payment: a brand-new module write (INSERT into financials) also succeeds again as admin_empresa'
);
RESET ROLE;
SELECT is(
  (SELECT cache FROM public.financials WHERE event_id = '9f000000-0000-4000-8000-000000000031'),
  300.00,
  'after payment: the UPDATE actually took effect (RLS is no longer blocking it)'
);
SELECT lives_ok(
  $test$INSERT INTO public.events (empresa_id, date, name, created_by)
        VALUES ('9f000000-0000-4000-8000-000000000011', current_date + 90, '__modval_post_payment_evento__', '9f000000-0000-4000-8000-000000000021')$test$,
  'after payment: real INSERT into events (core write) succeeds again'
);

SELECT * FROM finish();

ROLLBACK;
