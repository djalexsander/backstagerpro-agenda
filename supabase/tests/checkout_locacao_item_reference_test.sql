-- ============================================================================
-- CHECK-OUT COM FINALIDADE 'locacao' EXIGE ITEM REAL (referencia_tipo='locacao_item')
-- ============================================================================
--
-- Cobre 20260824140000_checkout_locacao_item_reference.sql:
-- registrar_checkout_material passa a exigir, quando finalidade='locacao',
-- que referencia_tipo='locacao_item' aponte para um item real de
-- material_locacao_itens desta empresa, para o mesmo material que está
-- saindo - e rejeita o inverso (referencia_tipo='locacao_item' sem a
-- finalidade correspondente). Mesmo espírito e mesmo formato de
-- supabase/tests/checkout_event_reference_test.sql (que cobre o par
-- equivalente para 'evento'); não reexercita permissão granular nem as
-- regras de negócio já cobertas por material_checkin_checkout_stage_three_test.sql
-- ou material_rentals_stage_four_test.sql - só a validação nova. Fixture
-- mínima e própria (prefixo 85), ator único admin_empresa (acesso
-- irrestrito, isola o teste da granularidade).
--
-- Fixtures rodam como o dono do banco (bypassa RLS). As asserções trocam de
-- papel via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE
-- authenticated, mesmo padrão do resto da suite. material_locacoes e
-- material_locacao_itens são inseridos diretamente (não via
-- criar_locacao_material/adicionar_item_locacao_material) para controlar
-- exatamente qual material cada item referencia, sem depender do fluxo
-- comercial completo - registrar_retirada_locacao_material (não alterada
-- por esta migration) já garante essa mesma forma na prática.

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
  '85100000-0000-4000-8000-000000000001', '__clr_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('85200000-0000-4000-8000-000000000001', '__clr_company_a__', 'ativo',
   '85100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('85200000-0000-4000-8000-000000000002', '__clr_company_b__', 'ativo',
   '85100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '85300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'clr-admin-a@example.test', '', now(),
   '{}', '{"full_name":"CLR Admin A"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '85300000-0000-4000-8000-000000000001';

UPDATE public.profiles SET empresa_id = '85200000-0000-4000-8000-000000000001'
WHERE user_id = '85300000-0000-4000-8000-000000000001';

-- Dependências primeiro (trigger de 20260817230000_enforce_module_dependencies_all_flows.sql
-- valida que checkin_checkout só ativa se gestao_materiais/controle_estoque
-- já estiverem ativos na mesma transação) - mesma ordem de
-- checkout_event_reference_test.sql. locacao_materiais não é necessário:
-- registrar_checkout_material só exige o módulo checkin_checkout.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '85200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '85200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('85400000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001', '__clr_category__');

-- Material "correto" (o que efetivamente sai e é o material do item de
-- locação) e material "errado" (outro material da mesma empresa, usado só
-- para provar que a checagem rejeita item/material que não combinam).
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('85500000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001',
   '85400000-0000-4000-8000-000000000001', 'CLR-M1', 'Material Locação Correto', 'quantidade', 'disponivel', true),
  ('85500000-0000-4000-8000-000000000002', '85200000-0000-4000-8000-000000000001',
   '85400000-0000-4000-8000-000000000001', 'CLR-M2', 'Material Locação Errado', 'quantidade', 'disponivel', true),
  ('85500000-0000-4000-8000-000000000003', '85200000-0000-4000-8000-000000000002',
   '85400000-0000-4000-8000-000000000001', 'CLR-M3', 'Material Empresa B', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES ('85600000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001', 'CLR-ORIG', 'Origem', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('85200000-0000-4000-8000-000000000001', '85500000-0000-4000-8000-000000000001',
   '85600000-0000-4000-8000-000000000001', 10),
  ('85200000-0000-4000-8000-000000000001', '85500000-0000-4000-8000-000000000002',
   '85600000-0000-4000-8000-000000000001', 10);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('85700000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001', '__clr_responsible__', 'Tecnico');

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, ativo, created_by, updated_by)
VALUES
  ('85800000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001',
   'pessoa_fisica', '__clr_customer_a__', true, '85300000-0000-4000-8000-000000000001', '85300000-0000-4000-8000-000000000001'),
  ('85800000-0000-4000-8000-000000000002', '85200000-0000-4000-8000-000000000002',
   'pessoa_fisica', '__clr_customer_b__', true, '85300000-0000-4000-8000-000000000001', '85300000-0000-4000-8000-000000000001');

-- Locação real da empresa A (com um item para o material "correto") e
-- locação real da empresa B (com um item para o material da empresa B) -
-- inseridas direto, sem passar pela fachada comercial, só para existirem
-- como referência polimórfica válida/inválida nos testes abaixo.
INSERT INTO public.material_locacoes (
  id, empresa_id, cliente_id, numero, retirada_prevista_em, devolucao_prevista_em,
  responsavel_tipo, responsavel_funcionario_id, responsavel_nome,
  client_uuid, payload_hash, created_by, updated_by
) VALUES
  ('85900000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001',
   '85800000-0000-4000-8000-000000000001', '__CLR-A-0001__', now(), now() + interval '2 days',
   'funcionario', '85700000-0000-4000-8000-000000000001', '__clr_responsible__',
   gen_random_uuid(), 'clr-fixture-hash-a', '85300000-0000-4000-8000-000000000001', '85300000-0000-4000-8000-000000000001'),
  ('85900000-0000-4000-8000-000000000002', '85200000-0000-4000-8000-000000000002',
   '85800000-0000-4000-8000-000000000002', '__CLR-B-0001__', now(), now() + interval '2 days',
   'funcionario', '85700000-0000-4000-8000-000000000001', '__clr_responsible__',
   gen_random_uuid(), 'clr-fixture-hash-b', '85300000-0000-4000-8000-000000000001', '85300000-0000-4000-8000-000000000001');

INSERT INTO public.material_locacao_itens (
  id, empresa_id, locacao_id, material_id, quantidade_contratada
) VALUES
  ('85a00000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001',
   '85900000-0000-4000-8000-000000000001', '85500000-0000-4000-8000-000000000001', 5),
  ('85a00000-0000-4000-8000-000000000002', '85200000-0000-4000-8000-000000000002',
   '85900000-0000-4000-8000-000000000002', '85500000-0000-4000-8000-000000000003', 5);

-- Evento real da empresa A - só para a checagem de regressão da seção 3
-- (prova que o novo bloco 'locacao' não interferiu no bloco 'evento'
-- existente, já integralmente coberto por checkout_event_reference_test.sql).
INSERT INTO public.events (id, empresa_id, name, artist, city, venue, date)
VALUES ('85b00000-0000-4000-8000-000000000001', '85200000-0000-4000-8000-000000000001',
        '__clr_event_a__', 'Artista A', 'Cidade A', 'Local A', current_date);

SELECT set_config('request.jwt.claim.sub', '85300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- 1. FINALIDADE 'locacao' EXIGE referencia_tipo='locacao_item' + item real
--    desta empresa PARA O MESMO MATERIAL
-- ----------------------------------------------------------------------------

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'locacao', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI023', NULL,
  'finalidade locacao sem nenhuma referencia e rejeitada'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'locacao', 'bom',
    gen_random_uuid(), NULL, NULL, 'locacao_item', gen_random_uuid(),
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI023', NULL,
  'finalidade locacao com um item de locacao inexistente e rejeitada'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000002', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'locacao', 'bom',
    gen_random_uuid(), NULL, NULL, 'locacao_item',
    '85a00000-0000-4000-8000-000000000001',
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI023', NULL,
  'item de locacao real mas de OUTRO material e rejeitado (material nao corresponde ao item)'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'locacao', 'bom',
    gen_random_uuid(), NULL, NULL, 'locacao_item',
    '85a00000-0000-4000-8000-000000000002',
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI023', NULL,
  'item de locacao real mas de OUTRA empresa e rejeitado'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    gen_random_uuid(), NULL, NULL, 'locacao_item',
    '85a00000-0000-4000-8000-000000000001',
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI023', NULL,
  'referencia_tipo locacao_item sem a finalidade locacao correspondente e rejeitada'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 2,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'locacao', 'bom',
    gen_random_uuid(), NULL, NULL, 'locacao_item',
    '85a00000-0000-4000-8000-000000000001',
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade locacao com um item real da mesma empresa para o mesmo material e aceita (forma exata usada por registrar_retirada_locacao_material)'
);
SELECT is(
  (SELECT referencia_tipo FROM public.material_custodias
   WHERE material_id = '85500000-0000-4000-8000-000000000001' AND finalidade = 'locacao'),
  'locacao_item',
  'a custodia gravada carrega referencia_tipo=locacao_item'
);
SELECT is(
  (SELECT referencia_id FROM public.material_custodias
   WHERE material_id = '85500000-0000-4000-8000-000000000001' AND finalidade = 'locacao'),
  '85a00000-0000-4000-8000-000000000001'::uuid,
  'a custodia gravada carrega referencia_id = id do item de locacao selecionado'
);

-- ----------------------------------------------------------------------------
-- 2. DEMAIS FINALIDADES CONTINUAM SEM EXIGIR REFERENCIA (regressao)
-- ----------------------------------------------------------------------------

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'cliente', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade cliente sem nenhuma referencia continua aceita - saida avulsa independente de locacao'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade uso_interno sem nenhuma referencia continua aceita, como antes desta migration'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'manutencao', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade manutencao sem nenhuma referencia continua aceita'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'transferencia_operacional', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade transferencia_operacional sem nenhuma referencia continua aceita'
);

-- ----------------------------------------------------------------------------
-- 3. FINALIDADE 'evento' CONTINUA EXIGINDO REFERENCIA (sem regressao do
--    bloco existente, ja integralmente coberto por checkout_event_reference_test.sql)
-- ----------------------------------------------------------------------------

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '85200000-0000-4000-8000-000000000001'
  )$test$,
  'CI022', NULL,
  'finalidade evento sem nenhuma referencia continua rejeitada'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '85500000-0000-4000-8000-000000000001', 1,
    '85600000-0000-4000-8000-000000000001', 'funcionario',
    '85700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento',
    '85b00000-0000-4000-8000-000000000001',
    NULL, '85200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade evento com um evento real da mesma empresa continua aceita'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
