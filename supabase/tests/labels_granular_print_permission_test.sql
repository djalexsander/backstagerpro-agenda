-- ============================================================================
-- ETIQUETAS DE MATERIAIS - PERMISSAO GRANULAR DE IMPRESSAO
-- ============================================================================
--
-- Cobre 20260911120000_labels_granular_print_permission.sql:
-- registrar_solicitacao_impressao_lote_etiquetas aceita um "usuario" com o
-- grant granular 'create' em 'etiquetas_materiais' (user_module_permissions),
-- resolvendo a empresa em modo leitura e reaplicando o gate de escrita -
-- mesmo padrao usado por Locacao (retirada/devolucao). Gerenciar modelos
-- (salvar_modelo_etiqueta_v2/inativar_modelo_etiqueta) continua admin-only,
-- deliberadamente NAO tocado por esta migration - testado aqui tambem, para
-- provar que um grant de impressao nao desbloqueia gestao de modelos.
-- Fixture minima e propria (prefixo 82).

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
  '82100000-0000-4000-8000-000000000001', '__lbgwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '82200000-0000-4000-8000-000000000001', '__lbgwp_company__', 'ativo',
  '82100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
),(
  '82200000-0000-4000-8000-000000000002', '__lbgwp_company_b__', 'ativo',
  '82100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '82300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'lbgwp-admin@example.test', '', now(), '{}', '{"full_name":"LBGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'lbgwp-nogrant@example.test', '', now(), '{}', '{"full_name":"LBGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'lbgwp-create@example.test', '', now(), '{}', '{"full_name":"LBGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'lbgwp-crosstenant@example.test', '', now(), '{}', '{"full_name":"LBGWP CrossTenant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'lbgwp-master@example.test', '', now(), '{}', '{"full_name":"LBGWP Master"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id IN (
  '82300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000006'
);
UPDATE public.user_roles SET role = 'usuario' WHERE user_id IN (
  '82300000-0000-4000-8000-000000000002',
  '82300000-0000-4000-8000-000000000003'
);
UPDATE public.user_roles SET role = 'master_admin' WHERE user_id = '82300000-0000-4000-8000-000000000007';

UPDATE public.profiles SET empresa_id = '82200000-0000-4000-8000-000000000001',
  ativado = true, activated_at = now()
WHERE user_id IN (
  '82300000-0000-4000-8000-000000000001',
  '82300000-0000-4000-8000-000000000002',
  '82300000-0000-4000-8000-000000000003'
);
UPDATE public.profiles SET empresa_id = '82200000-0000-4000-8000-000000000002',
  ativado = true, activated_at = now()
WHERE user_id = '82300000-0000-4000-8000-000000000006';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = '82300000-0000-4000-8000-000000000007';

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '82200000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('gestao_materiais', 'etiquetas_materiais'));

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('82200000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000003', 'etiquetas_materiais', true, true, false, false);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('82400000-0000-4000-8000-000000000001', '82200000-0000-4000-8000-000000000001', '__lbgwp_category__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES (
  '82500000-0000-4000-8000-000000000001', '82200000-0000-4000-8000-000000000001', '82400000-0000-4000-8000-000000000001',
  'LBGWP-M1', 'Material Etiqueta', 'individual', 'disponivel', true
);
-- conteudo_qr_code must be exactly 'BACKSTAGE-PRO:MATERIAL:<identificador_unico>'
-- (enforced by prepare_material_write) - identificador_unico is auto-generated
-- on insert, so it can only be referenced after the row exists.
UPDATE public.materiais SET conteudo_qr_code = 'BACKSTAGE-PRO:MATERIAL:' || identificador_unico::text
WHERE id = '82500000-0000-4000-8000-000000000001';

-- etiqueta_modelos only accepts writes through its official RPCs
-- (protect_material_label_projection checks this session flag).
SELECT set_config('backstage.material_labels_write', 'on', true);
INSERT INTO public.etiqueta_modelos (
  id, empresa_id, nome, largura_mm, altura_mm, tipo_identificacao, campos, tamanho_fonte, mostrar_borda, padrao, ativo, created_by, updated_by
) VALUES (
  '82600000-0000-4000-8000-000000000001', '82200000-0000-4000-8000-000000000001', '__lbgwp_model__',
  50, 30, 'qr_code', '["nome"]'::jsonb, 10, false, true, true,
  '82300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000001'
);

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao imprime nem gerencia modelos
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.listar_modelos_etiqueta(_empresa_id => '82200000-0000-4000-8000-000000000001')$test$,
  'usuario sem grant ainda assim le - view nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
    '82600000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('material_id', '82500000-0000-4000-8000-000000000001', 'quantidade', 1)),
    gen_random_uuid(), NULL, NULL, '82200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao solicita impressao de etiqueta'
);
SELECT throws_ok(
  $test$SELECT public.salvar_modelo_etiqueta_v2(
    _nome => 'Novo modelo', _largura_mm => 50, _altura_mm => 30,
    _tipo_identificacao => 'qr_code', _campos => '["nome"]'::jsonb,
    _empresa_id => '82200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao gerencia modelos de etiqueta (continua admin-only, nao tocado por esta migration)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. USUARIO COM can_create EM etiquetas_materiais: imprime, mas NAO
--    gerencia modelos (grant de impressao nao desbloqueia configuracao)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
    '82600000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('material_id', '82500000-0000-4000-8000-000000000001', 'quantidade', 2)),
    gen_random_uuid(), NULL, NULL, '82200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true em etiquetas_materiais solicita impressao (permissao granular, sem precisar de admin_empresa)'
);
SELECT throws_ok(
  $test$SELECT public.salvar_modelo_etiqueta_v2(
    _nome => 'Novo modelo', _largura_mm => 50, _altura_mm => 30,
    _tipo_identificacao => 'qr_code', _campos => '["nome"]'::jsonb,
    _empresa_id => '82200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com grant de impressao nao gerencia modelos de etiqueta (acao separada, nao concedida)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. ADMIN continua com acesso irrestrito a ambas as acoes
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
    '82600000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('material_id', '82500000-0000-4000-8000-000000000001', 'quantidade', 1)),
    gen_random_uuid(), NULL, NULL, '82200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua solicitando impressao sem grant explicito'
);
SELECT lives_ok(
  $test$SELECT public.salvar_modelo_etiqueta_v2(
    _nome => 'Novo modelo do admin', _largura_mm => 50, _altura_mm => 30,
    _tipo_identificacao => 'qr_code', _campos => '["nome"]'::jsonb,
    _empresa_id => '82200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua gerenciando modelos sem grant explicito'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. CROSS-TENANT: admin de outra empresa nao imprime informando o
--    empresa_id da empresa A
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
    '82600000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('material_id', '82500000-0000-4000-8000-000000000001', 'quantidade', 1)),
    gen_random_uuid(), NULL, NULL, '82200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'admin_empresa de outra empresa nao solicita impressao informando o empresa_id da empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. MASTER ADMIN sem empresa vinculada: sem acesso a nenhuma empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
    '82600000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('material_id', '82500000-0000-4000-8000-000000000001', 'quantidade', 1)),
    gen_random_uuid(), NULL, NULL, '82200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'master_admin sem empresa vinculada nao tem acesso operacional a nenhuma empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
