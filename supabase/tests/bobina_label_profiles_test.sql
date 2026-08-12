-- Regression/contract test for 20260811140000_bobina_label_profiles.sql:
-- generic bobina/label-roll profiles (multi-column layout config, decoupled
-- from any specific printer brand) plus the perfil_bobina_padrao_id link on
-- empresa_impressora_config. Mirrors the fixture/role-switching conventions
-- already used by master_set_company_plan_test.sql and
-- material_labels_stage_six_test.sql (auth.users insert -> trigger creates
-- profiles/user_roles rows -> UPDATE them into place, then
-- set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE authenticated to
-- act as a specific user under RLS).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(39);

-- ----------------------------------------------------------------------------
-- 0. FIXTURES: two companies (A, B), each with an admin; a non-admin
--    "usuario" on A; a master_admin. No module fixtures needed - printer
--    configuration (and this extension of it) is administrative, not
--    module-gated, matching empresa_impressora_config's own precedent.
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria)
VALUES ('c1000000-0000-4000-8000-000000000001', '__bobina_test_plan__', 100, 20, 100, true, 'mensal', 'plano_base');

INSERT INTO public.empresas (id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano, status_pagamento, vencimento) VALUES
 ('c2000000-0000-4000-8000-000000000001', 'Bobina Empresa A', 'ativo', 'c1000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
 ('c2000000-0000-4000-8000-000000000002', 'Bobina Empresa B', 'ativo', 'c1000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bobina-admin-a@example.test', '', now(), '{}', '{"full_name":"Bobina Admin A"}', now(), now()),
 ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'bobina-user-a@example.test', '', now(), '{}', '{"full_name":"Bobina User A"}', now(), now()),
 ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'bobina-admin-b@example.test', '', now(), '{}', '{"full_name":"Bobina Admin B"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN ('c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000003');
UPDATE public.profiles SET empresa_id = CASE user_id
 WHEN 'c3000000-0000-4000-8000-000000000001'::uuid THEN 'c2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000002'::uuid THEN 'c2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000003'::uuid THEN 'c2000000-0000-4000-8000-000000000002'::uuid END
WHERE user_id BETWEEN 'c3000000-0000-4000-8000-000000000001' AND 'c3000000-0000-4000-8000-000000000003';

-- ----------------------------------------------------------------------------
-- 1. Schema/hardening smoke checks.
-- ----------------------------------------------------------------------------

SELECT has_table('public', 'empresa_bobina_perfis', 'bobina profile table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.empresa_bobina_perfis'::regclass), 'bobina profiles have RLS enabled');
SELECT has_function('public', 'listar_perfis_bobina', ARRAY['uuid'], 'list facade exists');
SELECT has_function('public', 'duplicar_perfil_bobina', ARRAY['uuid', 'text', 'uuid'], 'duplicate facade exists');
SELECT has_function('public', 'excluir_perfil_bobina', ARRAY['uuid', 'uuid'], 'delete facade exists');
SELECT has_function('public', 'definir_perfil_bobina_padrao', ARRAY['uuid', 'uuid'], 'set-default facade exists');
SELECT has_function('public', 'salvar_perfil_bobina', 'save facade exists (any overload)');
SELECT has_function('public', 'salvar_configuracao_impressora', 'printer config facade exists (any overload)');
SELECT is(
  (SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('listar_perfis_bobina', 'salvar_perfil_bobina', 'duplicar_perfil_bobina', 'excluir_perfil_bobina', 'definir_perfil_bobina_padrao')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint,
  'anon has no execute grant on any bobina profile function'
);
SELECT is(
  (SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('listar_perfis_bobina', 'salvar_perfil_bobina', 'duplicar_perfil_bobina', 'excluir_perfil_bobina', 'definir_perfil_bobina_padrao')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  5::bigint,
  'authenticated can execute all 5 bobina profile functions'
);

-- ----------------------------------------------------------------------------
-- 2. A non-admin "usuario" of company A can read (empty list) but not write.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.listar_perfis_bobina()),
  0::bigint,
  'a plain usuario can list bobina profiles (empty so far) without error'
);
SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('Tentativa', 50, 30)$test$,
  '42501',
  'Somente administradores da empresa configuram perfis de bobina.',
  'a plain usuario cannot create a bobina profile'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. admin_empresa of company A creates a profile.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.salvar_perfil_bobina(
    '50x30 - 2 colunas', 50, 30, 2, 4, 2, 2, 2, 2, 2, 'retrato', 110, 0, 0, 'automatico', NULL, true
  )$test$,
  'admin_empresa can create a 2-column bobina profile that fits its declared media width'
);

RESET ROLE;

SELECT is((SELECT colunas FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), 2, 'colunas was persisted');
SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), true, 'first profile becomes the default');
SELECT is((SELECT empresa_id FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), 'c2000000-0000-4000-8000-000000000001'::uuid, 'profile is scoped to the creating admin''s company');

-- ----------------------------------------------------------------------------
-- 4. Width-fit validation (section 6): 2 columns of 50mm + 4mm gap = 104mm,
--    which does not fit a 90mm media width.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('Excede a bobina', 50, 30, 2, 4, 0, 0, 0, 0, 0, 'retrato', 90)$test$,
  'BB006',
  'a profile whose required width exceeds the declared media width is rejected'
);
SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('Margem negativa', 50, 30, 1, 0, 0, -1, 0, 0, 0)$test$,
  'BB004',
  'As margens não podem ser negativas.',
  'a negative margin is rejected'
);

RESET ROLE;

-- The CHECK constraint is a defense-in-depth backstop, independent of the
-- RPC's own validation - bypass the RPC and INSERT directly (still under
-- admin_empresa's RLS write access) to prove the constraint alone rejects it.
SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$INSERT INTO public.empresa_bobina_perfis (empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, colunas, largura_midia_mm)
    VALUES ('c2000000-0000-4000-8000-000000000001', 'Direto demais', 50, 30, 3, 100)$test$,
  '23514',
  'a direct INSERT bypassing the RPC still hits the width-fit CHECK constraint'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. Default uniqueness: creating a second profile as padrao flips the
--    first one off (partial unique index + RPC bookkeeping).
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.salvar_perfil_bobina('40x30 - 3 colunas', 40, 30, 3, 2, 2, 2, 2, 2, 2, 'retrato', NULL, 0, 0, 'automatico', NULL, true)$test$,
  'admin_empresa can create a second, unconstrained-width 3-column profile as the new default'
);

RESET ROLE;

SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), false, 'the previous default was automatically unset');
SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas'), true, 'the newly created profile is now the default');
SELECT is(
  (SELECT count(*)::bigint FROM public.empresa_bobina_perfis WHERE empresa_id = 'c2000000-0000-4000-8000-000000000001' AND padrao AND ativo),
  1::bigint,
  'exactly one active default profile exists per company'
);

-- ----------------------------------------------------------------------------
-- 6. Duplicate, then set-as-default.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.duplicar_perfil_bobina((SELECT id FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'))$test$,
  'admin_empresa can duplicate an existing profile'
);

RESET ROLE;

SELECT is((SELECT nome FROM public.empresa_bobina_perfis WHERE nome LIKE '50x30 - 2 colunas%' AND nome <> '50x30 - 2 colunas'), '50x30 - 2 colunas (cópia)', 'a duplicate without an explicit name gets the " (cópia)" suffix');
SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas (cópia)'), false, 'a duplicate is never automatically the default');

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.definir_perfil_bobina_padrao((SELECT id FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas (cópia)'))$test$,
  'admin_empresa can promote the duplicate to be the default'
);

RESET ROLE;

SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas (cópia)'), true, 'the duplicate is now the default');
SELECT is((SELECT padrao FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas'), false, 'the previous default was unset by definir_perfil_bobina_padrao');

-- ----------------------------------------------------------------------------
-- 7. Link a printer config to a profile, then delete that profile - the
--    link must clear itself (soft delete never triggers ON DELETE SET NULL).
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora(
    'etiqueta', 'LABEL-A', '50x30mm', 50, 30, 'retrato', true, '{}'::jsonb,
    (SELECT id FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas')
  )$test$,
  'admin_empresa can link the etiqueta printer config to a bobina profile'
);

RESET ROLE;

SELECT is(
  (SELECT perfil_bobina_padrao_id FROM public.empresa_impressora_config WHERE empresa_id = 'c2000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta'),
  (SELECT id FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas'),
  'obter_configuracoes_impressora would return the linked profile id'
);

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.excluir_perfil_bobina((SELECT id FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas'))$test$,
  'admin_empresa can delete (soft) the profile currently linked to a printer'
);

RESET ROLE;

SELECT is((SELECT ativo FROM public.empresa_bobina_perfis WHERE nome = '40x30 - 3 colunas'), false, 'the deleted profile is now inactive (soft delete, row preserved)');
SELECT is(
  (SELECT perfil_bobina_padrao_id FROM public.empresa_impressora_config WHERE empresa_id = 'c2000000-0000-4000-8000-000000000001' AND finalidade = 'etiqueta'),
  NULL::uuid,
  'deleting a linked profile clears perfil_bobina_padrao_id on the printer config instead of leaving a dangling reference'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.empresa_bobina_perfis WHERE empresa_id = 'c2000000-0000-4000-8000-000000000001' AND ativo),
  2::bigint,
  'the soft-deleted profile no longer counts as active (2 remain: the 2-column original and its now-default copy)'
);

-- ----------------------------------------------------------------------------
-- 8. Cross-tenant isolation: company B cannot see or touch company A's profiles.
-- ----------------------------------------------------------------------------

-- Captured as a transaction-local GUC (persists across SET LOCAL ROLE, only
-- transaction-scoped) while still able to see the row, i.e. before switching
-- to admin_b - resolving the id via a subquery *as admin_b* below would
-- silently return NULL instead (RLS hides company A's row from company B),
-- which would make the throws_ok calls pass for the wrong reason.
SELECT set_config('test.company_a_profile_id', (SELECT id::text FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), true);

SELECT set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.listar_perfis_bobina()),
  0::bigint,
  'company B''s admin sees no profiles at all (none of company A''s leak through)'
);
SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina('Roubo', 50, 30, 1, 0, 0, 0, 0, 0, 0, 'retrato', NULL, 0, 0, 'automatico', NULL, false,
    current_setting('test.company_a_profile_id')::uuid)$test$,
  'BB007',
  'Perfil de bobina não encontrado.',
  'company B''s admin cannot edit company A''s profile by id'
);
SELECT throws_ok(
  $test$SELECT public.excluir_perfil_bobina(current_setting('test.company_a_profile_id')::uuid)$test$,
  'BB007',
  'Perfil de bobina não encontrado.',
  'company B''s admin cannot delete company A''s profile by id'
);

RESET ROLE;

SELECT is((SELECT ativo FROM public.empresa_bobina_perfis WHERE nome = '50x30 - 2 colunas'), true, 'company A''s profile is untouched by company B''s failed attempts');

SELECT * FROM finish();
ROLLBACK;
