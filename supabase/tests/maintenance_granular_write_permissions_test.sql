-- ============================================================================
-- MANUTENCAO DE EQUIPAMENTOS - PERMISSAO GRANULAR DE ESCRITA
-- ============================================================================
--
-- Cobre 20260911110000_maintenance_granular_write_permissions.sql:
-- resolve_equipment_maintenance_company aceita um "usuario" com QUALQUER
-- grant de create/edit/delete em 'manutencao_equipamentos'
-- (user_module_permissions), e cada RPC de escrita passa a exigir a acao
-- especifica via user_has_module_action - um grant para uma acao nunca
-- desbloqueia as outras. Este modulo nao usa a acao 'delete' (o frontend nao
-- tem uma acao de exclusao separada - cancelar e uma transicao de status,
-- coberta por 'edit'). Nao reexercita as regras de negocio de manutencao em
-- si (maquina de estados, idempotencia, isolamento) - isso ja e coberto por
-- equipment_maintenance_stage_five_test.sql e tenant_isolation_matrix_test.sql.
-- Fixture minima e propria (prefixo 81).

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
  '81100000-0000-4000-8000-000000000001', '__mtgwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '81200000-0000-4000-8000-000000000001', '__mtgwp_company__', 'ativo',
  '81100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
),(
  '81200000-0000-4000-8000-000000000002', '__mtgwp_company_b__', 'ativo',
  '81100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mtgwp-admin@example.test', '', now(), '{}', '{"full_name":"MTGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mtgwp-nogrant@example.test', '', now(), '{}', '{"full_name":"MTGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mtgwp-create@example.test', '', now(), '{}', '{"full_name":"MTGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mtgwp-edit@example.test', '', now(), '{}', '{"full_name":"MTGWP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'mtgwp-crosstenant@example.test', '', now(), '{}', '{"full_name":"MTGWP CrossTenant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'mtgwp-master@example.test', '', now(), '{}', '{"full_name":"MTGWP Master"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id IN (
  '81300000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000006'
);
UPDATE public.user_roles SET role = 'usuario' WHERE user_id IN (
  '81300000-0000-4000-8000-000000000002',
  '81300000-0000-4000-8000-000000000003',
  '81300000-0000-4000-8000-000000000004'
);
UPDATE public.user_roles SET role = 'master_admin' WHERE user_id = '81300000-0000-4000-8000-000000000007';

UPDATE public.profiles SET empresa_id = '81200000-0000-4000-8000-000000000001',
  ativado = true, activated_at = now()
WHERE user_id IN (
  '81300000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000002',
  '81300000-0000-4000-8000-000000000003',
  '81300000-0000-4000-8000-000000000004'
);
UPDATE public.profiles SET empresa_id = '81200000-0000-4000-8000-000000000002',
  ativado = true, activated_at = now()
WHERE user_id = '81300000-0000-4000-8000-000000000006';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = '81300000-0000-4000-8000-000000000007';

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '81200000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('gestao_materiais', 'manutencao_equipamentos'));

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('81200000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000003', 'manutencao_equipamentos', true, true, false, false),
  ('81200000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000004', 'manutencao_equipamentos', true, false, true, false);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('81400000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '__mtgwp_category__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('81500000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', 'MTGWP-M1', 'Equip Create', 'individual', 'disponivel', true),
  ('81500000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', 'MTGWP-M2', 'Equip Edit', 'individual', 'disponivel', true);

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao executa nenhuma escrita
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.listar_ordens_manutencao(_empresa_id => '81200000-0000-4000-8000-000000000001')$test$,
  'usuario sem grant ainda assim le - view nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000001', 'corretiva', 'normal', 'manual', 'defeito teste',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao cria ordem de manutencao'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. ADMIN abre a ordem alvo dos testes de edicao/transicao/insumos abaixo -
--    tambem prova que admin_empresa continua com acesso irrestrito.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000002', 'corretiva', 'normal', 'manual', 'defeito para edicao',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua com acesso irrestrito - ordem alvo dos testes de edit'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM APENAS can_create: abre ordem, mas nao edita/transiciona/
--    gerencia insumos
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000001', 'corretiva', 'normal', 'manual', 'defeito teste',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true abre ordem (permissao granular, sem precisar de admin_empresa)'
);
SELECT throws_ok(
  format(
    $fmt$SELECT public.atualizar_ordem_manutencao(%L, gen_random_uuid(), %L, 'alta')$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002'),
    (SELECT updated_at FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao edita ordem'
);
SELECT throws_ok(
  format(
    $fmt$SELECT public.transicionar_ordem_manutencao(%L, 'aguardando_analise', gen_random_uuid(), %L)$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002'),
    (SELECT updated_at FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao transiciona ordem'
);
SELECT throws_ok(
  format(
    $fmt$SELECT public.salvar_insumo_ordem_manutencao(%L, 'parafuso', 2, 'un', 1.5, gen_random_uuid())$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao adiciona insumo'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. USUARIO COM APENAS can_edit: edita/transiciona a ordem aberta pelo
--    admin e gerencia insumos, mas nao abre nova ordem
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000001', 'corretiva', 'normal', 'manual', 'defeito teste',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_create) nao abre ordem'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.atualizar_ordem_manutencao(%L, gen_random_uuid(), %L, 'alta')$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002'),
    (SELECT updated_at FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  'usuario com can_edit=true edita ordem aberta por outro usuario'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.salvar_insumo_ordem_manutencao(%L, 'parafuso', 2, 'un', 1.5, gen_random_uuid())$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  'usuario com can_edit=true adiciona insumo'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.transicionar_ordem_manutencao(%L, 'aguardando_analise', gen_random_uuid(), %L)$fmt$,
    (SELECT id FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002'),
    (SELECT updated_at FROM public.manutencao_ordens WHERE material_id = '81500000-0000-4000-8000-000000000002')
  ),
  'usuario com can_edit=true transiciona a ordem'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. CROSS-TENANT: admin de uma segunda empresa nao alcanca a empresa acima
--    informando o empresa_id dela
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000001', 'corretiva', 'normal', 'manual', 'defeito teste',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'admin_empresa de outra empresa nao abre ordem informando o empresa_id da empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. MASTER ADMIN sem empresa vinculada: sem acesso a nenhuma empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '81300000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_ordem_manutencao(
    '81500000-0000-4000-8000-000000000001', 'corretiva', 'normal', 'manual', 'defeito teste',
    gen_random_uuid(), 1, NULL, NULL, NULL, NULL, NULL, 'interna', NULL, NULL, NULL,
    '81200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'master_admin sem empresa vinculada nao tem acesso operacional a nenhuma empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
