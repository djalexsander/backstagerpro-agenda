-- ============================================================================
-- IDENTIFICACAO DE MATERIAIS (QR/CODIGO DE BARRAS) E FOTOS NO STORAGE -
-- PERMISSAO GRANULAR
-- ============================================================================
--
-- Cobre 20260911170000_materials_identification_and_photos_granular_
-- permissions.sql: os quatro RPCs de identificacao (generate_material_qr_code,
-- generate_material_barcode, replace_material_barcode, clear_material_barcode)
-- e a autorizacao de escrita no bucket material-photos
-- (can_manage_material_photo_object) passam a aceitar
-- can_write_company_module(...) OR o user_has_module_action(...) especifico -
-- 'edit' para os quatro RPCs (todos fazem UPDATE em materiais, nunca INSERT),
-- e create/edit/delete para upload/substituir/excluir no Storage,
-- respectivamente. Nao reexercita a logica de negocio dos RPCs em si (unicidade
-- de EAN-13, idempotencia, CHECK de tipo_identificacao) - ja coberta por
-- material_barcode_ean13_test.sql/clear_material_barcode_test.sql/
-- replace_material_barcode_test.sql. Fixture minima e propria (prefixo 991).

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
  '99110000-0000-4000-8000-000000000001', '__miapgp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('99120000-0000-4000-8000-000000000001', '__miapgp_company_a__', 'ativo',
   '99110000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('99120000-0000-4000-8000-000000000002', '__miapgp_company_b__', 'ativo',
   '99110000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'miapgp-admin@example.test', '', now(), '{}', '{"full_name":"MIAPGP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'miapgp-nogrant@example.test', '', now(), '{}', '{"full_name":"MIAPGP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'miapgp-create@example.test', '', now(), '{}', '{"full_name":"MIAPGP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'miapgp-edit@example.test', '', now(), '{}', '{"full_name":"MIAPGP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'miapgp-delete@example.test', '', now(), '{}', '{"full_name":"MIAPGP Delete"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99130000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'miapgp-admin-b@example.test', '', now(), '{}', '{"full_name":"MIAPGP Admin B"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id IN (
  '99130000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000006'
);
UPDATE public.user_roles SET role = 'usuario' WHERE user_id IN (
  '99130000-0000-4000-8000-000000000002',
  '99130000-0000-4000-8000-000000000003',
  '99130000-0000-4000-8000-000000000004',
  '99130000-0000-4000-8000-000000000005'
);

UPDATE public.profiles SET empresa_id = '99120000-0000-4000-8000-000000000001', ativado = true, activated_at = now()
WHERE user_id IN (
  '99130000-0000-4000-8000-000000000001',
  '99130000-0000-4000-8000-000000000002',
  '99130000-0000-4000-8000-000000000003',
  '99130000-0000-4000-8000-000000000004',
  '99130000-0000-4000-8000-000000000005'
);
UPDATE public.profiles SET empresa_id = '99120000-0000-4000-8000-000000000002', ativado = true, activated_at = now()
WHERE user_id = '99130000-0000-4000-8000-000000000006';

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '99120000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais');

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('99120000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000003', 'gestao_materiais', true, true, false, false),
  ('99120000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000004', 'gestao_materiais', true, false, true, false),
  ('99120000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000005', 'gestao_materiais', true, false, false, true);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('99140000-0000-4000-8000-000000000001', '99120000-0000-4000-8000-000000000001', '__miapgp_category__');

-- Material 1: alvo das tentativas REJEITADAS (nogrant/create-only) nos 4
-- RPCs - nunca deve mudar de estado, entao pode ser reutilizado por todas.
-- Material 2: alvo do ciclo de vida completo pelo ator edit-only (prova que
-- 'edit' e realmente suficiente para as 4 operacoes).
-- Material 3: alvo da regressao do admin_empresa.
-- Material 4: alvo do teste cross-tenant.
INSERT INTO public.materiais (id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
VALUES
  ('99150000-0000-4000-8000-000000000001', '99120000-0000-4000-8000-000000000001', '99140000-0000-4000-8000-000000000001', 'MIAPGP-M1', 'Material Rejeicao', 'individual', 'disponivel', true),
  ('99150000-0000-4000-8000-000000000002', '99120000-0000-4000-8000-000000000001', '99140000-0000-4000-8000-000000000001', 'MIAPGP-M2', 'Material Edit', 'individual', 'disponivel', true),
  ('99150000-0000-4000-8000-000000000003', '99120000-0000-4000-8000-000000000001', '99140000-0000-4000-8000-000000000001', 'MIAPGP-M3', 'Material Admin', 'individual', 'disponivel', true),
  ('99150000-0000-4000-8000-000000000004', '99120000-0000-4000-8000-000000000001', '99140000-0000-4000-8000-000000000001', 'MIAPGP-M4', 'Material CrossTenant', 'individual', 'disponivel', true);

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: rejeitado pelos 4 RPCs
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.generate_material_qr_code('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario sem grant nao gera QR'
);
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario sem grant nao gera codigo de barras'
);
SELECT throws_ok(
  $test$SELECT public.replace_material_barcode('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario sem grant nao substitui codigo de barras'
);
SELECT throws_ok(
  $test$SELECT public.clear_material_barcode('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario sem grant nao exclui codigo de barras'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. USUARIO COM APENAS can_create=true: continua rejeitado (acao exigida e
--    'edit', nao 'create' - prova que a checagem e especifica por acao)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.generate_material_qr_code('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario com can_create=true (sem can_edit) nao gera QR'
);
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('99150000-0000-4000-8000-000000000001')$test$,
  '42501', NULL, 'usuario com can_create=true (sem can_edit) nao gera codigo de barras'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM can_edit=true: percorre o ciclo completo de identificacao
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.generate_material_qr_code('99150000-0000-4000-8000-000000000002')$test$,
  'usuario com can_edit=true gera QR (permissao granular, sem precisar de admin_empresa)'
);
SELECT ok(
  (SELECT conteudo_qr_code IS NOT NULL FROM public.materiais WHERE id = '99150000-0000-4000-8000-000000000002'),
  'o QR foi de fato gravado no material'
);
SELECT lives_ok(
  $test$SELECT public.generate_material_barcode('99150000-0000-4000-8000-000000000002')$test$,
  'usuario com can_edit=true gera codigo de barras'
);
SELECT ok(
  (SELECT codigo_barras IS NOT NULL FROM public.materiais WHERE id = '99150000-0000-4000-8000-000000000002'),
  'o codigo de barras foi de fato gravado no material'
);
SELECT lives_ok(
  $test$SELECT public.replace_material_barcode('99150000-0000-4000-8000-000000000002')$test$,
  'usuario com can_edit=true substitui o codigo de barras'
);
SELECT lives_ok(
  $test$SELECT public.clear_material_barcode('99150000-0000-4000-8000-000000000002')$test$,
  'usuario com can_edit=true exclui o codigo de barras'
);
SELECT ok(
  (SELECT codigo_barras IS NULL FROM public.materiais WHERE id = '99150000-0000-4000-8000-000000000002'),
  'o codigo de barras foi de fato removido do material'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. ADMIN continua com acesso irrestrito (regressao do caminho grosso)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.generate_material_qr_code('99150000-0000-4000-8000-000000000003')$test$,
  'admin_empresa continua gerando QR sem grant explicito'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. CROSS-TENANT: admin de outra empresa nao identifica material da empresa A
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.generate_material_qr_code('99150000-0000-4000-8000-000000000004')$test$,
  '42501', NULL, 'admin_empresa de outra empresa nao gera QR para material da empresa A'
);
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('99150000-0000-4000-8000-000000000004')$test$,
  '42501', NULL, 'admin_empresa de outra empresa nao gera codigo de barras para material da empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. STORAGE material-photos: can_manage_material_photo_object(path, action)
-- ----------------------------------------------------------------------------
-- Caminho no formato empresa_id/material_id/arquivo.ext exigido por
-- is_valid_material_photo_path - usa o Material 2 (empresa A), que ja existe
-- e nao precisa de nenhum arquivo real no bucket para este teste: a funcao
-- so consulta public.materiais, nunca storage.objects.

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'create'),
  'usuario sem grant nao pode fazer upload de foto'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'create'),
  'usuario com can_create=true pode fazer upload (INSERT) de foto'
);
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'edit'),
  'usuario com can_create=true (sem can_edit) nao pode substituir foto'
);
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'delete'),
  'usuario com can_create=true (sem can_delete) nao pode excluir foto'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'edit'),
  'usuario com can_edit=true pode substituir (UPDATE) foto'
);
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'create'),
  'usuario com can_edit=true (sem can_create) nao pode fazer upload de foto'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'delete'),
  'usuario com can_delete=true pode excluir (DELETE) foto'
);
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'edit'),
  'usuario com can_delete=true (sem can_edit) nao pode substituir foto'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'delete'),
  'admin_empresa continua podendo qualquer acao (create/edit/delete) sem grant explicito'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99130000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.can_manage_material_photo_object('99120000-0000-4000-8000-000000000001/99150000-0000-4000-8000-000000000002/foto.jpg', 'create'),
  'admin_empresa de outra empresa nao pode gerenciar foto de material da empresa A'
);
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
