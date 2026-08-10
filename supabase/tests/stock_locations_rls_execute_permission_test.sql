BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(11);

-- estoque_localizacoes write policies must rely only on the canonical
-- SECURITY DEFINER wrapper, never on the private helpers directly - those
-- helpers have no EXECUTE grant for `authenticated` and calling them from a
-- policy (evaluated as the querying role, not the wrapper's owner) raises
-- "permission denied for function ..." regardless of the user's actual
-- entitlements. See 20260806060000_fix_stock_locations_rls_execute_permission.sql.

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_module%'
  ),
  'stock location INSERT uses the canonical write wrapper'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'INSERT'
      AND (
        with_check ILIKE '%company_has_active_module(%'
        OR with_check ILIKE '%company_has_operational_access(%'
      )
  ),
  'stock location INSERT does not call the private helpers directly'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'UPDATE'
      AND qual ILIKE '%can_write_company_module%'
      AND with_check ILIKE '%can_write_company_module%'
  ),
  'stock location UPDATE uses the canonical write wrapper'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'UPDATE'
      AND (
        qual ILIKE '%company_has_active_module(%'
        OR qual ILIKE '%company_has_operational_access(%'
        OR with_check ILIKE '%company_has_active_module(%'
        OR with_check ILIKE '%company_has_operational_access(%'
      )
  ),
  'stock location UPDATE does not call the private helpers directly'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'DELETE'
      AND qual ILIKE '%can_write_company_module%'
  ),
  'stock location DELETE uses the canonical write wrapper'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'DELETE'
      AND (
        qual ILIKE '%company_has_active_module(%'
        OR qual ILIKE '%company_has_operational_access(%'
      )
  ),
  'stock location DELETE does not call the private helpers directly'
);

-- Regression guard: the SELECT policy was already canonical before this fix
-- and must stay that way.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'estoque_localizacoes'
      AND cmd = 'SELECT'
      AND qual ILIKE '%can_read_company_module%'
      AND qual NOT ILIKE '%company_has_active_module(%'
      AND qual NOT ILIKE '%company_has_operational_access(%'
  ),
  'stock location SELECT remains canonical (unaffected by this fix)'
);

-- Contract: the private helpers stay private. This migration must not grant
-- EXECUTE on them to `authenticated` as a shortcut.
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.company_has_active_module(uuid, text)',
    'EXECUTE'
  ),
  'company_has_active_module keeps no EXECUTE grant for authenticated'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.company_has_operational_access(uuid)',
    'EXECUTE'
  ),
  'company_has_operational_access keeps no EXECUTE grant for authenticated'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.company_module_dependencies_satisfied(uuid, uuid)',
    'EXECUTE'
  ),
  'company_module_dependencies_satisfied keeps no EXECUTE grant for authenticated'
);

-- Sanity: the wrappers this fix relies on must remain executable.
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.can_write_company_module(uuid, text)',
    'EXECUTE'
  ),
  'can_write_company_module keeps its EXECUTE grant for authenticated'
);

SELECT * FROM finish();

ROLLBACK;
