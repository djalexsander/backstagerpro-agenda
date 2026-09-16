-- Regression coverage for 20260915090000_asaas_subscription_renewals.sql.
-- Run with `supabase test db` against a database containing all migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.planos (
  id, nome, valor, periodicidade, categoria, ativo,
  disponivel_novo_cadastro, trial_days
) VALUES (
  'a5100000-0000-4000-8000-000000000001',
  '__asaas_renewal_test_plan__',
  100,
  'mensal',
  'plano_base',
  true,
  true,
  0
);

INSERT INTO public.module_catalog (
  id, nome, feature_key, valor, periodicidade, ativo
) VALUES
  (
    'a5200000-0000-4000-8000-000000000001',
    '__asaas_renewal_monthly_module__',
    '__asaas_renewal_monthly_module__',
    999,
    'mensal',
    true
  ),
  (
    'a5200000-0000-4000-8000-000000000002',
    '__asaas_renewal_annual_module__',
    '__asaas_renewal_annual_module__',
    40,
    'anual',
    true
  ),
  (
    'a5200000-0000-4000-8000-000000000003',
    '__asaas_renewal_trial_module__',
    '__asaas_renewal_trial_module__',
    10,
    'mensal',
    true
  );

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento,
  vencimento, trial_expires_at
) VALUES
  (
    'a5300000-0000-4000-8000-000000000001',
    '__asaas_renewal_company_a__',
    'renewal-company-a@example.test',
    '11222333000181',
    'ativo',
    '__asaas_renewal_test_plan__',
    'a5100000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    clock_timestamp() + interval '10 days',
    NULL
  ),
  (
    'a5300000-0000-4000-8000-000000000002',
    '__asaas_renewal_company_b__',
    'renewal-company-b@example.test',
    '98765432100',
    'ativo',
    '__asaas_renewal_test_plan__',
    'a5100000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    clock_timestamp() - interval '5 days',
    NULL
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'a5400000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated',
    'renewal-admin-a@example.test', '', now(), '{}',
    '{"full_name":"Renewal Admin A"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a5400000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated',
    'renewal-admin-b@example.test', '', now(), '{}',
    '{"full_name":"Renewal Admin B"}', now(), now()
  );

UPDATE public.profiles
SET empresa_id = 'a5300000-0000-4000-8000-000000000001'
WHERE user_id = 'a5400000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET empresa_id = 'a5300000-0000-4000-8000-000000000002'
WHERE user_id = 'a5400000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles
WHERE user_id IN (
  'a5400000-0000-4000-8000-000000000001',
  'a5400000-0000-4000-8000-000000000002'
);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a5400000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('a5400000-0000-4000-8000-000000000002', 'admin_empresa');

INSERT INTO public.empresa_modules (
  id, empresa_id, module_id, status, activated_at, expires_at,
  valor_cobrado, origem, granted_by_admin, trial_granted
) VALUES
  (
    'a5500000-0000-4000-8000-000000000001',
    'a5300000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000001',
    'active', now(), now() + interval '10 days', 20,
    'asaas_pagamento', false, false
  ),
  (
    'a5500000-0000-4000-8000-000000000002',
    'a5300000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000002',
    'active', now(), now() + interval '10 days', 40,
    'asaas_pagamento', false, false
  ),
  (
    'a5500000-0000-4000-8000-000000000003',
    'a5300000-0000-4000-8000-000000000001',
    'a5200000-0000-4000-8000-000000000003',
    'active', now(), now() + interval '10 days', 10,
    'trial', false, true
  ),
  (
    'a5500000-0000-4000-8000-000000000004',
    'a5300000-0000-4000-8000-000000000002',
    'a5200000-0000-4000-8000-000000000001',
    'active', now(), now() - interval '5 days', 30,
    'asaas_pagamento', false, false
  );

CREATE TEMP TABLE renewal_initial_company_state AS
SELECT id, vencimento
FROM public.empresas
WHERE id IN (
  'a5300000-0000-4000-8000-000000000001',
  'a5300000-0000-4000-8000-000000000002'
);

CREATE TEMP TABLE renewal_initial_module_state AS
SELECT id, expires_at
FROM public.empresa_modules
WHERE id IN (
  'a5500000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000003'
);

CREATE TEMP TABLE prepared_renewal_a AS
SELECT public.prepare_asaas_renewal_charge(
  'a5400000-0000-4000-8000-000000000001'::uuid
) AS result;

SELECT is(
  (SELECT (result ->> 'amount')::numeric FROM prepared_renewal_a),
  120::numeric,
  'renewal amount is the current base-plan price plus contracted monthly modules'
);

SELECT is(
  (SELECT (result ->> 'base_plan_amount')::numeric FROM prepared_renewal_a),
  100::numeric,
  'the base-plan component is returned separately'
);

SELECT is(
  (SELECT (result ->> 'modules_amount')::numeric FROM prepared_renewal_a),
  20::numeric,
  'annual and trial-granted modules are excluded from the monthly amount'
);

SELECT is(
  (SELECT (result ->> 'module_count')::integer FROM prepared_renewal_a),
  1,
  'only the active non-trial monthly module is snapshotted'
);

SELECT is(
  (SELECT (result ->> 'renewal_competence')::date FROM prepared_renewal_a),
  (
    SELECT (vencimento AT TIME ZONE 'America/Sao_Paulo')::date
    FROM renewal_initial_company_state
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'competence is anchored to the due date being renewed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.asaas_renewal_items
    WHERE payment_id = (
      SELECT (result ->> 'payment_id')::uuid FROM prepared_renewal_a
    )
  ),
  2,
  'the immutable composition contains one plan and one monthly module item'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  (
    SELECT vencimento
    FROM renewal_initial_company_state
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'preparing a charge does not renew the company before a webhook confirmation'
);

SELECT throws_ok(
  $$ SELECT public.prepare_asaas_renewal_charge('a5400000-0000-4000-8000-000000000001'::uuid) $$,
  'P0001',
  'An active renewal charge already exists for this competence',
  'a second charge for the same company competence is rejected'
);

CREATE TEMP TABLE prepared_renewal_b AS
SELECT public.prepare_asaas_renewal_charge(
  'a5400000-0000-4000-8000-000000000002'::uuid
) AS result;

SELECT is(
  (SELECT (result ->> 'amount')::numeric FROM prepared_renewal_b),
  130::numeric,
  'another company receives its own independently composed amount'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.asaas_renewal_items AS items
    JOIN public.asaas_payments AS payments ON payments.id = items.payment_id
    JOIN public.empresa_modules AS company_modules
      ON company_modules.id = items.related_empresa_module_id
    WHERE payments.id = (
      SELECT (result ->> 'payment_id')::uuid FROM prepared_renewal_a
    )
      AND items.item_type = 'module'
      AND company_modules.empresa_id <> payments.empresa_id
  ),
  0,
  'renewal module snapshots cannot leak through the company-scoped preparation query'
);

SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.asaas_renewal_items (
        payment_id, item_type, related_empresa_module_id, related_module_id, amount
      ) VALUES (
        %L::uuid, 'module',
        'a5500000-0000-4000-8000-000000000004'::uuid,
        'a5200000-0000-4000-8000-000000000001'::uuid,
        30
      )
    $sql$,
    (SELECT result ->> 'payment_id' FROM prepared_renewal_a)
  ),
  'P0001',
  'Renewal module item does not belong to the paying company',
  'the database rejects a cross-company module snapshot even for a service-side write'
);

UPDATE public.asaas_payments
SET asaas_payment_id = 'pay_renewal_company_a_1'
WHERE id = (
  SELECT (result ->> 'payment_id')::uuid FROM prepared_renewal_a
);

UPDATE public.asaas_payments
SET asaas_payment_id = 'pay_renewal_company_b_1'
WHERE id = (
  SELECT (result ->> 'payment_id')::uuid FROM prepared_renewal_b
);

CREATE TEMP TABLE webhook_a_confirmed AS
SELECT public.process_asaas_payment_webhook(
  'evt_renewal_company_a_confirmed',
  'PAYMENT_CONFIRMED',
  'pay_renewal_company_a_1',
  120,
  'backstage_pro:' || (
    SELECT result ->> 'payment_id' FROM prepared_renewal_a
  ),
  clock_timestamp()
) AS result;

SELECT is(
  (SELECT result ->> 'action' FROM webhook_a_confirmed),
  'activated',
  'the first confirmation activates the renewal through the webhook'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  (
    SELECT vencimento + interval '30 days'
    FROM renewal_initial_company_state
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'an early payment extends from the still-future current due date'
);

SELECT is(
  (
    SELECT billing_cycle_started_at
    FROM public.asaas_payments
    WHERE asaas_payment_id = 'pay_renewal_company_a_1'
  ),
  (
    SELECT vencimento
    FROM renewal_initial_company_state
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'the stored early-payment cycle starts at the previous due date'
);

SELECT is(
  (
    SELECT expires_at
    FROM public.empresa_modules
    WHERE id = 'a5500000-0000-4000-8000-000000000001'
  ),
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'the paid monthly module is extended to the renewed company expiration'
);

SELECT is(
  (
    SELECT expires_at
    FROM public.empresa_modules
    WHERE id = 'a5500000-0000-4000-8000-000000000002'
  ),
  (
    SELECT expires_at
    FROM renewal_initial_module_state
    WHERE id = 'a5500000-0000-4000-8000-000000000002'
  ),
  'an annual module excluded from the charge is not extended'
);

SELECT is(
  (
    SELECT expires_at
    FROM public.empresa_modules
    WHERE id = 'a5500000-0000-4000-8000-000000000003'
  ),
  (
    SELECT expires_at
    FROM renewal_initial_module_state
    WHERE id = 'a5500000-0000-4000-8000-000000000003'
  ),
  'a trial-granted module excluded from the charge is not extended'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000002'
  ),
  (
    SELECT vencimento
    FROM renewal_initial_company_state
    WHERE id = 'a5300000-0000-4000-8000-000000000002'
  ),
  'confirming company A does not alter company B'
);

CREATE TEMP TABLE company_a_after_first_webhook AS
SELECT vencimento
FROM public.empresas
WHERE id = 'a5300000-0000-4000-8000-000000000001';

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_renewal_company_a_confirmed',
    'PAYMENT_CONFIRMED',
    'pay_renewal_company_a_1',
    120,
    NULL,
    clock_timestamp()
  ) ->> 'action',
  'already_processed',
  'repeating the same webhook event is idempotent'
);

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_renewal_company_a_received',
    'PAYMENT_RECEIVED',
    'pay_renewal_company_a_1',
    120,
    NULL,
    clock_timestamp()
  ) ->> 'action',
  'status_updated',
  'a later RECEIVED event updates status without applying renewal again'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  (SELECT vencimento FROM company_a_after_first_webhook),
  'CONFIRMED plus RECEIVED extends the company exactly once'
);

CREATE TEMP TABLE prepared_renewal_a_next AS
SELECT public.prepare_asaas_renewal_charge(
  'a5400000-0000-4000-8000-000000000001'::uuid
) AS result;

SELECT is(
  (
    SELECT (result ->> 'renewal_competence')::date
    FROM prepared_renewal_a_next
  ),
  (
    SELECT (vencimento AT TIME ZONE 'America/Sao_Paulo')::date
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  'after confirmation the advanced due date permits a future competence'
);

CREATE TEMP TABLE late_confirmation_time AS
SELECT clock_timestamp() - interval '1 minute' AS confirmed_at;

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_renewal_company_b_confirmed',
    'PAYMENT_CONFIRMED',
    'pay_renewal_company_b_1',
    130,
    NULL,
    (SELECT confirmed_at FROM late_confirmation_time)
  ) ->> 'action',
  'activated',
  'an overdue renewal is activated by its confirmation webhook'
);

SELECT is(
  (
    SELECT billing_cycle_started_at
    FROM public.asaas_payments
    WHERE asaas_payment_id = 'pay_renewal_company_b_1'
  ),
  (SELECT confirmed_at FROM late_confirmation_time),
  'an overdue renewal cycle starts at payment confirmation'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000002'
  ),
  (SELECT confirmed_at + interval '30 days' FROM late_confirmation_time),
  'an overdue renewal expires 30 days after confirmation'
);

SELECT is(
  (
    SELECT expires_at
    FROM public.empresa_modules
    WHERE id = 'a5500000-0000-4000-8000-000000000004'
  ),
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000002'
  ),
  'the overdue company monthly module follows the new confirmed cycle'
);

SELECT is(
  (
    SELECT vencimento
    FROM public.empresas
    WHERE id = 'a5300000-0000-4000-8000-000000000001'
  ),
  (SELECT vencimento FROM company_a_after_first_webhook),
  'confirming company B leaves company A unchanged'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.prepare_asaas_renewal_charge(uuid)',
    'EXECUTE'
  ),
  'renewal preparation remains service-role-only behind the Edge Function'
);

SELECT * FROM finish();
ROLLBACK;
