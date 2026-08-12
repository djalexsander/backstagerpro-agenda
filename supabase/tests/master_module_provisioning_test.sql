-- Regression test for the Master panel "editar/criar empresa" ->
-- "permission denied for function provision_company_module_entitlements"
-- bug fixed by 20260811090000_secure_master_module_provisioning.sql.
--
-- public.provision_company_module_entitlements(uuid) is intentionally
-- unreachable by anon/authenticated/service_role since 20260808110000 (it
-- takes a raw _empresa_id with no auth check, so its only legitimate caller
-- is the nested AFTER INSERT trigger). src/pages/master/Empresas.tsx calls a
-- module-provisioning RPC directly as the authenticated master user on both
-- create and edit, so it needs its own gated entry point - this proves that
-- entry point (public.master_provision_company_module_entitlements) rejects
-- non-master callers and anon outright, while a real master_admin can use it
-- to backfill empresa_modules rows, idempotently, without ever regranting
-- the internal helper.
--
-- The backfill assertions specifically cover a module_catalog entry added
-- AFTER the company already exists: trg_provision_company_module_entitlements
-- _on_company_insert only provisions entitlements for modules active at
-- INSERT time, so a naive test that only checks totals after company
-- creation would pass even if the wrapper's PERFORM never ran, because the
-- insert trigger already did the work. Module
-- 'e3000000-0000-4000-8000-000000000001' is created after the company row
-- specifically to prove the wrapper - not the trigger - is what backfills it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(10);

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES (
  'e1000000-0000-4000-8000-000000000001', '__master_provisioning_company__',
  'ativo', NULL, false, true, 'pago', now() + interval '30 days'
);

-- Added after the company already exists, so the AFTER INSERT trigger on
-- public.empresas never provisions an entitlement row for it.
INSERT INTO public.module_catalog (
  id, nome, feature_key, ativo, tipo_modulo
) VALUES (
  'e3000000-0000-4000-8000-000000000001', '__master_provisioning_test_module__',
  'master_provisioning_test_module', true, 'addon'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = 'e1000000-0000-4000-8000-000000000001'
      AND module_id = 'e3000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a module_catalog entry added after the company exists has no entitlement row yet'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'provisioning-admin@example.test', '', now(),
   '{}', '{"full_name":"Provisioning Test Admin Empresa"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'provisioning-master@example.test', '', now(),
   '{}', '{"full_name":"Provisioning Test Master"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = 'e2000000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'e2000000-0000-4000-8000-000000000002';

-- ----------------------------------------------------------------------------
-- 1. anon has no grant at all on the wrapper.
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.master_provision_company_module_entitlements(uuid)', 'EXECUTE'
  ),
  'anon cannot execute master_provision_company_module_entitlements'
);

-- ----------------------------------------------------------------------------
-- 2. The internal helper stays locked down (no regression on 20260808110000).
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.provision_company_module_entitlements(uuid)', 'EXECUTE'
  ),
  'the internal provisioning helper is still unreachable by authenticated'
);

-- ----------------------------------------------------------------------------
-- 3. A non-master authenticated user (e.g. an admin_empresa, same role the
--    master panel itself never runs as) is rejected by the wrapper's own
--    is_master_admin check, not by a bare grant failure.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_provision_company_module_entitlements('e1000000-0000-4000-8000-000000000001')$test$,
  'P0001',
  'Only a global master administrator can provision company module entitlements',
  'a non-master authenticated user cannot provision module entitlements for any company'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. A real master_admin can provision entitlements for the company, and it
--    backfills exactly one empresa_modules row per active module_catalog
--    entry, all left inactive (never auto-granting a paid module).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_provision_company_module_entitlements('e1000000-0000-4000-8000-000000000001')$test$,
  'a master_admin can provision module entitlements through the wrapper'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  (SELECT count(*) FROM public.module_catalog WHERE ativo = true),
  'one empresa_modules row was backfilled per active catalog module'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = 'e1000000-0000-4000-8000-000000000001'
      AND module_id = 'e3000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the wrapper backfilled the entitlement for the module added after company creation'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = 'e1000000-0000-4000-8000-000000000001'
      AND status = 'active'
  ),
  0::bigint,
  'no module was auto-activated by the provisioning wrapper'
);

-- ----------------------------------------------------------------------------
-- 5. Idempotent on repeat calls (matches Empresas.tsx calling it on every
--    edit save, not just once at creation).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.master_provision_company_module_entitlements('e1000000-0000-4000-8000-000000000001')$test$,
  'calling the wrapper again on the same company does not fail'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  (SELECT count(*) FROM public.module_catalog WHERE ativo = true),
  'repeat provisioning does not duplicate empresa_modules rows'
);

SELECT * FROM finish();

ROLLBACK;
