-- ============================================================================
-- SCANNER REMOTO E5.1 - RETIRADA/DEVOLUÇÃO DE LOCAÇÃO COM GRANT GRANULAR
-- ============================================================================
--
-- Cobre 20260902120000_scanner_remoto_locacao_granular_permissions.sql:
-- registrar_retirada_locacao_material e registrar_devolucao_locacao_material
-- passam a aceitar um 'usuario' comum com o grant granular de Locação
-- (locacao_materiais 'create' para retirada, 'edit' para devolução), além do
-- admin_empresa/master de sempre. As DEMAIS RPCs de Locação continuam
-- admin-only (resolve_material_rental_company intocada) - a seção 5 prova
-- isso com cancelar_locacao_material.
--
-- Não reexercita a regra de negócio das RPCs (já coberta por
-- material_rentals_stage_four_test.sql) - só a nova barreira de permissão:
-- quem passa, quem não passa, e que um grant de uma ação não desbloqueia a
-- outra nem a rota física (checkin_checkout).
--
-- Fixtures rodam como dono do banco (bypassa RLS). Asserções trocam de papel
-- via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE authenticated.
-- Prefixo 8c.

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
  '8c100000-0000-4000-8000-000000000001', '__src51_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('8c200000-0000-4000-8000-000000000001', '__src51_company__', 'ativo',
   '8c100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('8c200000-0000-4000-8000-000000000002', '__src51_readonly__', 'ativo',
   '8c100000-0000-4000-8000-000000000001', false, false, 'pendente', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'src51-admin@example.test', '', now(), '{}', '{"full_name":"SRC51 Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'src51-full@example.test', '', now(), '{}', '{"full_name":"SRC51 Full"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'src51-nogrant@example.test', '', now(), '{}', '{"full_name":"SRC51 NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'src51-editonly@example.test', '', now(), '{}', '{"full_name":"SRC51 EditOnly"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'src51-loconly@example.test', '', now(), '{}', '{"full_name":"SRC51 LocOnly"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8c300000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'src51-readonly@example.test', '', now(), '{}', '{"full_name":"SRC51 Readonly"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '8c300000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  '8c300000-0000-4000-8000-000000000002', '8c300000-0000-4000-8000-000000000003',
  '8c300000-0000-4000-8000-000000000004', '8c300000-0000-4000-8000-000000000005',
  '8c300000-0000-4000-8000-000000000006'
);

UPDATE public.profiles
SET empresa_id = CASE user_id
      WHEN '8c300000-0000-4000-8000-000000000006'::uuid THEN '8c200000-0000-4000-8000-000000000002'::uuid
      ELSE '8c200000-0000-4000-8000-000000000001'::uuid
    END,
    ativado = true, activated_at = now()
WHERE user_id BETWEEN '8c300000-0000-4000-8000-000000000001'::uuid
                  AND '8c300000-0000-4000-8000-000000000006'::uuid;

-- Dependências em ordem canônica; locacao_materiais por último. Nas duas empresas.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company.id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES ('8c200000-0000-4000-8000-000000000001'::uuid), ('8c200000-0000-4000-8000-000000000002'::uuid)) company(id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company.id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES ('8c200000-0000-4000-8000-000000000001'::uuid), ('8c200000-0000-4000-8000-000000000002'::uuid)) company(id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company.id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES ('8c200000-0000-4000-8000-000000000001'::uuid), ('8c200000-0000-4000-8000-000000000002'::uuid)) company(id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key = 'locacao_materiais';

-- Grants granulares:
--   full     -> locacao create+edit + checkin_checkout create+edit  (rota completa)
--   editonly -> locacao EDIT + checkin_checkout create+edit          (só devolução)
--   loconly  -> locacao create+edit, SEM checkin_checkout            (barrado na rota física)
--   readonly -> locacao create+edit + checkin_checkout, mas empresa em somente-leitura
--   nogrant  -> nada
INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES
  ('8c200000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000002', 'locacao_materiais',  true, true,  true,  false),
  ('8c200000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000002', 'checkin_checkout',   true, true,  true,  false),
  ('8c200000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000004', 'locacao_materiais',  true, false, true,  false),
  ('8c200000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000004', 'checkin_checkout',   true, true,  true,  false),
  ('8c200000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000005', 'locacao_materiais',  true, true,  true,  false),
  ('8c200000-0000-4000-8000-000000000002', '8c300000-0000-4000-8000-000000000006', 'locacao_materiais',  true, true,  true,  false),
  ('8c200000-0000-4000-8000-000000000002', '8c300000-0000-4000-8000-000000000006', 'checkin_checkout',   true, true,  true,  false);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES
  ('8c400000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001', '__src51_cat__'),
  ('8c400000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002', '__src51_cat_ro__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('8c500000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001',
   '8c400000-0000-4000-8000-000000000001', 'SRC51-M', 'Material Locação', 'quantidade', 'disponivel', true),
  ('8c500000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002',
   '8c400000-0000-4000-8000-000000000002', 'SRC51-MRO', 'Material RO', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('8c600000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001', 'SRC51-O', 'Origem', true),
  ('8c600000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000001', 'SRC51-D', 'Destino', true),
  ('8c600000-0000-4000-8000-000000000003', '8c200000-0000-4000-8000-000000000002', 'SRC51-ORO', 'Origem RO', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('8c200000-0000-4000-8000-000000000001', '8c500000-0000-4000-8000-000000000001', '8c600000-0000-4000-8000-000000000001', 50),
  ('8c200000-0000-4000-8000-000000000002', '8c500000-0000-4000-8000-000000000002', '8c600000-0000-4000-8000-000000000003', 50);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES
  ('8c700000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001', '__src51_resp__', 'Tecnico'),
  ('8c700000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002', '__src51_resp_ro__', 'Tecnico');

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, ativo, created_by, updated_by)
VALUES
  ('8c800000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001',
   'pessoa_juridica', '__src51_cliente__', true,
   '8c300000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000001'),
  ('8c800000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002',
   'pessoa_juridica', '__src51_cliente_ro__', true,
   '8c300000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000001');

INSERT INTO public.material_locacoes (
  id, empresa_id, cliente_id, numero, status, retirada_prevista_em, devolucao_prevista_em,
  responsavel_tipo, responsavel_funcionario_id, responsavel_nome,
  client_uuid, payload_hash, created_by, updated_by
) VALUES
  ('8c900000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001',
   '8c800000-0000-4000-8000-000000000001', '__SRC51-LOC-1__', 'reservada',
   now(), now() + interval '3 days',
   'funcionario', '8c700000-0000-4000-8000-000000000001', '__src51_resp__',
   gen_random_uuid(), 'src51-loc-hash', '8c300000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000001'),
  ('8c900000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002',
   '8c800000-0000-4000-8000-000000000002', '__SRC51-LOC-RO__', 'reservada',
   now(), now() + interval '3 days',
   'funcionario', '8c700000-0000-4000-8000-000000000002', '__src51_resp_ro__',
   gen_random_uuid(), 'src51-loc-hash-ro', '8c300000-0000-4000-8000-000000000001', '8c300000-0000-4000-8000-000000000001');

INSERT INTO public.material_locacao_itens (id, empresa_id, locacao_id, material_id, quantidade_contratada)
VALUES
  ('8ca00000-0000-4000-8000-000000000001', '8c200000-0000-4000-8000-000000000001',
   '8c900000-0000-4000-8000-000000000001', '8c500000-0000-4000-8000-000000000001', 20),
  ('8ca00000-0000-4000-8000-000000000002', '8c200000-0000-4000-8000-000000000002',
   '8c900000-0000-4000-8000-000000000002', '8c500000-0000-4000-8000-000000000002', 20);

SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- 1. RETIRADA: bloqueios (nenhum muda estado - todos levantam antes)
-- ----------------------------------------------------------------------------

-- nogrant: sem nenhuma permissão de Locação -> 42501
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000003', true);
SELECT throws_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000001', '8ca00000-0000-4000-8000-000000000001', 2,
    '8c600000-0000-4000-8000-000000000001', 'funcionario', '8c700000-0000-4000-8000-000000000001',
    'bom', gen_random_uuid(), NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'usuario sem grant de Locação NÃO faz retirada'
);

-- editonly: tem locacao_materiais.edit mas NÃO create -> retirada (exige create) 42501
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000004', true);
SELECT throws_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000001', '8ca00000-0000-4000-8000-000000000001', 2,
    '8c600000-0000-4000-8000-000000000001', 'funcionario', '8c700000-0000-4000-8000-000000000001',
    'bom', gen_random_uuid(), NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'usuario com locacao_materiais.edit mas sem .create NÃO faz retirada (ação errada)'
);

-- loconly: passa o gate de Locação, mas a rota física (registrar_checkout_material)
-- exige checkin_checkout.create, que ele não tem -> 42501 da delegada
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000005', true);
SELECT throws_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000001', '8ca00000-0000-4000-8000-000000000001', 2,
    '8c600000-0000-4000-8000-000000000001', 'funcionario', '8c700000-0000-4000-8000-000000000001',
    'bom', gen_random_uuid(), NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para registrar check-out.',
  'usuario com Locação mas sem checkin_checkout.create é barrado na rota física'
);

-- ----------------------------------------------------------------------------
-- 2. RETIRADA: quem passa
-- ----------------------------------------------------------------------------

-- full: locacao create+edit + checkin_checkout create+edit -> retirada OK (era 42501 antes da E5.1)
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000001', '8ca00000-0000-4000-8000-000000000001', 4,
    '8c600000-0000-4000-8000-000000000001', 'funcionario', '8c700000-0000-4000-8000-000000000001',
    'bom', '8cd00000-0000-4000-8000-000000000001', NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com grant granular de Locação (create) + checkin_checkout (create) FAZ a retirada'
);
SELECT is(
  (SELECT status::text FROM public.material_locacoes WHERE id = '8c900000-0000-4000-8000-000000000001'),
  'em_andamento',
  'retirada pelo usuario granular moveu a locação para em_andamento'
);

-- admin: regressão - continua funcionando
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000001', '8ca00000-0000-4000-8000-000000000001', 3,
    '8c600000-0000-4000-8000-000000000001', 'funcionario', '8c700000-0000-4000-8000-000000000001',
    'bom', '8cd00000-0000-4000-8000-000000000002', NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  'admin_empresa continua fazendo retirada (regressão)'
);

-- ----------------------------------------------------------------------------
-- 3. DEVOLUÇÃO: quem passa / quem não passa
-- ----------------------------------------------------------------------------

-- editonly: tem locacao_materiais.edit + checkin_checkout.edit -> devolução OK
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000004', true);
SELECT lives_ok(
  $test$SELECT public.registrar_devolucao_locacao_material(
    '8c900000-0000-4000-8000-000000000001',
    (SELECT id FROM public.material_custodias
     WHERE referencia_tipo = 'locacao_item' AND referencia_id = '8ca00000-0000-4000-8000-000000000001'
       AND status IN ('aberta','parcial') ORDER BY retirada_em LIMIT 1),
    2, '8c600000-0000-4000-8000-000000000002', 'bom',
    '8cd00000-0000-4000-8000-000000000003', NULL, NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  'usuario com locacao_materiais.edit + checkin_checkout.edit FAZ a devolução'
);

-- nogrant: devolução -> 42501
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000003', true);
SELECT throws_ok(
  $test$SELECT public.registrar_devolucao_locacao_material(
    '8c900000-0000-4000-8000-000000000001',
    (SELECT id FROM public.material_custodias
     WHERE referencia_tipo = 'locacao_item' AND referencia_id = '8ca00000-0000-4000-8000-000000000001'
       AND status IN ('aberta','parcial') ORDER BY retirada_em LIMIT 1),
    1, '8c600000-0000-4000-8000-000000000002', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'usuario sem grant de Locação NÃO faz devolução'
);

-- ----------------------------------------------------------------------------
-- 4. MODO SOMENTE LEITURA (empresa 2): grant não vale nada
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000006', true);
SELECT throws_ok(
  $test$SELECT public.registrar_retirada_locacao_material(
    '8c900000-0000-4000-8000-000000000002', '8ca00000-0000-4000-8000-000000000002', 1,
    '8c600000-0000-4000-8000-000000000003', 'funcionario', '8c700000-0000-4000-8000-000000000002',
    'bom', gen_random_uuid(), NULL, NULL, '8c200000-0000-4000-8000-000000000002'
  )$test$,
  'LR010', 'A empresa está em modo somente leitura.',
  'empresa em somente-leitura bloqueia retirada mesmo com grant granular'
);

-- ----------------------------------------------------------------------------
-- 5. NENHUM VAZAMENTO: as demais RPCs de Locação continuam admin-only
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8c300000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $test$SELECT public.cancelar_locacao_material(
    '8c900000-0000-4000-8000-000000000001', 'teste', gen_random_uuid(),
    '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'usuario com grant granular de Locação NÃO cancela locação (resolve_material_rental_company intocada)'
);
SELECT throws_ok(
  $test$SELECT public.criar_locacao_material(
    '8c800000-0000-4000-8000-000000000001', now(), now() + interval '2 days',
    'funcionario', '8c700000-0000-4000-8000-000000000001', gen_random_uuid(),
    NULL, NULL, '8c200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'usuario com grant granular de Locação NÃO cria locação'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
