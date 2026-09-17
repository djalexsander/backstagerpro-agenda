-- Regression test for 20260917090000_subscription_grace_period_and_billing_notifications.sql.
--
-- Simulates the full D / D+1 / D+2 / D+3 / D+4 timeline WITHOUT waiting for
-- real time to pass: vencimento is set to now() - interval 'N days' (now()
-- is frozen for the whole test transaction), so every phase below is a
-- direct, deterministic snapshot of "N days after the due date" rather than
-- a real wait. Re-running this file at any future date reproduces the exact
-- same results.
--
-- Covers:
--   1. company_has_operational_access() grace boundary (D..D+3 = access,
--      D+4 = blocked), including a real INSERT INTO events end-to-end.
--   2. company_has_active_module() honors the same grace period for a paid
--      module whose expires_at mirrors vencimento (consistency requirement).
--   3. scan_subscription_billing_notifications() classifies each phase
--      correctly and only admin_empresa (not usuario) ends up with a
--      notificacoes_destinatarios row / sees it via listar_minhas_notificacoes.
--   4. prepare_asaas_renewal_charge still works at D+4 (grace over, company
--      in read-only mode) - proves admin_empresa is never locked out of
--      paying, per the "no accidental lockout" requirement.
--   5. process_asaas_payment_webhook reactivates access, advances vencimento,
--      and fires the new "pagamento confirmado" notification.
--   6. empresa_modules.status is never touched by any of the above - module
--      entitlements are preserved end to end.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE grace_scratch (key text PRIMARY KEY, value uuid) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria, disponivel_novo_cadastro, trial_days
) VALUES (
  '9e000000-0000-4000-8000-000000000001', '__grace_period_test_plan__',
  100, 20, 100, true, 'mensal', 'plano_base', true, 0
);

-- D (vencimento = now(), i.e. "due today, not yet elapsed") is the starting
-- phase; later sections move vencimento backward to simulate D+1..D+4.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento, data_contrato, cpf_cnpj, email
) VALUES (
  '9e000000-0000-4000-8000-000000000011', '__grace_period_test_empresa__',
  'ativo', '9e000000-0000-4000-8000-000000000001', false, false,
  'pago', now(), current_date, '11144477735', 'grace-empresa@example.test'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000021',
   'authenticated', 'authenticated', 'grace-admin@example.test', '', now(), '{}', '{"full_name":"Grace Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000022',
   'authenticated', 'authenticated', 'grace-usuario@example.test', '', now(), '{}', '{"full_name":"Grace Usuario"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '9e000000-0000-4000-8000-000000000021';
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id = '9e000000-0000-4000-8000-000000000022';

UPDATE public.profiles SET empresa_id = '9e000000-0000-4000-8000-000000000011', ativado = true, activated_at = now()
WHERE user_id IN ('9e000000-0000-4000-8000-000000000021', '9e000000-0000-4000-8000-000000000022');

-- A paid, Asaas-purchased-style module: expires_at mirrors vencimento, the
-- same shape process_asaas_payment_webhook produces. Proves the grace period
-- is consistently applied to module-gated data, not just core agenda data.
UPDATE public.empresa_modules
SET status = 'active',
    valor_cobrado = 49.90,
    trial_granted = false,
    granted_by_admin = false,
    origem = 'asaas_pagamento',
    activated_at = now(),
    expires_at = (SELECT vencimento FROM public.empresas WHERE id = '9e000000-0000-4000-8000-000000000011')
WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');

SELECT ok(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
     AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado')) = 'active',
  'fixture sanity: financeiro_avancado is active for the test company before any phase runs'
);

-- ----------------------------------------------------------------------------
-- 1. GRACE CONSTANT AND DAY-DIFF HELPER
-- ----------------------------------------------------------------------------

SELECT is(public.subscription_grace_period_days(), 3, 'grace period is 3 days, matching the requested rule');

SELECT is(public.subscription_days_until_due(now(), now()), 0, 'due exactly now => 0 days');
SELECT is(public.subscription_days_until_due(now() - interval '1 day', now()), -1, 'due 1 day ago => -1');
SELECT is(public.subscription_days_until_due(now() - interval '3 days', now()), -3, 'due 3 days ago => -3');
SELECT is(public.subscription_days_until_due(now() - interval '4 days', now()), -4, 'due 4 days ago => -4');
SELECT is(public.subscription_days_until_due(now() + interval '5 days', now()), 5, 'due in 5 days => 5');

-- ----------------------------------------------------------------------------
-- 2. ACCESS GATE ACROSS D / D+1 / D+2 / D+3 / D+4
-- ----------------------------------------------------------------------------
-- Example from the spec: vencimento 17/09/2026 -> carencia 18,19,20/09 ->
-- bloqueio 21/09/2026. Modeled here as day-offsets from "now" so it never
-- depends on the real calendar date.

-- D: due exactly now - still fully normal (0 grace days consumed yet).
UPDATE public.empresas SET vencimento = now() WHERE id = '9e000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now()
  WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
    AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');

SELECT ok(
  public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'),
  'D (vencimento = now): full operational access'
);
SELECT ok(
  public.company_has_active_module('9e000000-0000-4000-8000-000000000011', 'financeiro_avancado'),
  'D: paid module still active'
);

-- D+1, D+2, D+3: the 3 granted grace days - still full access.
UPDATE public.empresas SET vencimento = now() - interval '1 day' WHERE id = '9e000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '1 day'
  WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
    AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');
SELECT ok(public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'), 'D+1 (1 day overdue, grace day 1): full access');
SELECT ok(public.company_has_active_module('9e000000-0000-4000-8000-000000000011', 'financeiro_avancado'), 'D+1: paid module still active during grace');

UPDATE public.empresas SET vencimento = now() - interval '2 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '2 days'
  WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
    AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');
SELECT ok(public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'), 'D+2 (grace day 2): full access');

UPDATE public.empresas SET vencimento = now() - interval '3 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '3 days'
  WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
    AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');
SELECT ok(public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'), 'D+3 (grace day 3, last grace day): full access');
SELECT ok(public.company_has_active_module('9e000000-0000-4000-8000-000000000011', 'financeiro_avancado'), 'D+3: paid module still active on the last grace day');

-- D+4: grace is over - write access is cut, read-only mode begins.
UPDATE public.empresas SET vencimento = now() - interval '4 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
UPDATE public.empresa_modules SET expires_at = now() - interval '4 days'
  WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
    AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado');
SELECT ok(
  NOT public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'),
  'D+4 (grace over): operational access is blocked'
);
SELECT ok(
  NOT public.company_has_active_module('9e000000-0000-4000-8000-000000000011', 'financeiro_avancado'),
  'D+4: paid module expires_at follows the same grace-extended cutoff, also inactive now'
);

-- D+10, well past D+4, stays blocked (no upper bound / auto-unblock).
UPDATE public.empresas SET vencimento = now() - interval '10 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT ok(
  NOT public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'),
  'D+10: still blocked (no automatic unblock without payment)'
);

-- End-to-end proof (real INSERT, not just the helper function) at the two
-- boundary phases: D (works) and D+4 (fails with the trigger's own message).
UPDATE public.empresas SET vencimento = now() WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT lives_ok(
  $test$INSERT INTO public.events (empresa_id, date, name, created_by)
        VALUES ('9e000000-0000-4000-8000-000000000011', current_date + 30, '__grace_evento_dia_d__', '9e000000-0000-4000-8000-000000000021')$test$,
  'D: a real INSERT INTO events succeeds end-to-end (RLS + trigger)'
);

UPDATE public.empresas SET vencimento = now() - interval '4 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT throws_ok(
  $test$INSERT INTO public.events (empresa_id, date, name, created_by)
        VALUES ('9e000000-0000-4000-8000-000000000011', current_date + 31, '__grace_evento_dia_d4__', '9e000000-0000-4000-8000-000000000021')$test$,
  'Company subscription does not allow event creation',
  'D+4: a real INSERT INTO events is rejected end-to-end by check_event_limit()'
);

-- ----------------------------------------------------------------------------
-- 3. NOTIFICATIONS - admin_empresa gets warned, usuario never does
-- ----------------------------------------------------------------------------

-- 3a. "vencendo" (5 days before).
UPDATE public.empresas SET vencimento = now() + interval '5 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT ok(
  EXISTS (SELECT 1 FROM public.scan_subscription_billing_notifications()
          WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_vencendo'),
  'scan classifies 5 days before due as assinatura_vencendo'
);

-- 3b. "vence hoje".
UPDATE public.empresas SET vencimento = now() WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT ok(
  EXISTS (SELECT 1 FROM public.scan_subscription_billing_notifications()
          WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_vence_hoje'),
  'scan classifies day D as assinatura_vence_hoje'
);

-- 3c. "carencia" (D+2, mid-grace).
UPDATE public.empresas SET vencimento = now() - interval '2 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
INSERT INTO grace_scratch (key, value)
SELECT 'carencia_empresa', empresa_id FROM public.scan_subscription_billing_notifications()
WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_carencia';
SELECT ok(
  EXISTS (SELECT 1 FROM grace_scratch WHERE key = 'carencia_empresa'),
  'scan classifies D+2 as assinatura_carencia'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes n
    JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.empresa_id = '9e000000-0000-4000-8000-000000000011'
      AND n.tipo = 'assinatura_carencia'
      AND n.categoria = 'financeiro'
      AND d.user_id = '9e000000-0000-4000-8000-000000000021'
  ),
  'admin_empresa receives the assinatura_carencia notification'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes n
    JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.empresa_id = '9e000000-0000-4000-8000-000000000011'
      AND n.tipo = 'assinatura_carencia'
      AND d.user_id = '9e000000-0000-4000-8000-000000000022'
  ),
  'usuario (funcionario) does NOT receive the assinatura_carencia notification'
);

-- Same day again: dedupe must not create a second notification.
SELECT is(
  (SELECT count(*) FROM public.scan_subscription_billing_notifications()
   WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_carencia'),
  0::bigint,
  'a second scan on the same day is fully deduped (0 new rows returned)'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes
   WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_carencia'),
  1::bigint,
  'exactly 1 notificacoes row exists for assinatura_carencia despite 2 scans same day'
);

-- 3d. "bloqueada" (D+4).
UPDATE public.empresas SET vencimento = now() - interval '4 days' WHERE id = '9e000000-0000-4000-8000-000000000011';
SELECT ok(
  EXISTS (SELECT 1 FROM public.scan_subscription_billing_notifications()
          WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'assinatura_bloqueada'),
  'scan classifies D+4 as assinatura_bloqueada'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes n
    JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.empresa_id = '9e000000-0000-4000-8000-000000000011'
      AND n.tipo = 'assinatura_bloqueada'
      AND d.user_id = '9e000000-0000-4000-8000-000000000021'
  ),
  'admin_empresa receives the assinatura_bloqueada notification'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios d
    JOIN public.notificacoes n ON n.id = d.notificacao_id
    WHERE n.tipo = 'assinatura_bloqueada' AND d.user_id = '9e000000-0000-4000-8000-000000000022'
  ),
  'usuario does not receive the assinatura_bloqueada notification either'
);

-- 3e. Same guarantee through the actual end-user RPC, not just the raw
-- tables: admin sees it via listar_minhas_notificacoes, usuario never does,
-- and usuario cannot query it under any filter.
SELECT set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(false, 100) WHERE tipo = 'assinatura_bloqueada'),
  'admin_empresa sees assinatura_bloqueada via listar_minhas_notificacoes (the bell)'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000022', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(false, 100) WHERE categoria = 'financeiro'),
  'usuario retrieves ZERO categoria=financeiro rows via listar_minhas_notificacoes, no matter the filter'
);
RESET ROLE;

-- 3f. Direct table access is impossible for either role - confirms the
-- protection is backend/RLS, not merely "no row was created for you".
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notificacoes', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.notificacoes_destinatarios', 'SELECT'),
  'neither admin_empresa nor usuario (both map to the authenticated role) can SELECT the notification tables directly - RPC-only, enforced independently of fan-out'
);

-- ----------------------------------------------------------------------------
-- 4. PAYMENT WHILE BLOCKED (D+4) - admin_empresa is never locked out
-- ----------------------------------------------------------------------------
-- Company is still at vencimento = now() - 4 days (blocked) from section 3d.
-- prepare_asaas_renewal_charge takes _actor_id as an explicit argument (it
-- does not read auth.uid()) and is only GRANTed to service_role - called
-- directly here as the owning role, exactly like create-asaas-charge would
-- call it for real via the service-role client, no SET LOCAL ROLE needed.

INSERT INTO grace_scratch (key, value)
SELECT 'renewal_payment', (public.prepare_asaas_renewal_charge('9e000000-0000-4000-8000-000000000021') ->> 'payment_id')::uuid;

SELECT ok(
  EXISTS (SELECT 1 FROM grace_scratch WHERE key = 'renewal_payment' AND value IS NOT NULL),
  'D+4 (blocked, past grace): admin_empresa can still prepare an Asaas renewal charge for the overdue subscription'
);
SELECT is(
  (SELECT status FROM public.asaas_payments WHERE id = (SELECT value FROM grace_scratch WHERE key = 'renewal_payment')),
  'pending',
  'the renewal charge was reserved (status=pending), exactly like when the company is not overdue at all'
);
SELECT ok(
  NOT public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'),
  'preparing the charge does not itself unblock the company - only a confirmed payment does (checked below)'
);

-- Also confirm read access to the overdue charge and the /plano-facing data
-- never depended on operational access in the first place.
SELECT ok(
  has_table_privilege('authenticated', 'public.asaas_payments', 'SELECT'),
  'authenticated keeps table-level SELECT on asaas_payments (tenant-scoped by its own RLS policy, not by subscription state)'
);

-- ----------------------------------------------------------------------------
-- 5. ASAAS WEBHOOK REACTIVATES ACCESS + NOTIFIES ADMIN
-- ----------------------------------------------------------------------------
-- Simulates create-asaas-charge writing back the provider's payment id after
-- creating the PIX charge, then Asaas calling the webhook once the customer
-- pays - exactly the two steps that happen for real outside the database.

UPDATE public.asaas_payments
SET asaas_payment_id = 'asaas_grace_test_charge_1'
WHERE id = (SELECT value FROM grace_scratch WHERE key = 'renewal_payment');

SELECT lives_ok(
  $test$SELECT public.process_asaas_payment_webhook(
    'grace-test-event-1', 'PAYMENT_CONFIRMED', 'asaas_grace_test_charge_1',
    (SELECT amount FROM public.asaas_payments WHERE id = (SELECT value FROM grace_scratch WHERE key = 'renewal_payment'))
  )$test$,
  'the Asaas webhook processes the confirmed renewal payment without error'
);

SELECT ok(
  public.company_has_operational_access('9e000000-0000-4000-8000-000000000011'),
  'after the webhook confirms payment, operational access is restored immediately (no cron, no delay)'
);
SELECT ok(
  (SELECT vencimento FROM public.empresas WHERE id = '9e000000-0000-4000-8000-000000000011') > now(),
  'vencimento was advanced into the future by the confirmed payment'
);
SELECT is(
  (SELECT status_pagamento FROM public.empresas WHERE id = '9e000000-0000-4000-8000-000000000011'),
  'pago',
  'status_pagamento stays pago after reactivation'
);
SELECT is(
  (SELECT plano_bloqueado FROM public.empresas WHERE id = '9e000000-0000-4000-8000-000000000011'),
  false,
  'plano_bloqueado is (still) false after reactivation'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes n
    JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.empresa_id = '9e000000-0000-4000-8000-000000000011'
      AND n.tipo = 'assinatura_pagamento_confirmado'
      AND n.categoria = 'financeiro'
      AND d.user_id = '9e000000-0000-4000-8000-000000000021'
  ),
  'admin_empresa receives the assinatura_pagamento_confirmado notification'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios d
    JOIN public.notificacoes n ON n.id = d.notificacao_id
    WHERE n.tipo = 'assinatura_pagamento_confirmado' AND d.user_id = '9e000000-0000-4000-8000-000000000022'
  ),
  'usuario does not receive the payment-confirmation notification'
);

-- The pre-existing Master-facing channel keeps working unchanged alongside
-- the new admin_empresa-facing one.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes_master
    WHERE empresa_id = '9e000000-0000-4000-8000-000000000011' AND tipo = 'pagamento_confirmado'
  ),
  'the existing Master-facing notificacoes_master insert is untouched by this migration'
);

-- ----------------------------------------------------------------------------
-- 6. MODULE PRESERVATION - status was never flipped by any of the above
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = '9e000000-0000-4000-8000-000000000011'
     AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'financeiro_avancado')),
  'active',
  'financeiro_avancado is still status=active after the full D..D+4..payment cycle - never deactivated by grace, blocking, or reactivation'
);
SELECT ok(
  public.company_has_active_module('9e000000-0000-4000-8000-000000000011', 'financeiro_avancado'),
  'and it is accessible again now that the company is reactivated'
);

SELECT * FROM finish();

ROLLBACK;
