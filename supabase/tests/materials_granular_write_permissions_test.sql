-- ============================================================================
-- MATERIAIS - PERMISSAO GRANULAR DE ESCRITA (RLS DIRETA, NAO RPC)
-- ============================================================================
--
-- Cobre 20260911140000_materials_granular_write_permissions.sql: as
-- policies de INSERT/UPDATE/DELETE em materiais/categorias_materiais/
-- materiais_fotos passam a aceitar can_write_company_module(...) OR o
-- user_has_module_action(...) especifico da acao (create/edit/delete). Ao
-- contrario dos outros 4 modulos desta leva, Materiais escreve direto via
-- PostgREST (RLS), nao via RPC - as assercoes abaixo exercitam
-- INSERT/UPDATE/DELETE diretamente. Nao reexercita as regras de negocio de
-- materiais em si (unicidade de codigo, trigger de justificativa de status)
-- - isso ja e coberto por materials_rls_identification_test.sql e
-- materials_inventory_test.sql. Fixture minima e propria (prefixo 84).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '84100000-0000-4000-8000-000000000001', '__mggwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '84200000-0000-4000-8000-000000000001', '__mggwp_company__', 'ativo',
  '84100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
),(
  '84200000-0000-4000-8000-000000000002', '__mggwp_company_b__', 'ativo',
  '84100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mggwp-admin@example.test', '', now(), '{}', '{"full_name":"MGGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mggwp-nogrant@example.test', '', now(), '{}', '{"full_name":"MGGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mggwp-create@example.test', '', now(), '{}', '{"full_name":"MGGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mggwp-edit@example.test', '', now(), '{}', '{"full_name":"MGGWP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'mggwp-delete@example.test', '', now(), '{}', '{"full_name":"MGGWP Delete"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'mggwp-crosstenant@example.test', '', now(), '{}', '{"full_name":"MGGWP CrossTenant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'mggwp-master@example.test', '', now(), '{}', '{"full_name":"MGGWP Master"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id IN (
  '84300000-0000-4000-8000-000000000001', '84300000-0000-4000-8000-000000000006'
);
UPDATE public.user_roles SET role = 'usuario' WHERE user_id IN (
  '84300000-0000-4000-8000-000000000002',
  '84300000-0000-4000-8000-000000000003',
  '84300000-0000-4000-8000-000000000004',
  '84300000-0000-4000-8000-000000000005'
);
UPDATE public.user_roles SET role = 'master_admin' WHERE user_id = '84300000-0000-4000-8000-000000000007';

UPDATE public.profiles SET empresa_id = '84200000-0000-4000-8000-000000000001',
  ativado = true, activated_at = now()
WHERE user_id IN (
  '84300000-0000-4000-8000-000000000001',
  '84300000-0000-4000-8000-000000000002',
  '84300000-0000-4000-8000-000000000003',
  '84300000-0000-4000-8000-000000000004',
  '84300000-0000-4000-8000-000000000005'
);
UPDATE public.profiles SET empresa_id = '84200000-0000-4000-8000-000000000002',
  ativado = true, activated_at = now()
WHERE user_id = '84300000-0000-4000-8000-000000000006';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = '84300000-0000-4000-8000-000000000007';

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '84200000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais');

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('84200000-0000-4000-8000-000000000001', '84300000-0000-4000-8000-000000000003', 'gestao_materiais', true, true, false, false),
  ('84200000-0000-4000-8000-000000000001', '84300000-0000-4000-8000-000000000004', 'gestao_materiais', true, false, true, false),
  ('84200000-0000-4000-8000-000000000001', '84300000-0000-4000-8000-000000000005', 'gestao_materiais', true, false, false, true);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES
  ('84400000-0000-4000-8000-000000000001', '84200000-0000-4000-8000-000000000001', '__mggwp_category__'),
  -- Never referenced by any materiais row (materiais has no DELETE policy
  -- at all, so a category actually IN USE could never be cleaned up to test
  -- deletion - this one exists solely for the delete-permission assertions).
  ('84400000-0000-4000-8000-000000000002', '84200000-0000-4000-8000-000000000001', '__mggwp_category_unused__');

-- Target row for the UPDATE tests below (admin-created, outside any test's
-- own permission assertion).
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES (
  '84500000-0000-4000-8000-000000000001', '84200000-0000-4000-8000-000000000001', '84400000-0000-4000-8000-000000000001',
  'MGGWP-M1', 'Material Original', 'individual', 'disponivel', true
);

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao insere/atualiza/exclui
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT count(*) FROM public.materiais WHERE empresa_id = '84200000-0000-4000-8000-000000000001'$test$,
  'usuario sem grant ainda assim le - SELECT nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
     VALUES ('84200000-0000-4000-8000-000000000001', '84400000-0000-4000-8000-000000000001', 'MGGWP-NG', 'Sem Grant', 'individual', 'disponivel', true)$test$,
  '42501', NULL,
  'usuario sem grant nao insere material'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH updated AS (
  UPDATE public.materiais SET nome = 'Tentativa sem grant' WHERE id = '84500000-0000-4000-8000-000000000001' RETURNING 1
) SELECT count(*) AS n FROM updated;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario sem grant nao atualiza material (RLS filtra a linha - 0 afetadas, nao excecao)'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH deleted AS (
  DELETE FROM public.categorias_materiais WHERE id = '84400000-0000-4000-8000-000000000002' RETURNING 1
) SELECT count(*) AS n FROM deleted;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario sem grant nao exclui categoria (RLS filtra a linha - 0 afetadas, nao excecao)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. USUARIO COM APENAS can_create: insere material, mas nao atualiza nem
--    exclui categoria
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
     VALUES ('84200000-0000-4000-8000-000000000001', '84400000-0000-4000-8000-000000000001', 'MGGWP-C1', 'Material Create', 'individual', 'disponivel', true)$test$,
  'usuario com can_create=true insere material (permissao granular, sem precisar de admin_empresa)'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH updated AS (
  UPDATE public.materiais SET nome = 'Tentativa create-only' WHERE id = '84500000-0000-4000-8000-000000000001' RETURNING 1
) SELECT count(*) AS n FROM updated;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario com can_create=true (sem can_edit) nao atualiza material (RLS filtra a linha - 0 afetadas, nao excecao)'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH deleted AS (
  DELETE FROM public.categorias_materiais WHERE id = '84400000-0000-4000-8000-000000000002' RETURNING 1
) SELECT count(*) AS n FROM deleted;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario com can_create=true (sem can_delete) nao exclui categoria (RLS filtra a linha - 0 afetadas, nao excecao)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM APENAS can_edit: atualiza material criado por outro
--    usuario, mas nao insere nem exclui categoria
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
     VALUES ('84200000-0000-4000-8000-000000000001', '84400000-0000-4000-8000-000000000001', 'MGGWP-E1', 'Material Edit', 'individual', 'disponivel', true)$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_create) nao insere material'
);
SELECT lives_ok(
  $test$UPDATE public.materiais SET nome = 'Editado por outro usuario' WHERE id = '84500000-0000-4000-8000-000000000001'$test$,
  'usuario com can_edit=true atualiza material criado por outro usuario'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH deleted AS (
  DELETE FROM public.categorias_materiais WHERE id = '84400000-0000-4000-8000-000000000002' RETURNING 1
) SELECT count(*) AS n FROM deleted;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario com can_edit=true (sem can_delete) nao exclui categoria (RLS filtra a linha - 0 afetadas, nao excecao)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. USUARIO COM APENAS can_delete: exclui a categoria nao referenciada,
--    mas nao insere nem atualiza material
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
     VALUES ('84200000-0000-4000-8000-000000000001', '84400000-0000-4000-8000-000000000001', 'MGGWP-D1', 'Material Delete', 'individual', 'disponivel', true)$test$,
  '42501', NULL,
  'usuario com can_delete=true (sem can_create) nao insere material'
);
DROP TABLE IF EXISTS mggwp_probe;
CREATE TEMP TABLE mggwp_probe AS
WITH updated AS (
  UPDATE public.materiais SET nome = 'Tentativa delete-only' WHERE id = '84500000-0000-4000-8000-000000000001' RETURNING 1
) SELECT count(*) AS n FROM updated;
SELECT is(
  (SELECT n FROM mggwp_probe),
  0::bigint,
  'usuario com can_delete=true (sem can_edit) nao atualiza material (RLS filtra a linha - 0 afetadas, nao excecao)'
);
SELECT lives_ok(
  $test$DELETE FROM public.categorias_materiais WHERE id = '84400000-0000-4000-8000-000000000002'$test$,
  'usuario com can_delete=true exclui categoria sem materiais dependentes'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. ADMIN continua com acesso irrestrito (insere de novo apos a limpeza
--    acima, prova de que a rota admin_empresa/master nunca regrediu)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$INSERT INTO public.categorias_materiais (empresa_id, nome) VALUES ('84200000-0000-4000-8000-000000000001', '__mggwp_category_admin__')$test$,
  'admin_empresa continua inserindo categorias sem grant explicito'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. CROSS-TENANT: admin de outra empresa nao insere material na empresa A
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

-- The categoria_id subquery itself is evaluated as the cross-tenant caller,
-- who cannot read company A's categories either (can_read_company_module) -
-- so this hits either the materiais INSERT policy or the
-- categoria-belongs-to-company trigger, whichever runs first. Both are
-- correct rejections; only the fact that SOME exception is raised matters
-- here - the RLS-specific 42501 path is already proven by the same-tenant
-- assertions above.
SELECT throws_ok(
  format(
    $fmt$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
       VALUES ('84200000-0000-4000-8000-000000000001', %L, 'MGGWP-XT', 'Cross Tenant', 'individual', 'disponivel', true)$fmt$,
    (SELECT id FROM public.categorias_materiais WHERE empresa_id = '84200000-0000-4000-8000-000000000001' LIMIT 1)
  ),
  NULL, NULL,
  'admin_empresa de outra empresa nao insere material na empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. MASTER ADMIN sem empresa vinculada: sem acesso a nenhuma empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '84300000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;

-- Same reasoning as the cross-tenant assertion above: the categoria_id
-- subquery itself sees nothing either (master has no linked company at
-- all), so any exception here proves the intended rejection.
SELECT throws_ok(
  format(
    $fmt$INSERT INTO public.materiais (empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
       VALUES ('84200000-0000-4000-8000-000000000001', %L, 'MGGWP-MA', 'Master', 'individual', 'disponivel', true)$fmt$,
    (SELECT id FROM public.categorias_materiais WHERE empresa_id = '84200000-0000-4000-8000-000000000001' LIMIT 1)
  ),
  NULL, NULL,
  'master_admin sem empresa vinculada nao tem acesso operacional a nenhuma empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
