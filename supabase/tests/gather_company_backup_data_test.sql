-- Regression coverage for public.gather_company_backup_data
-- (20260818120000_extend_operational_core_backup.sql), the SECURITY
-- DEFINER RPC added to fix a real gap found while building P1-10B:
-- gatherBackupData used to read every backup collection through the
-- normal Supabase client under standard RLS, and every one of those SELECT
-- policies is gated by can_read_company_module/company_has_active_module -
-- so a company whose module lapsed or was deactivated after the data was
-- created would have that table silently omitted from its own backup.
--
-- This suite does not re-test restore_company_backup's own restore logic
-- (covered by atomic_company_backup_restore_test.sql,
-- extend_company_backup_coverage_test.sql and
-- extend_operational_core_backup_test.sql) beyond a single end-to-end
-- round-trip proving the two functions still agree on shape.
--
-- NOTE: this suite was authored and reviewed statically but NOT executed -
-- this environment has no local Postgres/Docker/pgTAP runtime (same
-- constraint noted throughout this repo's other pgTAP suites, see
-- docs/stage-2-5-concurrency-validation.md). Run with
-- `supabase test db --linked` (or an equivalent local Postgres) before
-- relying on it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(13);

-- A dedicated, non-lifetime plan: company_has_lifetime_subscription (and
-- therefore company_has_active_module's own lifetime bypass) must be false
-- for this suite's companies, or deactivating a module below would not
-- actually change anything and scenario 2/6 would test nothing.
INSERT INTO public.planos (id, nome, valor, periodicidade, ativo)
VALUES ('b8100000-0000-4000-8000-000000000001', '__gather_backup_data_test_plan__', 99, 'mensal', true);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES
  ('b8000000-0000-4000-8000-000000000001', '__gather_backup_data_a__',
   'ativo', 'b8100000-0000-4000-8000-000000000001', false, false, 'pago', NULL, NULL),
  ('b8000000-0000-4000-8000-000000000002', '__gather_backup_data_b__',
   'ativo', 'b8100000-0000-4000-8000-000000000001', false, false, 'pago', NULL, NULL);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b8200000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'gather-backup-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Gather Backup Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b8200000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'gather-backup-common-a@example.test', '', now(),
   '{}', '{"full_name":"Gather Backup Common A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b8200000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'gather-backup-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Gather Backup Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'b8000000-0000-4000-8000-000000000001'
WHERE user_id IN ('b8200000-0000-4000-8000-000000000001', 'b8200000-0000-4000-8000-000000000002');
UPDATE public.profiles SET empresa_id = 'b8000000-0000-4000-8000-000000000002'
WHERE user_id = 'b8200000-0000-4000-8000-000000000003';

DELETE FROM public.user_roles WHERE user_id IN (
  'b8200000-0000-4000-8000-000000000001',
  'b8200000-0000-4000-8000-000000000002',
  'b8200000-0000-4000-8000-000000000003'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b8200000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b8200000-0000-4000-8000-000000000002', 'usuario'),
  ('b8200000-0000-4000-8000-000000000003', 'admin_empresa');

-- gestao_materiais/controle_estoque gate estoque_localizacoes' own SELECT
-- policy (public.can_read_company_module(empresa_id,'controle_estoque')
-- AND public.company_has_active_module(empresa_id,'gestao_materiais'),
-- see stock_control_stage_two.sql:1191-1195). Company A starts with both
-- active - this is the table used to prove scenarios 1/2/6.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at)
SELECT 'b8000000-0000-4000-8000-000000000001', catalog.id, 'active', now()
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES ('b8300000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'GB-LOC', 'Depósito A');
INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES ('b8300000-0000-4000-8000-000000000099', 'b8000000-0000-4000-8000-000000000002', 'GB-LOC-B', 'Depósito B');

-- ---------------------------------------------------------------------
-- 1-4. Module active: the RPC returns company A's data, scoped to company
--    A only, and a direct client-side SELECT (real RLS, no bypass) agrees.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001')$test$,
  'gather_company_backup_data succeeds for an admin of the company while the module is active'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT jsonb_array_length(public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001') -> 'estoque_localizacoes')),
  1, 'with the module active, the RPC returns company A''s one estoque_localizacoes row'
);
SELECT is(
  (SELECT (public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001') -> 'estoque_localizacoes' -> 0 ->> 'id')),
  'b8300000-0000-4000-8000-000000000001',
  'the returned row is company A''s, not company B''s'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.estoque_localizacoes WHERE empresa_id = 'b8000000-0000-4000-8000-000000000001'),
  1::bigint,
  'baseline: a direct client-side SELECT (real RLS) also sees the row while the module is active'
);
RESET ROLE;

-- ---------------------------------------------------------------------
-- Deactivate gestao_materiais for company A. company_has_active_module's
-- lifetime-subscription branch does not apply (company A's plan is
-- 'mensal'), so this genuinely turns the module off.
-- ---------------------------------------------------------------------
UPDATE public.empresa_modules AS em
SET status = 'cancelled'
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'b8000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key = 'gestao_materiais';

-- ---------------------------------------------------------------------
-- 5-6. Module deactivated: this is the bug being fixed. RLS itself must
--    still block the normal read path (proving no policy was loosened);
--    the RPC must still return the company's historical data.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.estoque_localizacoes WHERE empresa_id = 'b8000000-0000-4000-8000-000000000001'),
  0::bigint,
  'with gestao_materiais deactivated, the normal RLS-gated read now sees nothing - no policy was loosened by this migration'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001')$test$,
  'gather_company_backup_data still succeeds after the module is deactivated'
);
SELECT is(
  (SELECT jsonb_array_length(public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001') -> 'estoque_localizacoes')),
  1,
  'with gestao_materiais deactivated, the RPC still returns the company''s historical estoque_localizacoes row - the fix'
);
RESET ROLE;

-- ---------------------------------------------------------------------
-- 7. A collection the company genuinely has zero rows in comes back as an
--    empty array, not an error (manutencao_ordens: no fixture rows exist
--    for company A anywhere in this suite).
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001') -> 'manutencao_ordens'),
  '[]'::jsonb,
  'a collection the company has no rows in returns an empty array, not an error'
);
RESET ROLE;

-- ---------------------------------------------------------------------
-- 8. A non-admin authenticated member of company A cannot call the RPC at
--    all, for their own company, regardless of module state.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Only a company administrator can read backup data',
  'a non-admin company member cannot read backup data even for their own company'
);
RESET ROLE;

-- ---------------------------------------------------------------------
-- 9. Company B's data was never touched by any of the above, and an admin
--    of company A cannot request company B's data by passing its id.
-- ---------------------------------------------------------------------
SELECT is(
  (SELECT count(*) FROM public.estoque_localizacoes WHERE id = 'b8300000-0000-4000-8000-000000000099'),
  1::bigint, 'company B''s row is untouched by any of company A''s scenarios above'
);

SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.gather_company_backup_data('b8000000-0000-4000-8000-000000000002')$test$,
  '42501',
  'Backup data can only be read for the authenticated user company',
  'an admin of company A cannot request company B''s data by passing its empresa_id - the argument is asserted, not trusted'
);
RESET ROLE;

-- ---------------------------------------------------------------------
-- 10. End-to-end: the RPC's own output, wrapped exactly as
--    buildBackupPayload would, is accepted by restore_company_backup for
--    the same company - the 1.2 gather path and the 1.2 restore path
--    still agree on shape.
-- ---------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'test.round_trip_payload',
  (
    SELECT jsonb_build_object(
      'versao', '1.2',
      'sistema', 'Backstage Pro',
      'meta', jsonb_build_object(
        'empresa_id', 'b8000000-0000-4000-8000-000000000001',
        'tipo', 'manual', 'data_backup', '2026-08-18T15:00:00Z'
      ),
      'data', public.gather_company_backup_data('b8000000-0000-4000-8000-000000000001')
    )::text
  ),
  true
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'b8200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b8000000-0000-4000-8000-000000000001', current_setting('test.round_trip_payload')::jsonb
  )$test$,
  'restore_company_backup accepts gather_company_backup_data''s own output unmodified'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.estoque_localizacoes WHERE id = 'b8300000-0000-4000-8000-000000000001'),
  1::bigint,
  'the gathered-then-restored row round-trips correctly'
);

SELECT * FROM finish();
ROLLBACK;
