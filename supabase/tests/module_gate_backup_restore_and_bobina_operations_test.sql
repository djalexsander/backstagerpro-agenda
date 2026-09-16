-- Regression coverage for the P0 module-gating fix (migration
-- 20260914090000_module_gate_backup_restore_and_bobina_operations.sql,
-- see AUDITORIA_MODULOS_OPCIONAIS.md for the audit that found the gap).
--
-- Two things are verified end-to-end against real gather_company_backup_data
-- -> restore_company_backup round trips (not hand-built JSON, to avoid ever
-- testing a payload shape restore_company_backup would not actually accept
-- in production):
--
--   A) restore_company_backup: a company without gestao_materiais/
--      etiquetas_materiais active does not get materiais/categorias_
--      materiais/empresa_impressora_config(finalidade='etiqueta') restored,
--      while core collections (events/event_days/event_files/financials)
--      and empresa_impressora_config(finalidade='documento') are restored
--      exactly as before. The same payload restores those sections once the
--      modules are active again. A linked master_admin gets no special
--      bypass of this rule (same as everywhere else company_has_active_
--      module is used in this backend).
--
--   B) salvar_perfil_bobina/duplicar_perfil_bobina/excluir_perfil_bobina/
--      definir_perfil_bobina_padrao/salvar_configuracao_impressora(finalidade
--      ='etiqueta') and the empresa_bobina_perfis write policy all require
--      etiquetas_materiais to be active; salvar_configuracao_impressora for
--      finalidade IN ('cupom','documento') is unaffected either way. A
--      linked master_admin gets no special bypass here either.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(29);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

-- Non-lifetime plan: company_has_lifetime_subscription's bypass must be
-- false for this suite's companies, or deactivating a module below would
-- not actually change anything (same requirement documented in
-- gather_company_backup_data_test.sql).
INSERT INTO public.planos (id, nome, valor, periodicidade, ativo, categoria)
VALUES ('c9100000-0000-4000-8000-000000000001', '__p0_module_gate_test_plan__', 99, 'mensal', true, 'plano_base')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES
  ('c9000000-0000-4000-8000-000000000001', '__p0_module_gate_c1__',
   'ativo', 'c9100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days', NULL),
  ('c9000000-0000-4000-8000-000000000002', '__p0_module_gate_c2__',
   'ativo', 'c9100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days', NULL);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'c9200000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'p0-mg-admin-c1@example.test', '', now(), '{}',
   '{"full_name":"P0 MG Admin C1"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c9200000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'p0-mg-master@example.test', '', now(), '{}',
   '{"full_name":"P0 MG Master"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c9200000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'p0-mg-admin-c2@example.test', '', now(), '{}',
   '{"full_name":"P0 MG Admin C2"}', now(), now());

UPDATE public.profiles
SET empresa_id = 'c9000000-0000-4000-8000-000000000001', ativado = true, activated_at = now()
WHERE user_id = 'c9200000-0000-4000-8000-000000000001';
UPDATE public.profiles
SET empresa_id = 'c9000000-0000-4000-8000-000000000001', ativado = true, activated_at = now()
WHERE user_id = 'c9200000-0000-4000-8000-000000000002';
UPDATE public.profiles
SET empresa_id = 'c9000000-0000-4000-8000-000000000002', ativado = true, activated_at = now()
WHERE user_id = 'c9200000-0000-4000-8000-000000000003';

DELETE FROM public.user_roles WHERE user_id IN (
  'c9200000-0000-4000-8000-000000000001',
  'c9200000-0000-4000-8000-000000000002',
  'c9200000-0000-4000-8000-000000000003'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c9200000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('c9200000-0000-4000-8000-000000000002', 'master_admin'),
  ('c9200000-0000-4000-8000-000000000003', 'admin_empresa');

-- ===========================================================================
-- SECTION A - restore_company_backup
-- ===========================================================================

-- A1. Activate gestao_materiais + etiquetas_materiais for C1 so a realistic
-- payload (materiais + an 'etiqueta' printer config) can be captured.
UPDATE public.empresa_modules AS em SET status = 'active', activated_at = now()
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key IN ('gestao_materiais', 'etiquetas_materiais');

INSERT INTO public.events (
  id, date, status, name, artist, city, venue, created_by, empresa_id
) VALUES (
  'c9300000-0000-4000-8000-000000000001', '2026-10-01', 'confirmado',
  'P0 MG Event', 'P0 Artist', 'P0 City', 'P0 Venue',
  'c9200000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001'
);
INSERT INTO public.event_days (id, event_id, day_number, date, empresa_id) VALUES (
  'c9400000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001',
  1, '2026-10-01', 'c9000000-0000-4000-8000-000000000001'
);
INSERT INTO public.event_files (
  id, event_id, event_day_id, file_type, file_path, file_name, empresa_id
) VALUES (
  'c9500000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001',
  'c9400000-0000-4000-8000-000000000001', 'artist_rider', 'c9/p0.pdf', 'p0.pdf',
  'c9000000-0000-4000-8000-000000000001'
);
INSERT INTO public.financials (id, event_id, cache, empresa_id) VALUES (
  'c9600000-0000-4000-8000-000000000001', 'c9300000-0000-4000-8000-000000000001',
  500, 'c9000000-0000-4000-8000-000000000001'
);

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES (
  'c9700000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'P0 Categoria'
);
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle
) VALUES (
  'c9800000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001',
  'c9700000-0000-4000-8000-000000000001', 'P0-MAT-001', 'P0 Material', 'individual'
);
INSERT INTO public.empresa_impressora_config (id, empresa_id, finalidade, nome_impressora) VALUES
  ('c9900000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'documento', 'P0 Impressora Documento'),
  ('c9900000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'etiqueta', 'P0 Impressora Etiqueta');

-- A2. Capture a real payload via gather_company_backup_data while both
-- modules are active, as C1's own admin (not postgres/superuser), so the
-- captured shape is exactly what restore_company_backup will later receive
-- from the real client.
SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE p0_mg_payload AS
SELECT jsonb_build_object(
  'meta', jsonb_build_object(
    'tipo', 'manual', 'empresa_id', 'c9000000-0000-4000-8000-000000000001',
    'data_backup', now()
  ),
  'data', public.gather_company_backup_data('c9000000-0000-4000-8000-000000000001')
) AS payload;
RESET ROLE;

SELECT ok(
  (SELECT payload -> 'data' -> 'materiais' IS NOT NULL FROM p0_mg_payload),
  'captured payload actually contains the materiais collection (sanity on the fixture itself)'
);

-- A3. Deactivate both modules, then delete the module-owned rows so the
-- restore's effect (skip vs. restore) is observable rather than a no-op
-- upsert of identical data.
UPDATE public.empresa_modules AS em SET status = 'inactive'
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key IN ('gestao_materiais', 'etiquetas_materiais');

DELETE FROM public.materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001';
DELETE FROM public.categorias_materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001';
DELETE FROM public.empresa_impressora_config
WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta';

-- A4. Restore as C1's admin while both modules are inactive.
SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'c9000000-0000-4000-8000-000000000001',
    (SELECT payload FROM p0_mg_payload)
  )$test$,
  'restore succeeds even though gestao_materiais/etiquetas_materiais are inactive (core still restorable)'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = 'c9300000-0000-4000-8000-000000000001'),
  1, 'core: the event was restored while its owning modules were inactive'
);
SELECT is(
  (SELECT cache::int FROM public.financials WHERE event_id = 'c9300000-0000-4000-8000-000000000001'),
  500, 'core: financials was restored while gestao_materiais/etiquetas_materiais were inactive'
);
SELECT is(
  (SELECT count(*)::int FROM public.materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001'),
  0, 'P0 fix: materiais was NOT restored while gestao_materiais is inactive'
);
SELECT is(
  (SELECT count(*)::int FROM public.categorias_materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001'),
  0, 'P0 fix: categorias_materiais was NOT restored while gestao_materiais is inactive'
);
SELECT is(
  (SELECT count(*)::int FROM public.empresa_impressora_config
   WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta'),
  0, 'P0 fix: empresa_impressora_config(etiqueta) was NOT restored while etiquetas_materiais is inactive'
);
SELECT is(
  (SELECT count(*)::int FROM public.empresa_impressora_config
   WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'documento'),
  1, 'unaffected: empresa_impressora_config(documento) is untouched by etiquetas_materiais status'
);

-- A5. Re-activate both modules and restore the SAME payload again - the
-- previously-skipped sections must now come back.
UPDATE public.empresa_modules AS em SET status = 'active', activated_at = now()
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key IN ('gestao_materiais', 'etiquetas_materiais');

SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'c9000000-0000-4000-8000-000000000001',
    (SELECT payload FROM p0_mg_payload)
  )$test$,
  'restoring the same payload again succeeds once the modules are active'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001'),
  1, 'materiais is restored once gestao_materiais is active again'
);
SELECT is(
  (SELECT count(*)::int FROM public.categorias_materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001'),
  1, 'categorias_materiais is restored once gestao_materiais is active again'
);
SELECT is(
  (SELECT count(*)::int FROM public.empresa_impressora_config
   WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta'),
  1, 'empresa_impressora_config(etiqueta) is restored once etiquetas_materiais is active again'
);

-- A6. No master_admin bypass: deactivate again, delete the module-owned
-- rows again, restore as the linked master_admin instead of the admin.
UPDATE public.empresa_modules AS em SET status = 'inactive'
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key IN ('gestao_materiais', 'etiquetas_materiais');

DELETE FROM public.materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001';
DELETE FROM public.categorias_materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001';
DELETE FROM public.empresa_impressora_config
WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta';

SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'c9000000-0000-4000-8000-000000000001',
    (SELECT payload FROM p0_mg_payload)
  )$test$,
  'a linked master_admin can still restore the core while modules are inactive'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.materiais WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001'),
  0, 'P0 fix, no master bypass: materiais stays unrestored for a linked master_admin when gestao_materiais is inactive'
);
SELECT is(
  (SELECT count(*)::int FROM public.empresa_impressora_config
   WHERE empresa_id = 'c9000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta'),
  0, 'P0 fix, no master bypass: empresa_impressora_config(etiqueta) stays unrestored for a linked master_admin'
);

-- ===========================================================================
-- SECTION B - bobina/printer RPCs and the empresa_bobina_perfis policy
-- ===========================================================================
-- C2 starts with every module at its default 'inactive' placeholder status.

-- B1. admin_empresa on C2, module inactive: all 5 bobina/etiqueta-printer
-- writes are denied with the module error code.
SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('P0 Perfil', 40, 20)$test$,
  'LB009', 'O módulo Etiquetas e Impressão não está ativo para esta empresa.',
  'salvar_perfil_bobina denied while etiquetas_materiais is inactive'
);
SELECT throws_ok(
  $test$SELECT public.salvar_configuracao_impressora('etiqueta', 'P0 Impressora Etq')$test$,
  'LB009', 'O módulo Etiquetas e Impressão não está ativo para esta empresa.',
  'salvar_configuracao_impressora(etiqueta) denied while etiquetas_materiais is inactive'
);
SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora('documento', 'P0 Impressora Doc')$test$,
  'salvar_configuracao_impressora(documento) is unaffected by etiquetas_materiais status'
);
SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora('cupom', 'P0 Impressora Cupom')$test$,
  'salvar_configuracao_impressora(cupom) is unaffected by etiquetas_materiais status'
);
RESET ROLE;

-- B2. Direct table write (bypassing every RPC) must also be denied by the
-- updated RLS policy, not just the RPCs.
SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
-- 2-arg form (sqlstate only): pgTAP's 3-arg (sql, text, text) overload
-- matches an expected MESSAGE, not a description, so a 3rd positional
-- string here would be compared against the actual error text instead of
-- labeling the assertion.
SELECT throws_ok(
  $test$INSERT INTO public.empresa_bobina_perfis (
    id, empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, created_by, updated_by
  ) VALUES (
    'c9a00000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002',
    'P0 Direct Insert', 40, 20,
    'c9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-000000000003'
  )$test$,
  '42501'
);
RESET ROLE;

-- B3. Activate gestao_materiais + etiquetas_materiais for C2: everything
-- above must now succeed, including the direct table write.
UPDATE public.empresa_modules AS em SET status = 'active', activated_at = now()
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000002'
  AND em.module_id = catalog.id
  AND catalog.feature_key IN ('gestao_materiais', 'etiquetas_materiais');

SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.salvar_perfil_bobina('P0 Perfil', 40, 20, _padrao := true)$test$,
  'salvar_perfil_bobina succeeds once etiquetas_materiais is active'
);
SELECT lives_ok(
  $test$SELECT public.duplicar_perfil_bobina(
    (SELECT id FROM public.empresa_bobina_perfis WHERE empresa_id = 'c9000000-0000-4000-8000-000000000002' AND nome = 'P0 Perfil')
  )$test$,
  'duplicar_perfil_bobina succeeds once etiquetas_materiais is active'
);
SELECT lives_ok(
  $test$SELECT public.definir_perfil_bobina_padrao(
    (SELECT id FROM public.empresa_bobina_perfis WHERE empresa_id = 'c9000000-0000-4000-8000-000000000002' AND nome = 'P0 Perfil (cópia)')
  )$test$,
  'definir_perfil_bobina_padrao succeeds once etiquetas_materiais is active'
);
SELECT lives_ok(
  $test$SELECT public.excluir_perfil_bobina(
    (SELECT id FROM public.empresa_bobina_perfis WHERE empresa_id = 'c9000000-0000-4000-8000-000000000002' AND nome = 'P0 Perfil')
  )$test$,
  'excluir_perfil_bobina succeeds once etiquetas_materiais is active'
);
SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora('etiqueta', 'P0 Impressora Etq 2')$test$,
  'salvar_configuracao_impressora(etiqueta) succeeds once etiquetas_materiais is active'
);
SELECT lives_ok(
  $test$INSERT INTO public.empresa_bobina_perfis (
    id, empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, created_by, updated_by
  ) VALUES (
    'c9a00000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002',
    'P0 Direct Insert', 40, 20,
    'c9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-000000000003'
  )$test$,
  'direct INSERT into empresa_bobina_perfis succeeds once etiquetas_materiais is active'
);
RESET ROLE;

-- B4. No master_admin bypass: relink the master user to C2, deactivate the
-- module, confirm master is denied exactly like admin_empresa was.
-- request.jwt.claim.sub is transaction-scoped (set_config(..., true)) and
-- survives RESET ROLE, so it is still admin C2's id from section B1/B2/B3
-- at this point - clear it first so protect_profile_empresa_assignment
-- sees auth.uid() IS NULL (trusted server flow) instead of incorrectly
-- treating this administrative relink as a non-master user's own attempt to
-- change profiles.empresa_id.
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.profiles
SET empresa_id = 'c9000000-0000-4000-8000-000000000002', ativado = true, activated_at = now()
WHERE user_id = 'c9200000-0000-4000-8000-000000000002';

UPDATE public.empresa_modules AS em SET status = 'inactive'
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000002'
  AND em.module_id = catalog.id
  AND catalog.feature_key = 'etiquetas_materiais';

SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('P0 Perfil Master', 40, 20)$test$,
  'LB009', 'O módulo Etiquetas e Impressão não está ativo para esta empresa.',
  'P0 fix, no master bypass: a linked master_admin is denied when etiquetas_materiais is inactive'
);
RESET ROLE;

-- B5. Re-activate: the same linked master_admin succeeds again (the module
-- check is a real gate, not an accidental blanket deny).
UPDATE public.empresa_modules AS em SET status = 'active', activated_at = now()
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'c9000000-0000-4000-8000-000000000002'
  AND em.module_id = catalog.id
  AND catalog.feature_key = 'etiquetas_materiais';

SELECT set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.salvar_perfil_bobina('P0 Perfil Master', 40, 20)$test$,
  'a linked master_admin succeeds again once etiquetas_materiais is active'
);
RESET ROLE;

-- B6. Sanity: anon still cannot reach any of these RPCs (grants untouched).
SET LOCAL ROLE anon;
SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('anon', 40, 20)$test$,
  '42501'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
