-- ============================================================================
-- LOCACAO DE MATERIAIS - PERMISSAO GRANULAR DE ESCRITA
-- ============================================================================
--
-- Cobre 20260911130000_rental_granular_write_permissions.sql:
-- resolve_material_rental_company aceita um "usuario" com QUALQUER grant de
-- create/edit/delete em 'locacao_materiais' (user_module_permissions), e
-- cada RPC de escrita passa a exigir a acao especifica via
-- user_has_module_action - um grant para uma acao nunca desbloqueia as
-- outras. Amostra representativa (criar/editar/cancelar) em vez de exercitar
-- as 9 RPCs convertidas uma a uma - todas seguem o mesmo padrao de gate,
-- ja coberto exaustivamente por checkin_checkout_granular_write_permissions_test.sql
-- e stock_granular_write_permissions_test.sql. Cobre tambem a checagem
-- defensiva de salvar_cliente (prova que um grant de locacao NAO desbloqueia
-- gestao de clientes). Nao reexercita as regras de negocio de locacao em si
-- (maquina de estados, idempotencia) - isso ja e coberto por
-- material_rentals_stage_four_test.sql. Fixture minima e propria
-- (prefixo 83).

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
  '83100000-0000-4000-8000-000000000001', '__rtgwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '83200000-0000-4000-8000-000000000001', '__rtgwp_company__', 'ativo',
  '83100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
),(
  '83200000-0000-4000-8000-000000000002', '__rtgwp_company_b__', 'ativo',
  '83100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rtgwp-admin@example.test', '', now(), '{}', '{"full_name":"RTGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rtgwp-nogrant@example.test', '', now(), '{}', '{"full_name":"RTGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rtgwp-create@example.test', '', now(), '{}', '{"full_name":"RTGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rtgwp-edit@example.test', '', now(), '{}', '{"full_name":"RTGWP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rtgwp-delete@example.test', '', now(), '{}', '{"full_name":"RTGWP Delete"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'rtgwp-crosstenant@example.test', '', now(), '{}', '{"full_name":"RTGWP CrossTenant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'rtgwp-master@example.test', '', now(), '{}', '{"full_name":"RTGWP Master"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa' WHERE user_id IN (
  '83300000-0000-4000-8000-000000000001', '83300000-0000-4000-8000-000000000006'
);
UPDATE public.user_roles SET role = 'usuario' WHERE user_id IN (
  '83300000-0000-4000-8000-000000000002',
  '83300000-0000-4000-8000-000000000003',
  '83300000-0000-4000-8000-000000000004',
  '83300000-0000-4000-8000-000000000005'
);
UPDATE public.user_roles SET role = 'master_admin' WHERE user_id = '83300000-0000-4000-8000-000000000007';

UPDATE public.profiles SET empresa_id = '83200000-0000-4000-8000-000000000001',
  ativado = true, activated_at = now()
WHERE user_id IN (
  '83300000-0000-4000-8000-000000000001',
  '83300000-0000-4000-8000-000000000002',
  '83300000-0000-4000-8000-000000000003',
  '83300000-0000-4000-8000-000000000004',
  '83300000-0000-4000-8000-000000000005'
);
UPDATE public.profiles SET empresa_id = '83200000-0000-4000-8000-000000000002',
  ativado = true, activated_at = now()
WHERE user_id = '83300000-0000-4000-8000-000000000006';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = '83300000-0000-4000-8000-000000000007';

UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '83200000-0000-4000-8000-000000000001'
  AND module_id IN (
    SELECT id FROM public.module_catalog
    WHERE feature_key IN ('gestao_materiais', 'controle_estoque', 'checkin_checkout', 'locacao_materiais')
  );

INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('83200000-0000-4000-8000-000000000001', '83300000-0000-4000-8000-000000000003', 'locacao_materiais', true, true, false, false),
  ('83200000-0000-4000-8000-000000000001', '83300000-0000-4000-8000-000000000004', 'locacao_materiais', true, false, true, false),
  ('83200000-0000-4000-8000-000000000001', '83300000-0000-4000-8000-000000000005', 'locacao_materiais', true, false, false, true);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('83400000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '__rtgwp_responsible__', 'Tecnico');

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, created_by, updated_by)
VALUES (
  '83500000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', 'pessoa_fisica',
  '__rtgwp_client__', '83300000-0000-4000-8000-000000000001', '83300000-0000-4000-8000-000000000001'
);

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao cria/edita/cancela locacao, nem
--    gerencia clientes
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.listar_locacoes_materiais(_empresa_id => '83200000-0000-4000-8000-000000000001')$test$,
  'usuario sem grant ainda assim le - view nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao cria locacao'
);
SELECT throws_ok(
  $test$SELECT public.salvar_cliente(
    'pessoa_fisica', 'Novo Cliente', NULL, NULL, NULL, NULL, NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao gerencia clientes'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. ADMIN cria a locacao alvo dos testes de edicao/cancelamento -
--    tambem prova acesso irrestrito continuo.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, 'alvo dos testes de edit',
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua com acesso irrestrito - locacao alvo dos testes de edit/cancelar'
);

-- Captured by id, not by observacoes (test 4/10 below legitimately edit
-- that field - re-querying by its original text would go stale).
CREATE TEMP TABLE rtgwp_edit_target AS
SELECT id FROM public.material_locacoes WHERE observacoes = 'alvo dos testes de edit';

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM APENAS can_create: cria locacao, mas nao edita nem cancela
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true cria locacao (permissao granular, sem precisar de admin_empresa)'
);
SELECT throws_ok(
  format(
    $fmt$SELECT public.atualizar_rascunho_locacao_material(%L, '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days', 'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid())$fmt$,
    (SELECT id FROM rtgwp_edit_target)
  ),
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao edita locacao'
);
SELECT throws_ok(
  format(
    $fmt$SELECT public.cancelar_locacao_material(%L, 'motivo teste', gen_random_uuid())$fmt$,
    (SELECT id FROM rtgwp_edit_target)
  ),
  '42501', NULL,
  'usuario com can_create=true (sem can_delete) nao cancela locacao'
);
SELECT throws_ok(
  $test$SELECT public.salvar_cliente(
    'pessoa_fisica', 'Novo Cliente', NULL, NULL, NULL, NULL, NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com grant de locacao (create) nao gerencia clientes - acao nao estendida por esta migration'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. USUARIO COM APENAS can_edit: edita a locacao aberta pelo admin, mas
--    nao cria nem cancela
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_create) nao cria locacao'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.atualizar_rascunho_locacao_material(%L, '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days', 'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, 'observacao editada por outro usuario')$fmt$,
    (SELECT id FROM rtgwp_edit_target)
  ),
  'usuario com can_edit=true edita locacao aberta por outro usuario'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. USUARIO COM APENAS can_delete: cancela a locacao aberta pelo admin,
--    mas nao cria nem edita
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format(
    $fmt$SELECT public.atualizar_rascunho_locacao_material(%L, '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days', 'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid())$fmt$,
    (SELECT id FROM rtgwp_edit_target)
  ),
  '42501', NULL,
  'usuario com can_delete=true (sem can_edit) nao edita locacao'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.cancelar_locacao_material(%L, 'motivo teste', gen_random_uuid())$fmt$,
    (SELECT id FROM rtgwp_edit_target)
  ),
  'usuario com can_delete=true cancela locacao aberta por outro usuario'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. CROSS-TENANT: admin de uma segunda empresa nao alcanca a empresa acima
--    informando o empresa_id dela
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'admin_empresa de outra empresa nao cria locacao informando o empresa_id da empresa A'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. MASTER ADMIN sem empresa vinculada: sem acesso a nenhuma empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '83300000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.criar_locacao_material(
    '83500000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '3 days',
    'funcionario', '83400000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, NULL,
    '83200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'master_admin sem empresa vinculada nao tem acesso operacional a nenhuma empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
