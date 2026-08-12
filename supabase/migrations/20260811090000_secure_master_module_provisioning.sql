-- Fix: Master panel "editar empresa" and "criar empresa" both broke with
-- "permission denied for function provision_company_module_entitlements"
-- after 20260808110000 correctly revoked ALL execute on that internal helper
-- from PUBLIC/anon/authenticated/service_role (it took a raw _empresa_id
-- with no auth.uid()/pertencimento check, so it had to be locked down to
-- nested-only callers). The only nested caller left was the AFTER INSERT
-- trigger (handle_new_company_module_provisioning), which still works
-- because it runs with the trigger function's own SECURITY DEFINER
-- privilege, not the original client's.
--
-- src/pages/master/Empresas.tsx calls
-- supabase.rpc("provision_company_module_entitlements", ...) directly from
-- the browser in two places: once after creating a company (redundant with
-- the trigger, but still executed) and once after editing a company's plan
-- (not redundant - this is what backfills empresa_modules rows for any
-- module_catalog entries added after the company was created). Both calls
-- are made as the authenticated master user, so both now fail outright.
--
-- Fix: add a master-gated wrapper, following the exact pattern already used
-- by public.set_company_lifetime_subscription (also master-only, also
-- called directly from Empresas.tsx) - checks auth.uid()/is_master_admin
-- itself, then calls the internal helper as a nested PERFORM, which keeps
-- running under this wrapper's own SECURITY DEFINER privilege regardless of
-- the revoke on the internal function. No grant is reintroduced on the
-- internal function, and this wrapper is never granted to anon/public.

CREATE OR REPLACE FUNCTION public.master_provision_company_module_entitlements(
  _empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_master_admin(v_actor_id) THEN
    RAISE EXCEPTION
      'Only a global master administrator can provision company module entitlements';
  END IF;

  PERFORM public.provision_company_module_entitlements(_empresa_id);
END;
$$;

REVOKE ALL ON FUNCTION public.master_provision_company_module_entitlements(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_provision_company_module_entitlements(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.master_provision_company_module_entitlements(uuid) IS
  'Master-only entry point for provision_company_module_entitlements. Validates is_master_admin before delegating to the internal helper, which stays locked down to nested SECURITY DEFINER callers only.';

DO $$
DECLARE
  v_fn regprocedure := 'public.master_provision_company_module_entitlements(uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN130',
      MESSAGE = 'Hardening falhou: master_provision_company_module_entitlements executavel por anon.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN131',
      MESSAGE = 'master_provision_company_module_entitlements nao esta executavel por authenticated.';
  END IF;
END;
$$;
