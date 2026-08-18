-- P1-2 regression: canonical dependencies survive self-service, individual
-- and batch Master approvals, direct backend writes and tenant isolation.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(20);

INSERT INTO public.module_catalog (
  id, nome, feature_key, valor, ativo, ordem, tipo_modulo, categoria
) VALUES
  ('fb100000-0000-4000-8000-000000000001', '__dep_base__', 'test_dep_base', 10, true, 900, 'addon', 'gestao'),
  ('fb100000-0000-4000-8000-000000000002', '__dep_child__', 'test_dep_child', 20, true, 901, 'addon', 'gestao'),
  ('fb100000-0000-4000-8000-000000000003', '__dep_leaf__', 'test_dep_leaf', 30, true, 902, 'addon', 'gestao'),
  ('fb100000-0000-4000-8000-000000000004', '__dep_free__', 'test_dep_free', 15, true, 903, 'addon', 'gestao'),
  ('fb100000-0000-4000-8000-000000000005', '__dep_payment__', 'test_dep_payment', 25, true, 904, 'addon', 'gestao');

INSERT INTO public.module_dependencies (module_id, required_module_id) VALUES
  ('fb100000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001'),
  ('fb100000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000002');

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
)
SELECT company.id, company.nome, 'ativo', plan.id, false, false, 'pago', now() + interval '30 days'
FROM (VALUES
  ('fb200000-0000-4000-8000-000000000001'::uuid, '__dep_company_a__'),
  ('fb200000-0000-4000-8000-000000000002'::uuid, '__dep_company_b__')
) AS company(id, nome)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos
  WHERE categoria = 'plano_base' AND ativo AND periodicidade IN ('mensal', 'anual')
  LIMIT 1
) AS plan;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'fb300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'dep-admin-a@example.test', '', now(), '{}', '{"full_name":"Dep Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'dep-admin-b@example.test', '', now(), '{}', '{"full_name":"Dep Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fb300000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'dep-master@example.test', '', now(), '{}', '{"full_name":"Dep Master"}', now(), now());

UPDATE public.profiles
SET ativado = true,
    empresa_id = CASE user_id
      WHEN 'fb300000-0000-4000-8000-000000000001'::uuid THEN 'fb200000-0000-4000-8000-000000000001'::uuid
      WHEN 'fb300000-0000-4000-8000-000000000002'::uuid THEN 'fb200000-0000-4000-8000-000000000002'::uuid
      ELSE empresa_id
    END
WHERE user_id BETWEEN
  'fb300000-0000-4000-8000-000000000001'::uuid AND
  'fb300000-0000-4000-8000-000000000003'::uuid;
UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN ('fb300000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000002');
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'fb300000-0000-4000-8000-000000000003';

CREATE TEMP TABLE dependency_test_result (batch_id uuid);

SELECT set_config('request.jwt.claim.sub', 'fb300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$INSERT INTO dependency_test_result
    SELECT (public.request_company_module_batch(
      ARRAY['fb100000-0000-4000-8000-000000000003'::uuid], NULL
    )->>'id')::uuid$test$,
  'self-service accepts a module requiring dependencies'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.module_batch_request_items
   WHERE batch_request_id = (SELECT batch_id FROM dependency_test_result)),
  3::bigint,
  'self-service includes the full transitive dependency closure'
);
SELECT is(
  (SELECT empresa_id FROM public.module_batch_requests
   WHERE id = (SELECT batch_id FROM dependency_test_result)),
  'fb200000-0000-4000-8000-000000000001'::uuid,
  'self-service derives company A and cannot target company B'
);

SELECT set_config('request.jwt.claim.sub', 'fb300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.master_approve_module_batch_request(
    (SELECT batch_id FROM dependency_test_result), NULL
  )$test$,
  'Master batch approval activates a complete dependency set atomically'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000001'
     AND module_id IN (
       'fb100000-0000-4000-8000-000000000001',
       'fb100000-0000-4000-8000-000000000002',
       'fb100000-0000-4000-8000-000000000003'
     ) AND status = 'active'),
  3::bigint,
  'batch approval activates dependency, child and leaf'
);
SELECT is(
  (SELECT count(*) FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000001'
     AND module_id IN (
       'fb100000-0000-4000-8000-000000000001',
       'fb100000-0000-4000-8000-000000000002',
       'fb100000-0000-4000-8000-000000000003'
     )),
  3::bigint,
  'batch approval reuses provisioned rows without duplicates'
);

INSERT INTO public.module_requests (id, empresa_id, module_id, status)
VALUES ('fb400000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000004', 'pending');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.master_approve_module_request(
    'fb400000-0000-4000-8000-000000000001', NULL
  )$test$,
  'individual approval supports a module without dependencies'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000001'
     AND module_id = 'fb100000-0000-4000-8000-000000000004'),
  'active',
  'individual approval activates the requested independent module'
);

INSERT INTO public.module_requests (id, empresa_id, module_id, status)
VALUES ('fb400000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'pending');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.master_approve_module_request(
    'fb400000-0000-4000-8000-000000000002', NULL
  )$test$,
  'P0001', 'Missing active module dependencies: __dep_base__',
  'individual approval explicitly rejects a missing dependency'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.module_requests WHERE id = 'fb400000-0000-4000-8000-000000000002'),
  'pending',
  'failed individual approval leaves the request pending'
);

SELECT set_config('request.jwt.claim.sub', 'fb300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$UPDATE public.empresa_modules
    SET status = 'active'
    WHERE empresa_id = 'fb200000-0000-4000-8000-000000000002'
      AND module_id = 'fb100000-0000-4000-8000-000000000002';
    SET CONSTRAINTS enforce_company_module_dependencies IMMEDIATE$test$,
  'P0001', 'Cannot activate a module before its dependencies',
  'direct backend activation cannot bypass canonical dependencies'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000002'
     AND module_id = 'fb100000-0000-4000-8000-000000000002'),
  'inactive',
  'failed direct bypass leaves the dependent module inactive'
);

INSERT INTO public.module_batch_requests (id, empresa_id, valor_total, status)
VALUES ('fb600000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000002', 20, 'pending');
SELECT throws_ok(
  $test$INSERT INTO public.module_batch_request_items (
    batch_request_id, module_id, valor
  ) VALUES (
    'fb600000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000002', 20
  )$test$,
  'P0001', 'Module batch is missing required dependencies: __dep_base__',
  'direct incomplete batch creation cannot bypass dependencies'
);

SELECT is(
  public.activate_company_modules_checked(
    'fb200000-0000-4000-8000-000000000002',
    ARRAY['fb100000-0000-4000-8000-000000000001'::uuid],
    '{}'::jsonb, 'test', NULL, true
  ),
  1,
  'an existing active dependency is accepted for the next request'
);

TRUNCATE dependency_test_result;
SELECT set_config('request.jwt.claim.sub', 'fb300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
INSERT INTO dependency_test_result
SELECT (public.request_company_module_batch(
  ARRAY['fb100000-0000-4000-8000-000000000002'::uuid], NULL
)->>'id')::uuid;
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.module_batch_request_items
   WHERE batch_request_id = (SELECT batch_id FROM dependency_test_result)),
  1::bigint,
  'self-service does not duplicate a dependency already active for the same company'
);
SELECT is(
  (SELECT count(*) FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000001'
     AND module_id = 'fb100000-0000-4000-8000-000000000001'),
  1::bigint,
  'company B operations never duplicate or alter company A dependency rows'
);

INSERT INTO public.module_payments (id, empresa_id, module_id, amount, status)
VALUES ('fb500000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000005', 25, 'pending');
SELECT set_config('request.jwt.claim.sub', 'fb300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.master_approve_module_payment(
    'fb500000-0000-4000-8000-000000000001', NULL
  )$test$,
  'individual payment approval uses the same transactional backend'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.module_payments WHERE id = 'fb500000-0000-4000-8000-000000000001'),
  'approved',
  'payment status changes only with successful module activation'
);
SELECT is(
  (SELECT status FROM public.empresa_modules
   WHERE empresa_id = 'fb200000-0000-4000-8000-000000000001'
     AND module_id = 'fb100000-0000-4000-8000-000000000005'),
  'active',
  'payment approval activates the independent module'
);
SELECT is(
  (SELECT count(*) FROM public.empresa_modules
   WHERE empresa_id IN (
     'fb200000-0000-4000-8000-000000000001',
     'fb200000-0000-4000-8000-000000000002'
   ) AND module_id IN (
     'fb100000-0000-4000-8000-000000000001',
     'fb100000-0000-4000-8000-000000000002',
     'fb100000-0000-4000-8000-000000000003',
     'fb100000-0000-4000-8000-000000000004',
     'fb100000-0000-4000-8000-000000000005'
   )),
  10::bigint,
  'provisioning remains one row per company and module across all flows'
);

SELECT * FROM finish();
ROLLBACK;
