-- Regression test for the Master > Usuários Globais role-edit atomicity
-- fixed by 20260811120000_master_set_user_role.sql (Codex review cycle 3,
-- problem 1): the previous client code ran the profile update, the new-role
-- upsert and the old-roles cleanup as three independent HTTP requests, so a
-- failure between the upsert and the cleanup could leave a demoted
-- master_admin still holding the master role, and there was no protection
-- against removing the platform's last master_admin.
--
-- This test is fully self-contained (its own auth.users/empresas fixtures)
-- so it does not depend on any pre-seeded company or master account.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(15);

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (id, nome_empresa, status)
VALUES ('a1000000-0000-4000-8000-000000000001', '__role_rpc_test_company__', 'ativo');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'role-master-a@example.test', '', now(),
   '{}', '{"full_name":"Role Test Master A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'role-master-b@example.test', '', now(),
   '{}', '{"full_name":"Role Test Master B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'role-target@example.test', '', now(),
   '{}', '{"full_name":"Role Test Target"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'role-non-master@example.test', '', now(),
   '{}', '{"full_name":"Role Test Non Master"}', now(), now());

UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'a2000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'a2000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = 'a2000000-0000-4000-8000-000000000004';

-- ----------------------------------------------------------------------------
-- 1. anon has no grant at all on the wrapper.
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.master_set_user_role(uuid, text, text, uuid)', 'EXECUTE'
  ),
  'anon cannot execute master_set_user_role'
);

-- ----------------------------------------------------------------------------
-- 2. A non-master authenticated user is rejected by the wrapper's own
--    is_master_admin check.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000003', 'admin_empresa', 'Role Test Target', NULL
  )$test$,
  'P0001',
  'Only a global master administrator can change a user role',
  'a non-master authenticated user cannot change roles'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. A real master_admin can promote the target to admin_empresa and assign
--    a company, atomically.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000003', 'admin_empresa', 'Promoted Target',
    'a1000000-0000-4000-8000-000000000001'
  )$test$,
  'a master_admin can promote a user to admin_empresa'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles WHERE user_id = 'a2000000-0000-4000-8000-000000000003'),
  'admin_empresa',
  'the target user now has exactly the admin_empresa role'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.user_roles WHERE user_id = 'a2000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the target user has exactly one user_roles row (no leftover usuario row)'
);

SELECT is(
  (SELECT full_name FROM public.profiles WHERE user_id = 'a2000000-0000-4000-8000-000000000003'),
  'Promoted Target',
  'the profile full_name was updated atomically with the role'
);

SELECT is(
  (SELECT empresa_id FROM public.profiles WHERE user_id = 'a2000000-0000-4000-8000-000000000003'),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'the profile empresa_id was assigned atomically with the role'
);

SELECT is(
  (
    SELECT perfil
    FROM public.empresa_usuarios
    WHERE user_id = 'a2000000-0000-4000-8000-000000000003'
      AND empresa_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'admin_empresa',
  'the empresa_usuarios projection stays in sync via the existing triggers'
);

-- ----------------------------------------------------------------------------
-- 4. Demoting a master_admin is allowed while another master_admin remains.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000002', 'usuario', 'Role Test Master B', NULL
  )$test$,
  'a master_admin can be demoted while another master_admin still exists'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::bigint FROM public.user_roles WHERE role = 'master_admin'::app_role),
  1::bigint,
  'exactly one master_admin remains after the demotion'
);

-- ----------------------------------------------------------------------------
-- 5. The last remaining master_admin cannot be demoted.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000001', 'usuario', 'Role Test Master A', NULL
  )$test$,
  'P0001',
  'Cannot demote the last master administrator',
  'the last master_admin cannot be demoted'
);

RESET ROLE;

SELECT is(
  (SELECT role::text FROM public.user_roles WHERE user_id = 'a2000000-0000-4000-8000-000000000001'),
  'master_admin',
  'the last master_admin still holds the role after the rejected attempt'
);

-- ----------------------------------------------------------------------------
-- 6. Idempotent re-application of the same role does not error and does not
--    duplicate rows.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000003', 'admin_empresa', 'Promoted Target',
    'a1000000-0000-4000-8000-000000000001'
  )$test$,
  'reapplying the same role is idempotent'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::bigint FROM public.user_roles WHERE user_id = 'a2000000-0000-4000-8000-000000000003'),
  1::bigint,
  'idempotent reapplication does not duplicate user_roles rows'
);

-- ----------------------------------------------------------------------------
-- 7. Invalid role is rejected.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_set_user_role(
    'a2000000-0000-4000-8000-000000000003', 'super_admin', 'Promoted Target', NULL
  )$test$,
  'P0001',
  'Invalid role: super_admin',
  'an unknown role is rejected'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
