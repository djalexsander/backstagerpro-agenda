-- Regression test for P0-7: company role changes must be tenant-scoped and
-- reconcile user_roles to one canonical row. The Master flow stays separate.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(20);

INSERT INTO public.empresas (id, nome_empresa, status) VALUES
  ('e1000000-0000-4000-8000-000000000001', '__company_role_test_a__', 'ativo'),
  ('e1000000-0000-4000-8000-000000000002', '__company_role_test_b__', 'ativo');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'company-role-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Company Role Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'company-role-target-a@example.test', '', now(),
   '{}', '{"full_name":"Company Role Target A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'company-role-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Company Role Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'company-role-target-b@example.test', '', now(),
   '{}', '{"full_name":"Company Role Target B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'company-role-user-a@example.test', '', now(),
   '{}', '{"full_name":"Company Role User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'company-role-master@example.test', '', now(),
   '{}', '{"full_name":"Company Role Master"}', now(), now());

UPDATE public.profiles
SET empresa_id = CASE
  WHEN user_id IN (
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e2000000-0000-4000-8000-000000000002'::uuid,
    'e2000000-0000-4000-8000-000000000005'::uuid
  ) THEN 'e1000000-0000-4000-8000-000000000001'::uuid
  WHEN user_id IN (
    'e2000000-0000-4000-8000-000000000003'::uuid,
    'e2000000-0000-4000-8000-000000000004'::uuid
  ) THEN 'e1000000-0000-4000-8000-000000000002'::uuid
  ELSE empresa_id
END
WHERE user_id BETWEEN
  'e2000000-0000-4000-8000-000000000001'::uuid AND
  'e2000000-0000-4000-8000-000000000006'::uuid;

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'e2000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000003'
);
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  'e2000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000004',
  'e2000000-0000-4000-8000-000000000005'
);
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'e2000000-0000-4000-8000-000000000006';

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.company_set_user_role(uuid,text,text)', 'EXECUTE'
  ),
  'anon cannot execute company_set_user_role'
);

-- usuario -> admin_empresa.
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000002', 'admin_empresa', 'Target A Admin'
  )$test$,
  'company A admin promotes a company A usuario'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  'admin_empresa',
  'promotion stores admin_empresa as the canonical role'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  1::bigint,
  'promotion leaves exactly one user_roles row'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'
     AND role = 'usuario'::public.app_role),
  0::bigint,
  'promotion removes the old usuario role'
);

-- admin_empresa -> usuario.
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000002', 'usuario', 'Target A User'
  )$test$,
  'company A admin demotes a company A admin_empresa'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  'usuario',
  'demotion stores usuario as the canonical role'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  1::bigint,
  'demotion leaves exactly one user_roles row'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'
     AND role = 'admin_empresa'::public.app_role),
  0::bigint,
  'demotion removes the old admin_empresa role'
);

-- Cross-tenant attempts fail in both directions.
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000004', 'admin_empresa', 'Cross Tenant B'
  )$test$,
  '42501', 'Usuário não pertence à empresa do administrador.',
  'company A admin cannot alter a company B user'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000004'),
  'usuario',
  'company B user remains unchanged after company A attempt'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000004'),
  1::bigint,
  'cross-tenant attempt creates no duplicate on company B user'
);

SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000002', 'admin_empresa', 'Cross Tenant A'
  )$test$,
  '42501', 'Usuário não pertence à empresa do administrador.',
  'company B admin cannot alter a company A user'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  'usuario',
  'company A user remains unchanged after company B attempt'
);

-- A common user cannot change roles, even inside its own company.
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000002', 'admin_empresa', 'Unauthorized'
  )$test$,
  '42501', 'Somente administradores da empresa podem alterar papéis.',
  'a common user cannot alter another user role'
);

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000002'),
  1::bigint,
  'common-user attempt leaves the target with one role'
);

-- Master is rejected by the company RPC and remains functional through its
-- existing dedicated RPC.
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.company_set_user_role(
    'e2000000-0000-4000-8000-000000000004', 'admin_empresa', 'Wrong Master Flow'
  )$test$,
  '42501', 'Master admin deve usar o fluxo administrativo global.',
  'master cannot use the company-admin role flow'
);

SELECT lives_ok(
  $test$SELECT public.master_set_user_role(
    'e2000000-0000-4000-8000-000000000004', 'admin_empresa',
    'Master Managed Target B', 'e1000000-0000-4000-8000-000000000002'
  )$test$,
  'master continues changing roles through master_set_user_role'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000004'),
  'admin_empresa',
  'Master flow stores the requested role'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'e2000000-0000-4000-8000-000000000004'),
  1::bigint,
  'Master flow still leaves exactly one role'
);

SELECT * FROM finish();
ROLLBACK;
