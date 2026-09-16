-- Regression coverage for 20260915100000_asaas_module_batch_charges.sql.
-- Run with `supabase test db` after all migrations are present locally.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.planos (
  id, nome, valor, periodicidade, categoria, ativo,
  disponivel_novo_cadastro, trial_days
) VALUES (
  'b6100000-0000-4000-8000-000000000001',
  '__asaas_module_batch_plan__',
  100,
  'mensal',
  'plano_base',
  true,
  true,
  0
);

INSERT INTO public.module_catalog (
  id, nome, feature_key, valor, periodicidade, ativo, ordem
) VALUES
  (
    'b6200000-0000-4000-8000-000000000001',
    '__asaas_batch_dependency__',
    '__asaas_batch_dependency__',
    10,
    'mensal',
    true,
    1
  ),
  (
    'b6200000-0000-4000-8000-000000000002',
    '__asaas_batch_dependent__',
    '__asaas_batch_dependent__',
    20,
    'mensal',
    true,
    2
  ),
  (
    'b6200000-0000-4000-8000-000000000003',
    '__asaas_batch_already_active__',
    '__asaas_batch_already_active__',
    30,
    'mensal',
    true,
    3
  ),
  (
    'b6200000-0000-4000-8000-000000000004',
    '__asaas_batch_unavailable__',
    '__asaas_batch_unavailable__',
    40,
    'mensal',
    false,
    4
  );

INSERT INTO public.module_dependencies (module_id, required_module_id)
VALUES (
  'b6200000-0000-4000-8000-000000000002',
  'b6200000-0000-4000-8000-000000000001'
);

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento,
  vencimento, trial_expires_at
) VALUES
  (
    'b6300000-0000-4000-8000-000000000001',
    '__asaas_module_batch_company_a__',
    'asaas-module-batch-a@example.test',
    '11222333000181',
    'ativo',
    '__asaas_module_batch_plan__',
    'b6100000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    clock_timestamp() + interval '40 days',
    NULL
  ),
  (
    'b6300000-0000-4000-8000-000000000002',
    '__asaas_module_batch_company_b__',
    'asaas-module-batch-b@example.test',
    '98765432100',
    'ativo',
    '__asaas_module_batch_plan__',
    'b6100000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    clock_timestamp() + interval '40 days',
    NULL
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'b6400000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated',
    'asaas-module-admin-a@example.test', '', now(), '{}',
    '{"full_name":"Asaas Module Admin A"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b6400000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated',
    'asaas-module-admin-b@example.test', '', now(), '{}',
    '{"full_name":"Asaas Module Admin B"}', now(), now()
  );

UPDATE public.profiles
SET empresa_id = 'b6300000-0000-4000-8000-000000000001'
WHERE user_id = 'b6400000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET empresa_id = 'b6300000-0000-4000-8000-000000000002'
WHERE user_id = 'b6400000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles
WHERE user_id IN (
  'b6400000-0000-4000-8000-000000000001',
  'b6400000-0000-4000-8000-000000000002'
);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('b6400000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b6400000-0000-4000-8000-000000000002', 'admin_empresa');

INSERT INTO public.empresa_modules (
  id, empresa_id, module_id, status, activated_at, expires_at,
  valor_cobrado, origem, granted_by_admin, trial_granted
) VALUES (
  'b6500000-0000-4000-8000-000000000001',
  'b6300000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000003',
  'active',
  now(),
  now() + interval '40 days',
  30,
  'asaas_pagamento',
  false,
  false
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_module_batch_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      ARRAY[
        'b6200000-0000-4000-8000-000000000001'::uuid,
        'b6200000-0000-4000-8000-000000000001'::uuid
      ]
    )
  $$,
  'P0001',
  'Module identifiers cannot be duplicated',
  'duplicate module IDs are rejected server-side'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_module_batch_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      ARRAY['b6200000-0000-4000-8000-000000000002'::uuid]
    )
  $$,
  'P0001',
  'Missing active or selected module dependencies: __asaas_batch_dependency__',
  'a dependent module cannot be bought without its dependency'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_module_batch_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      ARRAY['b6200000-0000-4000-8000-000000000003'::uuid]
    )
  $$,
  'P0001',
  'A requested module is already active or pending for this company',
  'an already-active module is not eligible for another purchase'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_module_batch_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      ARRAY['b6200000-0000-4000-8000-000000000004'::uuid]
    )
  $$,
  'P0001',
  'A requested module is not available for billing',
  'an inactive catalog module is unavailable for billing'
);

CREATE TEMP TABLE prepared_module_batch_a AS
SELECT public.prepare_asaas_module_batch_charge(
  'b6400000-0000-4000-8000-000000000001'::uuid,
  ARRAY[
    'b6200000-0000-4000-8000-000000000002'::uuid,
    'b6200000-0000-4000-8000-000000000001'::uuid
  ]
) AS result;

SELECT is(
  (SELECT (result ->> 'amount')::numeric FROM prepared_module_batch_a),
  30::numeric,
  'the server calculates the sum of all selected catalog prices'
);

SELECT is(
  (SELECT (result ->> 'module_count')::integer FROM prepared_module_batch_a),
  2,
  'the prepared payment records the expected module quantity'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.module_batch_request_items
    WHERE batch_request_id = (
      SELECT (result ->> 'related_batch_request_id')::uuid
      FROM prepared_module_batch_a
    )
  ),
  2,
  'one batch contains every selected module exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.asaas_payments
    WHERE related_batch_request_id = (
      SELECT (result ->> 'related_batch_request_id')::uuid
      FROM prepared_module_batch_a
    )
  ),
  1,
  'the multi-module batch has exactly one internal Asaas payment'
);

SELECT ok(
  (
    SELECT payment.empresa_id = batch.empresa_id
      AND payment.module_item_count = 2
      AND payment.module_batch_contract_version = 1
      AND payment.related_module_id IS NULL
      AND payment.module_set_key =
        'b6200000-0000-4000-8000-000000000001,b6200000-0000-4000-8000-000000000002'
    FROM public.asaas_payments AS payment
    JOIN public.module_batch_requests AS batch
      ON batch.id = payment.related_batch_request_id
    WHERE payment.id = (
      SELECT (result ->> 'payment_id')::uuid
      FROM prepared_module_batch_a
    )
  ),
  'payment, canonical module set, batch and company are linked unambiguously'
);

SELECT throws_ok(
  format(
    $sql$
      UPDATE public.module_batch_request_items
      SET valor = valor + 1
      WHERE batch_request_id = %L::uuid
    $sql$,
    (
      SELECT result ->> 'related_batch_request_id'
      FROM prepared_module_batch_a
    )
  ),
  'P0001',
  'Asaas module batch items are immutable while payment is active',
  'the reserved item set and prices cannot be changed before confirmation'
);

SELECT throws_ok(
  format(
    $sql$
      UPDATE public.module_batch_requests
      SET valor_total = valor_total + 1
      WHERE id = %L::uuid
    $sql$,
    (
      SELECT result ->> 'related_batch_request_id'
      FROM prepared_module_batch_a
    )
  ),
  'P0001',
  'Asaas module batch financial identity is immutable while payment is active',
  'the reserved batch total cannot be changed before confirmation'
);

SELECT throws_ok(
  format(
    $sql$
      UPDATE public.asaas_payments
      SET module_item_count = module_item_count + 1
      WHERE id = %L::uuid
    $sql$,
    (
      SELECT result ->> 'payment_id'
      FROM prepared_module_batch_a
    )
  ),
  'P0001',
  'Asaas module payment batch contract is immutable',
  'the quantity and canonical set stored on the payment cannot be forged'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_module_batch_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      ARRAY[
        'b6200000-0000-4000-8000-000000000001'::uuid,
        'b6200000-0000-4000-8000-000000000002'::uuid
      ]
    )
  $$,
  'P0001',
  'A requested module already has an operation in progress',
  'a repeated or concurrent request cannot create another charge for the set'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_asaas_charge(
      'b6400000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'b6200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  'P0001',
  'An active Asaas charge already contains a requested module',
  'the legacy single-module RPC cannot bypass an active multi-module batch'
);

CREATE TEMP TABLE prepared_module_batch_b AS
SELECT public.prepare_asaas_module_batch_charge(
  'b6400000-0000-4000-8000-000000000002'::uuid,
  ARRAY[
    'b6200000-0000-4000-8000-000000000001'::uuid,
    'b6200000-0000-4000-8000-000000000002'::uuid
  ]
) AS result;

SELECT is(
  (SELECT (result ->> 'amount')::numeric FROM prepared_module_batch_b),
  30::numeric,
  'another company can independently purchase the same module set'
);

SELECT isnt(
  (SELECT result ->> 'payment_id' FROM prepared_module_batch_a),
  (SELECT result ->> 'payment_id' FROM prepared_module_batch_b),
  'tenant-isolated batches have different payments'
);

UPDATE public.asaas_payments
SET asaas_payment_id = 'pay_module_batch_company_a'
WHERE id = (
  SELECT (result ->> 'payment_id')::uuid FROM prepared_module_batch_a
);

UPDATE public.asaas_payments
SET asaas_payment_id = 'pay_module_batch_company_b'
WHERE id = (
  SELECT (result ->> 'payment_id')::uuid FROM prepared_module_batch_b
);

SELECT throws_ok(
  $$
    SELECT public.process_asaas_payment_webhook(
      'evt_module_batch_company_a_wrong_amount',
      'PAYMENT_CONFIRMED',
      'pay_module_batch_company_a',
      29,
      NULL,
      clock_timestamp()
    )
  $$,
  '22023',
  'ASAAS_PAYMENT_AMOUNT_MISMATCH',
  'the webhook rejects a provider amount that differs from the server-priced batch'
);

CREATE TEMP TABLE webhook_module_batch_a AS
SELECT public.process_asaas_payment_webhook(
  'evt_module_batch_company_a_confirmed',
  'PAYMENT_CONFIRMED',
  'pay_module_batch_company_a',
  30,
  NULL,
  clock_timestamp()
) AS result;

SELECT is(
  (SELECT result ->> 'action' FROM webhook_module_batch_a),
  'activated',
  'one webhook confirmation activates the complete module batch'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules
    WHERE empresa_id = 'b6300000-0000-4000-8000-000000000001'
      AND module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
      AND status = 'active'
  ),
  2,
  'all modules in the batch become active atomically'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules AS company_modules
    JOIN public.empresas AS companies ON companies.id = company_modules.empresa_id
    JOIN public.module_batch_request_items AS items
      ON items.module_id = company_modules.module_id
     AND items.batch_request_id = (
       SELECT (result ->> 'related_batch_request_id')::uuid
       FROM prepared_module_batch_a
     )
    WHERE company_modules.empresa_id = 'b6300000-0000-4000-8000-000000000001'
      AND company_modules.module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
      AND company_modules.origem = 'asaas_pagamento'
      AND company_modules.granted_by_admin = false
      AND company_modules.trial_granted = false
      AND round(company_modules.valor_cobrado, 2) = round(items.valor, 2)
      AND company_modules.expires_at IS NOT DISTINCT FROM companies.vencimento
  ),
  2,
  'every activated module preserves its item price and follows the company expiration policy'
);

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_module_batch_company_a_confirmed',
    'PAYMENT_CONFIRMED',
    'pay_module_batch_company_a',
    30,
    NULL,
    clock_timestamp()
  ) ->> 'action',
  'already_processed',
  'repeating the same webhook event is idempotent'
);

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_module_batch_company_a_received',
    'PAYMENT_RECEIVED',
    'pay_module_batch_company_a',
    30,
    NULL,
    clock_timestamp()
  ) ->> 'action',
  'status_updated',
  'a later RECEIVED event does not activate the batch a second time'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules
    WHERE empresa_id = 'b6300000-0000-4000-8000-000000000001'
      AND module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
  ),
  2,
  'CONFIRMED plus RECEIVED still leaves exactly one entitlement per module'
);

UPDATE public.module_catalog
SET ativo = false
WHERE id = 'b6200000-0000-4000-8000-000000000002';

SELECT throws_ok(
  $$
    SELECT public.process_asaas_payment_webhook(
      'evt_module_batch_company_b_confirmed',
      'PAYMENT_CONFIRMED',
      'pay_module_batch_company_b',
      30,
      NULL,
      clock_timestamp()
    )
  $$,
  'P0001',
  'Asaas module batch activation is incomplete or inconsistent',
  'a failure in one item aborts completion of the entire webhook batch'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules
    WHERE empresa_id = 'b6300000-0000-4000-8000-000000000002'
      AND module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
  ),
  0,
  'a failed webhook leaves no partially activated module behind'
);

SELECT is(
  (
    SELECT status
    FROM public.module_batch_requests
    WHERE id = (
      SELECT (result ->> 'related_batch_request_id')::uuid
      FROM prepared_module_batch_b
    )
  ),
  'pending',
  'the batch approval is rolled back together with partial activation'
);

UPDATE public.module_catalog
SET ativo = true
WHERE id = 'b6200000-0000-4000-8000-000000000002';

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_module_batch_company_b_confirmed',
    'PAYMENT_CONFIRMED',
    'pay_module_batch_company_b',
    30,
    NULL,
    clock_timestamp()
  ) ->> 'action',
  'activated',
  'the same rolled-back event can be retried successfully after correction'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules
    WHERE empresa_id = 'b6300000-0000-4000-8000-000000000002'
      AND module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
      AND status = 'active'
  ),
  2,
  'the corrected retry activates all modules for company B only'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.empresa_modules
    WHERE empresa_id = 'b6300000-0000-4000-8000-000000000001'
      AND module_id IN (
        'b6200000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000002'
      )
  ),
  2,
  'company B webhook processing does not alter company A entitlements'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.prepare_asaas_module_batch_charge(uuid, uuid[])',
    'EXECUTE'
  ),
  'batch preparation remains service-role-only behind create-asaas-charge'
);

SELECT * FROM finish();
ROLLBACK;
