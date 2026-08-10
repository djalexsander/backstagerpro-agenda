-- The INSERT/UPDATE/DELETE policies on estoque_localizacoes called
-- company_has_active_module(...) and company_has_operational_access(...)
-- directly, in addition to the canonical wrapper can_write_company_module(...).
-- Those two helpers had EXECUTE revoked from `authenticated` in
-- 20260730043000_enforce_backend_entitlements.sql (they were meant to stay
-- internal, callable only through the SECURITY DEFINER wrappers
-- can_read_company_module/can_write_company_module, which do have EXECUTE
-- and already invoke them internally as the function owner). RLS policies,
-- however, evaluate function calls as the querying role itself, so every
-- write to estoque_localizacoes failed with "permission denied for function
-- company_has_active_module" (SQLSTATE 42501), regardless of the user's
-- actual role, plan or module entitlements. The SELECT policy on this table
-- was not affected: it already used can_read_company_module for both
-- feature keys.
--
-- can_write_company_module(empresa_id, 'controle_estoque') alone already
-- covers every condition the old policy duplicated: master_admin bypass,
-- admin_empresa + same-company check, company_has_operational_access, and
-- company_has_active_module('controle_estoque') - which in turn enforces the
-- 'gestao_materiais' dependency via company_module_dependencies_satisfied
-- (module_dependencies already registers controle_estoque -> gestao_materiais),
-- so the separate direct check for 'gestao_materiais' was also redundant.
--
-- company_has_active_module / company_has_operational_access /
-- company_module_dependencies_satisfied intentionally keep no EXECUTE grant
-- for `authenticated` - this migration does not change that.

DROP POLICY IF EXISTS "Company admins create stock locations" ON public.estoque_localizacoes;
DROP POLICY IF EXISTS "Company admins update stock locations" ON public.estoque_localizacoes;
DROP POLICY IF EXISTS "Company admins delete unused stock locations" ON public.estoque_localizacoes;

CREATE POLICY "Company admins create stock locations"
ON public.estoque_localizacoes FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'controle_estoque')
);

CREATE POLICY "Company admins update stock locations"
ON public.estoque_localizacoes FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'controle_estoque')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'controle_estoque')
);

CREATE POLICY "Company admins delete unused stock locations"
ON public.estoque_localizacoes FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'controle_estoque')
);
