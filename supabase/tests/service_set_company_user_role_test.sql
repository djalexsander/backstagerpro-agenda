-- Regression test for the P0-7 residue: the invite Edge Functions
-- (create-user / create-empresa-user) must reconcile user_roles to exactly one
-- canonical row, removing any previous role, and stay tenant-scoped. The write
-- now runs through public.service_set_company_user_role (service-role only,
-- actor re-checked server-side).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(25);

INSERT INTO public.empresas (id, nome_empresa, status) VALUES
  ('f1000000-0000-4000-8000-000000000001', '__svc_role_test_a__', 'ativo'),
  ('f1000000-0000-4000-8000-000000000002', '__svc_role_test_b__', 'ativo');

-- handle_new_user() seeds every inserted auth.users row with a profile
-- (empresa_id NULL for invites) and a 'usuario' user_roles row.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'svc-role-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'svc-role-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'svc-role-master@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Master"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'svc-role-plain-a@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Plain A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'svc-role-fresh-invite@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Fresh Invite"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'svc-role-existing-user-a@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Existing User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000007',
   'authenticated', 'authenticated', 'svc-role-existing-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Existing Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000008',
   'authenticated', 'authenticated', 'svc-role-target-b@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Target B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000009',
   'authenticated', 'authenticated', 'svc-role-target-master@example.test', '', now(),
   '{}', '{"full_name":"Svc Role Target Master"}', now(), now());

-- Company assignment. Leave the "fresh invite" target (…0005) with a null
-- empresa_id, exactly like a just-invited user before create-user writes it.
UPDATE public.profiles
SET empresa_id = CASE
  WHEN user_id IN (
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'f2000000-0000-4000-8000-000000000004'::uuid,
    'f2000000-0000-4000-8000-000000000006'::uuid,
    'f2000000-0000-4000-8000-000000000007'::uuid
  ) THEN 'f1000000-0000-4000-8000-000000000001'::uuid
  WHEN user_id IN (
    'f2000000-0000-4000-8000-000000000002'::uuid,
    'f2000000-0000-4000-8000-000000000008'::uuid
  ) THEN 'f1000000-0000-4000-8000-000000000002'::uuid
  ELSE empresa_id
END
WHERE user_id BETWEEN
  'f2000000-0000-4000-8000-000000000001'::uuid AND
  'f2000000-0000-4000-8000-000000000009'::uuid;

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000007'
);
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id IN (
  'f2000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000009'
);
-- …0004 (plain A), …0005 (fresh invite), …0006 (existing user A), …0008 (target B)
-- keep the default 'usuario'.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.service_set_company_user_role(uuid,uuid,uuid,text)', 'EXECUTE'
  ),
  'anon cannot execute service_set_company_user_role'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.service_set_company_user_role(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute service_set_company_user_role'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.service_set_company_user_role(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service_role can execute service_set_company_user_role'
);

SET LOCAL ROLE service_role;

-- ---------------------------------------------------------------------------
-- 1. New user (fresh invite, null profile company) assigned 'usuario'
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000005',
    'f1000000-0000-4000-8000-000000000001',
    'usuario'
  )$test$,
  'new user: company admin assigns usuario to a fresh invite'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000005'),
  'usuario',
  'new user ends with exactly one usuario role'
);

-- ---------------------------------------------------------------------------
-- 2. New user assigned 'admin_empresa' drops the seeded 'usuario' row
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000005',
    'f1000000-0000-4000-8000-000000000001',
    'admin_empresa'
  )$test$,
  'new user: re-assign as admin_empresa'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000005'),
  'admin_empresa',
  'new user promotion leaves exactly one admin_empresa row (seeded usuario removed)'
);

-- ---------------------------------------------------------------------------
-- 3. Existing user, same role -> idempotent
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000006',
    'f1000000-0000-4000-8000-000000000001',
    'usuario'
  )$test$,
  'existing user, same role: no error'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000006'),
  1::bigint,
  'existing user, same role: still exactly one row'
);
SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000006'),
  'usuario',
  'existing user, same role: role unchanged'
);

-- ---------------------------------------------------------------------------
-- 4 + 5. Existing user changing role -> old role removed
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000007',
    'f1000000-0000-4000-8000-000000000001',
    'usuario'
  )$test$,
  'existing admin_empresa demoted to usuario'
);
SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000007'),
  'usuario',
  'role change stores the new role'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000007'),
  1::bigint,
  'role change leaves exactly one row'
);
SELECT is(
  (SELECT count(*) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000007'
     AND role = 'admin_empresa'::public.app_role),
  0::bigint,
  'role change removed the previous admin_empresa row (P0-7)'
);

-- Re-promote and confirm the reverse direction also reconciles.
SELECT public.service_set_company_user_role(
  'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000007',
  'f1000000-0000-4000-8000-000000000001',
  'admin_empresa'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000007'),
  'admin_empresa',
  're-promotion removes the usuario row too'
);

-- ---------------------------------------------------------------------------
-- 6. Cross-tenant attempt is rejected and changes nothing
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000008',
    'f1000000-0000-4000-8000-000000000001',
    'admin_empresa'
  )$test$,
  '42501',
  'Usuário pertence a outra empresa.',
  'company A admin cannot set the role of a company B user'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000008'),
  'usuario',
  'cross-tenant attempt leaves the company B user untouched'
);

-- A company admin bound to company A cannot borrow company B either.
SELECT throws_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000008',
    'f1000000-0000-4000-8000-000000000002',
    'usuario'
  )$test$,
  '42501',
  'Administrador de empresa só gerencia usuários da própria empresa.',
  'company A admin cannot act on company B even by passing company B'
);

-- ---------------------------------------------------------------------------
-- 7. Forbidden role (master_admin) is rejected
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000006',
    'f1000000-0000-4000-8000-000000000001',
    'master_admin'
  )$test$,
  '42501',
  'Papel inválido para este fluxo.',
  'master_admin cannot be assigned through this flow'
);
SELECT is(
  (SELECT role::text FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000006'),
  'usuario',
  'forbidden-role attempt leaves the target unchanged'
);

-- ---------------------------------------------------------------------------
-- 8. A master target is never modified by this flow
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000009',
    'f1000000-0000-4000-8000-000000000001',
    'usuario'
  )$test$,
  '42501',
  'Contas master_admin não podem ser alteradas por este fluxo.',
  'a master_admin target is rejected'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000009'),
  'master_admin',
  'master target keeps exactly its master_admin role'
);

-- ---------------------------------------------------------------------------
-- 9. A non-administrator actor cannot set roles
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000004',
    'f2000000-0000-4000-8000-000000000006',
    'f1000000-0000-4000-8000-000000000001',
    'admin_empresa'
  )$test$,
  '42501',
  'Somente administradores podem definir papéis de usuário.',
  'a plain usuario actor cannot set another user role'
);

-- ---------------------------------------------------------------------------
-- 10. A master actor may target any company (create-empresa-user path)
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.service_set_company_user_role(
    'f2000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000008',
    'f1000000-0000-4000-8000-000000000002',
    'admin_empresa'
  )$test$,
  'master actor promotes a company B user'
);
SELECT is(
  (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000008'),
  'admin_empresa',
  'master-driven promotion also reconciles to one canonical role'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
