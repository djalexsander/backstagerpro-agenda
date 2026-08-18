-- Regression test for P1-14: recovery/authenticated sessions belonging to an
-- unactivated profile must not become operational tenant actors.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(13);

INSERT INTO public.empresas (id, nome_empresa, status)
VALUES ('f1000000-0000-4000-8000-000000000001', '__activation_gate_company__', 'ativo');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'activation-active@example.test', '', now(),
   '{}', '{"full_name":"Activated User"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'activation-pending@example.test', '', now(),
   '{}', '{"full_name":"Pending User"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'activation-master-active@example.test', '', now(),
   '{}', '{"full_name":"Activated Master"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'activation-master-pending@example.test', '', now(),
   '{}', '{"full_name":"Pending Master"}', now(), now());

UPDATE public.profiles
SET empresa_id = 'f1000000-0000-4000-8000-000000000001',
    ativado = user_id IN (
      'f2000000-0000-4000-8000-000000000001'::uuid,
      'f2000000-0000-4000-8000-000000000003'::uuid
    ),
    activated_at = CASE
      WHEN user_id IN (
        'f2000000-0000-4000-8000-000000000001'::uuid,
        'f2000000-0000-4000-8000-000000000003'::uuid
      ) THEN now()
      ELSE NULL
    END
WHERE user_id BETWEEN
  'f2000000-0000-4000-8000-000000000001'::uuid AND
  'f2000000-0000-4000-8000-000000000004'::uuid;

UPDATE public.user_roles
SET role = CASE
  WHEN user_id IN (
    'f2000000-0000-4000-8000-000000000003'::uuid,
    'f2000000-0000-4000-8000-000000000004'::uuid
  ) THEN 'master_admin'::public.app_role
  ELSE 'admin_empresa'::public.app_role
END
WHERE user_id BETWEEN
  'f2000000-0000-4000-8000-000000000001'::uuid AND
  'f2000000-0000-4000-8000-000000000004'::uuid;

SELECT is(
  public.get_user_empresa_id('f2000000-0000-4000-8000-000000000001'),
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'activated account resolves its canonical tenant'
);
SELECT is(
  public.get_user_empresa_id('f2000000-0000-4000-8000-000000000002'),
  NULL::uuid,
  'unactivated account resolves no tenant'
);
SELECT ok(
  public.has_role('f2000000-0000-4000-8000-000000000001', 'admin_empresa'),
  'activated account keeps its legitimate company role'
);
SELECT ok(
  NOT public.has_role('f2000000-0000-4000-8000-000000000002', 'admin_empresa'),
  'unactivated account has no effective company role'
);
SELECT ok(
  public.is_master_admin('f2000000-0000-4000-8000-000000000003'),
  'activated master keeps legitimate master access'
);
SELECT ok(
  NOT public.is_master_admin('f2000000-0000-4000-8000-000000000004'),
  'unactivated master role is not effective'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'f2000000-0000-4000-8000-000000000002',
  true
);
SET LOCAL ROLE authenticated;

SELECT ok(
  NOT public.can_read_company_data('f1000000-0000-4000-8000-000000000001'),
  'unactivated authenticated session cannot read tenant data'
);
SELECT ok(
  NOT public.can_write_company_data('f1000000-0000-4000-8000-000000000001'),
  'unactivated authenticated session cannot operate tenant modules'
);
SELECT throws_ok(
  $test$UPDATE public.profiles SET ativado = true WHERE user_id = auth.uid()$test$,
  '42501',
  'Account activation state is server-controlled',
  'recovery session cannot self-activate through profiles'
);

RESET ROLE;

SELECT ok(
  NOT (SELECT ativado FROM public.profiles
       WHERE user_id = 'f2000000-0000-4000-8000-000000000002'),
  'failed client self-activation leaves the profile pending'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $test$SELECT public.consume_account_activation(
    'f2000000-0000-4000-8000-000000000002'
  )$test$,
  'trusted Primeiro Acesso backend can consume activation'
);
RESET ROLE;

SELECT ok(
  (SELECT ativado FROM public.profiles
   WHERE user_id = 'f2000000-0000-4000-8000-000000000002'),
  'Primeiro Acesso activates the pending profile'
);
SELECT is(
  public.get_user_empresa_id('f2000000-0000-4000-8000-000000000002'),
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'newly activated account receives its legitimate tenant access'
);

SET LOCAL ROLE service_role;
SELECT is(
  public.consume_account_activation('f2000000-0000-4000-8000-000000000002'),
  NULL::timestamptz,
  'activation claim remains single-use'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
