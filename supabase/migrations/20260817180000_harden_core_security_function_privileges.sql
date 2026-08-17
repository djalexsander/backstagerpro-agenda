-- P0-3: close direct access to central SECURITY DEFINER helpers.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on newly created functions.
-- These five functions never received an explicit privilege boundary.
-- Keep only the access required by their real callers:
--   * deactivate_trial_modules is called directly by check-vencimentos with
--     SUPABASE_SERVICE_ROLE_KEY; nested calls from SECURITY DEFINER RPCs keep
--     working as the function owner.
--   * get_user_empresa_id, has_role and is_master_admin are evaluated directly
--     by authenticated RLS policies.
--   * get_canonical_empresa_perfil is only called by SECURITY DEFINER trigger
--     functions and therefore needs no client-role grant.

REVOKE ALL ON FUNCTION public.deactivate_trial_modules(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_empresa_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_master_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_canonical_empresa_perfil(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.deactivate_trial_modules(uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.get_user_empresa_id(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid)
  TO authenticated;
