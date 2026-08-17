-- Regression test for P0-3: central security helpers must not inherit the
-- default EXECUTE privilege from PUBLIC.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(15);

-- deactivate_trial_modules: scheduled backend automation only.
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.deactivate_trial_modules(uuid)', 'EXECUTE'
  ),
  'anon cannot execute deactivate_trial_modules'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.deactivate_trial_modules(uuid)', 'EXECUTE'
  ),
  'authenticated cannot execute deactivate_trial_modules'
);
SELECT ok(
  has_function_privilege(
    'service_role', 'public.deactivate_trial_modules(uuid)', 'EXECUTE'
  ),
  'service_role can execute deactivate_trial_modules'
);

-- RLS helpers: authenticated policies require them; anon and service_role do
-- not (service_role bypasses RLS and SECURITY DEFINER callers run as owner).
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_user_empresa_id(uuid)', 'EXECUTE'
  ),
  'anon cannot execute get_user_empresa_id'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.get_user_empresa_id(uuid)', 'EXECUTE'
  ),
  'authenticated can execute get_user_empresa_id for RLS'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.get_user_empresa_id(uuid)', 'EXECUTE'
  ),
  'service_role has no direct execute on get_user_empresa_id'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.has_role(uuid,public.app_role)', 'EXECUTE'
  ),
  'anon cannot execute has_role'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.has_role(uuid,public.app_role)', 'EXECUTE'
  ),
  'authenticated can execute has_role for RLS'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.has_role(uuid,public.app_role)', 'EXECUTE'
  ),
  'service_role has no direct execute on has_role'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.is_master_admin(uuid)', 'EXECUTE'
  ),
  'anon cannot execute is_master_admin'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.is_master_admin(uuid)', 'EXECUTE'
  ),
  'authenticated can execute is_master_admin for RLS'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.is_master_admin(uuid)', 'EXECUTE'
  ),
  'service_role has no direct execute on is_master_admin'
);

-- Internal canonical projection helper: only function owner paths need it.
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_canonical_empresa_perfil(uuid)', 'EXECUTE'
  ),
  'anon cannot execute get_canonical_empresa_perfil'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.get_canonical_empresa_perfil(uuid)', 'EXECUTE'
  ),
  'authenticated has no direct execute on get_canonical_empresa_perfil'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.get_canonical_empresa_perfil(uuid)', 'EXECUTE'
  ),
  'service_role has no direct execute on get_canonical_empresa_perfil'
);

SELECT * FROM finish();
ROLLBACK;
