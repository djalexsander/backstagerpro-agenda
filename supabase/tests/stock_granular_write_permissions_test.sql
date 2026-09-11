-- ============================================================================
-- CONTROLE DE ESTOQUE - PERMISSAO GRANULAR DE ESCRITA
-- ============================================================================
--
-- Cobre 20260911100000_stock_granular_write_permissions.sql:
-- resolve_stock_company aceita um "usuario" com QUALQUER grant de
-- create/edit/delete em 'controle_estoque' (user_module_permissions), e cada
-- RPC de escrita passa a exigir a acao especifica via user_has_module_action
-- - um grant para uma acao nunca desbloqueia as outras. Nao reexercita as
-- regras de negocio de estoque em si (saldo negativo, idempotencia,
-- isolamento entre empresas) - isso ja e coberto por
-- stock_control_stage_two_test.sql e tenant_isolation_matrix_test.sql.
-- Fixture minima e propria (prefixo 80).
--
-- Fixtures rodam como o dono do banco (bypassa RLS de proposito). As
-- asercoes trocam de papel via set_config('request.jwt.claim.sub', ...) +
-- SET LOCAL ROLE authenticated.

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
  '80100000-0000-4000-8000-000000000001', '__stgwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '80200000-0000-4000-8000-000000000001', '__stgwp_company__', 'ativo',
  '80100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stgwp-admin@example.test', '', now(), '{}', '{"full_name":"STGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stgwp-nogrant@example.test', '', now(), '{}', '{"full_name":"STGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stgwp-create@example.test', '', now(), '{}', '{"full_name":"STGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'stgwp-edit@example.test', '', now(), '{}', '{"full_name":"STGWP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'stgwp-delete@example.test', '', now(), '{}', '{"full_name":"STGWP Delete"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '80300000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  '80300000-0000-4000-8000-000000000002',
  '80300000-0000-4000-8000-000000000003',
  '80300000-0000-4000-8000-000000000004',
  '80300000-0000-4000-8000-000000000005'
);

UPDATE public.profiles SET empresa_id = '80200000-0000-4000-8000-000000000001',
  ativado = true, activated_at = now()
WHERE user_id IN (
  '80300000-0000-4000-8000-000000000001',
  '80300000-0000-4000-8000-000000000002',
  '80300000-0000-4000-8000-000000000003',
  '80300000-0000-4000-8000-000000000004',
  '80300000-0000-4000-8000-000000000005'
);

-- provision_company_module_entitlements (AFTER INSERT ON empresas) already
-- seeded every catalog module as status='inactive' for this company -
-- UPDATE it to 'active' instead of INSERTing (INSERT hits
-- prevent_duplicate_company_module).
UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '80200000-0000-4000-8000-000000000001'
  AND module_id IN (
    SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais'
  );

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '80200000-0000-4000-8000-000000000001'
  AND module_id IN (
    SELECT id FROM public.module_catalog WHERE feature_key = 'controle_estoque'
  );

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('80200000-0000-4000-8000-000000000001', '80300000-0000-4000-8000-000000000003', 'controle_estoque', true, true, false, false),
  ('80200000-0000-4000-8000-000000000001', '80300000-0000-4000-8000-000000000004', 'controle_estoque', true, false, true, false),
  ('80200000-0000-4000-8000-000000000001', '80300000-0000-4000-8000-000000000005', 'controle_estoque', true, false, false, true);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('80400000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', '__stgwp_category__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('80500000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', '80400000-0000-4000-8000-000000000001', 'STGWP-M1', 'Material Create', 'quantidade', 'disponivel', true),
  ('80500000-0000-4000-8000-000000000002', '80200000-0000-4000-8000-000000000001', '80400000-0000-4000-8000-000000000001', 'STGWP-M2', 'Material Edit', 'quantidade', 'disponivel', true),
  ('80500000-0000-4000-8000-000000000003', '80200000-0000-4000-8000-000000000001', '80400000-0000-4000-8000-000000000001', 'STGWP-M3', 'Material Estorno', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES ('80600000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', 'STGWP-LOC', 'Deposito', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('80200000-0000-4000-8000-000000000001', '80500000-0000-4000-8000-000000000002', '80600000-0000-4000-8000-000000000001', 10),
  ('80200000-0000-4000-8000-000000000001', '80500000-0000-4000-8000-000000000003', '80600000-0000-4000-8000-000000000001', 10);

-- Second tenant + master admin, fixture only - created here (before any
-- set_config/role switch below) because protect_profile_empresa_assignment
-- only allows a profiles.empresa_id change from a master-administrator or
-- trusted-server request context; once section 1 below sets
-- request.jwt.claim.sub to a non-master test user, that GUC stays set (it is
-- transaction-local, not role-local - RESET ROLE does not clear it) for the
-- rest of this transaction and would make a later profiles update here fail.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '80200000-0000-4000-8000-000000000002', '__stgwp_company_b__', 'ativo',
  '80100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'stgwp-crosstenant@example.test', '', now(), '{}', '{"full_name":"STGWP CrossTenant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'stgwp-master@example.test', '', now(), '{}', '{"full_name":"STGWP Master"}', now(), now());
UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id = '80300000-0000-4000-8000-000000000006';
UPDATE public.user_roles SET role = 'master_admin' WHERE user_id = '80300000-0000-4000-8000-000000000007';
UPDATE public.profiles SET empresa_id = '80200000-0000-4000-8000-000000000002',
  ativado = true, activated_at = now()
WHERE user_id = '80300000-0000-4000-8000-000000000006';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = '80300000-0000-4000-8000-000000000007';

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao executa nenhuma escrita
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.listar_estoque_resumo(_empresa_id => '80200000-0000-4000-8000-000000000001')$test$,
  'usuario sem grant ainda assim le - view nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao registra movimentacao de estoque'
);
SELECT throws_ok(
  $test$SELECT public.ajustar_estoque_material(
    '80500000-0000-4000-8000-000000000002', '80600000-0000-4000-8000-000000000001', 20,
    'contagem', 'inventario fisico', gen_random_uuid(), NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao ajusta estoque'
);
SELECT throws_ok(
  $test$SELECT public.estornar_movimentacao_estoque(
    gen_random_uuid(), 'motivo', gen_random_uuid(), NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao estorna movimentacao'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. ADMIN registra a movimentacao original que sera estornada no teste 5,
--    tambem prova que admin_empresa continua com acesso irrestrito.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000003', 'entrada', 3, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua com acesso irrestrito - movimentacao alvo do estorno'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM APENAS can_create: registra movimentacao, mas nao ajusta
--    nem estorna
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true registra movimentacao (permissao granular, sem precisar de admin_empresa)'
);
SELECT throws_ok(
  $test$SELECT public.ajustar_estoque_material(
    '80500000-0000-4000-8000-000000000002', '80600000-0000-4000-8000-000000000001', 20,
    'contagem', 'inventario fisico', gen_random_uuid(), NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao ajusta estoque'
);
SELECT throws_ok(
  $test$SELECT public.estornar_movimentacao_estoque(
    gen_random_uuid(), 'motivo', gen_random_uuid(), NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_create=true (sem can_delete) nao estorna movimentacao'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. USUARIO COM APENAS can_edit: ajusta o estoque, mas nao registra
--    movimentacao nem estorna
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.ajustar_estoque_material(
    '80500000-0000-4000-8000-000000000002', '80600000-0000-4000-8000-000000000001', 20,
    'contagem', 'inventario fisico', gen_random_uuid(), NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_edit=true ajusta o estoque'
);
SELECT throws_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_create) nao registra movimentacao'
);
SELECT throws_ok(
  $test$SELECT public.estornar_movimentacao_estoque(
    gen_random_uuid(), 'motivo', gen_random_uuid(), NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_delete) nao estorna movimentacao'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. USUARIO COM APENAS can_delete: estorna a movimentacao registrada pelo
--    admin no passo 2, mas nao registra nem ajusta
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_delete=true (sem can_create) nao registra movimentacao'
);
SELECT throws_ok(
  $test$SELECT public.ajustar_estoque_material(
    '80500000-0000-4000-8000-000000000002', '80600000-0000-4000-8000-000000000001', 99,
    'contagem', 'inventario fisico', gen_random_uuid(), NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_delete=true (sem can_edit) nao ajusta estoque'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.estornar_movimentacao_estoque(%L, 'motivo teste', gen_random_uuid(), NULL,
      '80200000-0000-4000-8000-000000000001')$fmt$,
    (SELECT id FROM public.estoque_movimentacoes
     WHERE empresa_id = '80200000-0000-4000-8000-000000000001'
       AND material_id = '80500000-0000-4000-8000-000000000003' AND tipo_movimentacao = 'entrada')
  ),
  'usuario com can_delete=true estorna movimentacao registrada por outro usuario'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. CROSS-TENANT: usuario de uma segunda empresa, mesmo com grant total
--    nela, nao alcanca a empresa acima informando o empresa_id dela
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'admin_empresa de outra empresa nao registra movimentacao informando o empresa_id da empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. MASTER ADMIN sem empresa vinculada: sem acesso a nenhuma empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_movimentacao_estoque(
    '80500000-0000-4000-8000-000000000001', 'entrada', 5, gen_random_uuid(),
    NULL, '80600000-0000-4000-8000-000000000001', 'compra', NULL, NULL, NULL, 'manual', NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'master_admin sem empresa vinculada nao tem acesso operacional a nenhuma empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
