-- ============================================================================
-- CHECK-IN/CHECK-OUT (E SCANNER REMOTO) - PERMISSAO GRANULAR DE ESCRITA
-- ============================================================================
--
-- Cobre 20260819090000_checkin_checkout_granular_write_permissions.sql:
-- resolve_custody_company aceita um "usuario" com QUALQUER grant de
-- create/edit/delete em 'checkin_checkout' (user_module_permissions), e cada
-- RPC de escrita passa a exigir a acao especifica via user_has_module_action
-- - um grant para uma acao nunca desbloqueia as outras. Nao reexercita as
-- regras de negocio de custodia em si (quantidade, estoque, idempotencia,
-- isolamento entre empresas) - isso ja e coberto por
-- material_checkin_checkout_stage_three_test.sql e
-- tenant_isolation_matrix_test.sql. Fixture minima e propria (prefixo 79),
-- todos os materiais como 'quantidade' para nao depender da regra de
-- unicidade de custodia individual.
--
-- Fixtures rodam como o dono do banco (bypassa RLS de proposito, inclusive
-- para gravar user_module_permissions diretamente em vez de passar pela RPC
-- set_user_module_permissions - mesmo atalho que os demais INSERTs de
-- fixture nesta suite). As asercoes trocam de papel via
-- set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE authenticated.

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
  '79100000-0000-4000-8000-000000000001', '__ccgwp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '79200000-0000-4000-8000-000000000001', '__ccgwp_company__', 'ativo',
  '79100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '79300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ccgwp-admin@example.test', '', now(), '{}', '{"full_name":"CCGWP Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '79300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ccgwp-nogrant@example.test', '', now(), '{}', '{"full_name":"CCGWP NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '79300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ccgwp-create@example.test', '', now(), '{}', '{"full_name":"CCGWP Create"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '79300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ccgwp-edit@example.test', '', now(), '{}', '{"full_name":"CCGWP Edit"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '79300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'ccgwp-delete@example.test', '', now(), '{}', '{"full_name":"CCGWP Delete"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '79300000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  '79300000-0000-4000-8000-000000000002', -- nogrant
  '79300000-0000-4000-8000-000000000003', -- create-only
  '79300000-0000-4000-8000-000000000004', -- edit-only
  '79300000-0000-4000-8000-000000000005'  -- delete-only
);

UPDATE public.profiles SET empresa_id = '79200000-0000-4000-8000-000000000001'
WHERE user_id IN (
  '79300000-0000-4000-8000-000000000001',
  '79300000-0000-4000-8000-000000000002',
  '79300000-0000-4000-8000-000000000003',
  '79300000-0000-4000-8000-000000000004',
  '79300000-0000-4000-8000-000000000005'
);

-- Two statements, dependencies first: 20260817230000_enforce_module_dependencies_all_flows.sql
-- added a trigger validating a module's dependencies are already active, so
-- checkin_checkout must be inserted only after gestao_materiais/controle_estoque
-- are committed - same order material_checkin_checkout_stage_three_test.sql uses.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '79200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '79200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';

-- can_view=true e obrigatorio (CHECK constraint) para qualquer outra flag;
-- cada usuario de teste recebe visualizar + exatamente UMA acao de escrita,
-- para provar que ela nunca desbloqueia as demais.
INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('79200000-0000-4000-8000-000000000001', '79300000-0000-4000-8000-000000000003', 'checkin_checkout', true, true, false, false),
  ('79200000-0000-4000-8000-000000000001', '79300000-0000-4000-8000-000000000004', 'checkin_checkout', true, false, true, false),
  ('79200000-0000-4000-8000-000000000001', '79300000-0000-4000-8000-000000000005', 'checkin_checkout', true, false, false, true);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('79400000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001', '__ccgwp_category__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('79500000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001', '79400000-0000-4000-8000-000000000001', 'CCGWP-M1', 'Material Create', 'quantidade', 'disponivel', true),
  ('79500000-0000-4000-8000-000000000002', '79200000-0000-4000-8000-000000000001', '79400000-0000-4000-8000-000000000001', 'CCGWP-M2', 'Material Edit', 'quantidade', 'disponivel', true),
  ('79500000-0000-4000-8000-000000000003', '79200000-0000-4000-8000-000000000001', '79400000-0000-4000-8000-000000000001', 'CCGWP-M3', 'Material Cancel', 'quantidade', 'disponivel', true),
  ('79500000-0000-4000-8000-000000000004', '79200000-0000-4000-8000-000000000001', '79400000-0000-4000-8000-000000000001', 'CCGWP-M4', 'Material Baixa', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('79600000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001', 'CCGWP-ORIG', 'Origem', true),
  ('79600000-0000-4000-8000-000000000002', '79200000-0000-4000-8000-000000000001', 'CCGWP-DEST', 'Destino', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('79200000-0000-4000-8000-000000000001', '79500000-0000-4000-8000-000000000001', '79600000-0000-4000-8000-000000000001', 10),
  ('79200000-0000-4000-8000-000000000001', '79500000-0000-4000-8000-000000000002', '79600000-0000-4000-8000-000000000001', 10),
  ('79200000-0000-4000-8000-000000000001', '79500000-0000-4000-8000-000000000003', '79600000-0000-4000-8000-000000000001', 10),
  ('79200000-0000-4000-8000-000000000001', '79500000-0000-4000-8000-000000000004', '79600000-0000-4000-8000-000000000001', 10);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('79700000-0000-4000-8000-000000000001', '79200000-0000-4000-8000-000000000001', '__ccgwp_responsible__', 'Tecnico');

-- ----------------------------------------------------------------------------
-- 1. USUARIO SEM NENHUM GRANT: le, mas nao executa nenhuma escrita
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '79300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.listar_custodias_materiais(_empresa_id => '79200000-0000-4000-8000-000000000001')$test$,
  'usuario sem grant ainda assim le - view nao e gated por grant granular neste modulo'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    NULL, 1, NULL, NULL, NULL, NULL, NULL, gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao registra check-out'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    NULL, 1, NULL, NULL, gen_random_uuid(), NULL, NULL, NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao registra check-in'
);
SELECT throws_ok(
  $test$SELECT public.cancelar_checkout_material(
    NULL, 'motivo', gen_random_uuid(), NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao cancela check-out'
);
SELECT throws_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    NULL, 1, 'extraviado', 'motivo', gen_random_uuid(), NULL, NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao registra baixa'
);
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'misto', 'bom', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario sem grant nao abre sessao de scanner remoto'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. ADMIN cria 3 custodias em aberto (M2/M3/M4) para os testes de
--    edit/cancelar/baixa abaixo - tambem serve de prova de que
--    admin_empresa continua com acesso irrestrito apos a migration.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '79300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000002', 5,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua com acesso irrestrito - checkout de M2 (alvo do teste de check-in)'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000003', 4,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa: checkout de M3 (alvo do teste de cancelamento)'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000004', 6,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa: checkout de M4 (alvo do teste de baixa)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO COM APENAS can_create: registra check-out, mas nao check-in
--    nem cancelamento
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '79300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000001', 2,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true registra check-out (permissao granular, sem precisar de admin_empresa)'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    NULL, 1, NULL, NULL, gen_random_uuid(), NULL, NULL, NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao registra check-in'
);
SELECT throws_ok(
  $test$SELECT public.cancelar_checkout_material(
    NULL, 'motivo', gen_random_uuid(), NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_create=true (sem can_delete) nao cancela check-out'
);
SELECT lives_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkout', 'bom', gen_random_uuid(), 'funcionario', '79700000-0000-4000-8000-000000000001',
    'evento', '79600000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com can_create=true abre sessao de scanner remoto tipo checkout'
);
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkin', 'bom', gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_create=true (sem can_edit) nao abre sessao de scanner remoto tipo checkin'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. USUARIO COM APENAS can_edit: registra check-in de uma custodia aberta
--    por outra pessoa, mas nao check-out nem cancelamento
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '79300000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format(
    $fmt$SELECT public.registrar_checkin_material(
      %L, 3, '79600000-0000-4000-8000-000000000002', 'bom', gen_random_uuid(), NULL, NULL, NULL,
      '79200000-0000-4000-8000-000000000001'
    )$fmt$,
    (SELECT id FROM public.material_custodias
     WHERE material_id = '79500000-0000-4000-8000-000000000002' AND status = 'aberta')
  ),
  'usuario com can_edit=true registra check-in de custodia aberta por outro usuario'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000001', 1,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_create) nao registra check-out'
);
SELECT throws_ok(
  $test$SELECT public.cancelar_checkout_material(
    NULL, 'motivo', gen_random_uuid(), NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_edit=true (sem can_delete) nao cancela check-out'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. USUARIO COM APENAS can_delete: cancela e da baixa em custodias abertas
--    por outra pessoa, mas nao registra check-out nem check-in
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '79300000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '79500000-0000-4000-8000-000000000001', 1,
    '79600000-0000-4000-8000-000000000001', 'funcionario',
    '79700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_delete=true (sem can_create) nao registra check-out'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    NULL, 1, NULL, NULL, gen_random_uuid(), NULL, NULL, NULL, '79200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'usuario com can_delete=true (sem can_edit) nao registra check-in'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.cancelar_checkout_material(%L, 'motivo teste', gen_random_uuid(), NULL,
      '79200000-0000-4000-8000-000000000001')$fmt$,
    (SELECT id FROM public.material_custodias
     WHERE material_id = '79500000-0000-4000-8000-000000000003' AND status = 'aberta')
  ),
  'usuario com can_delete=true cancela check-out aberto por outro usuario'
);
SELECT lives_ok(
  format(
    $fmt$SELECT public.registrar_baixa_custodia_material(%L, 2, 'extraviado', 'motivo teste',
      gen_random_uuid(), NULL, NULL, '79200000-0000-4000-8000-000000000001')$fmt$,
    (SELECT id FROM public.material_custodias
     WHERE material_id = '79500000-0000-4000-8000-000000000004' AND status IN ('aberta', 'parcial'))
  ),
  'usuario com can_delete=true registra baixa em custodia aberta por outro usuario'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
