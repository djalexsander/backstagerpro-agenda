-- ============================================================================
-- CHECK-OUT COM VINCULO A EVENTO (referencia_tipo='evento')
-- ============================================================================
--
-- Cobre 20260821090000_checkout_event_reference.sql: registrar_checkout_material
-- passa a exigir, quando finalidade='evento', que referencia_tipo='evento' e
-- referencia_id aponte para um evento real da mesma empresa - e rejeita o
-- inverso (referencia_tipo='evento' sem a finalidade correspondente). Não
-- reexercita permissao granular (ja coberto por
-- checkin_checkout_granular_write_permissions_test.sql) nem as regras de
-- negocio ja cobertas por material_checkin_checkout_stage_three_test.sql -
-- so a validacao nova. Fixture minima e propria (prefixo 80), ator unico
-- admin_empresa (acesso irrestrito, isola o teste da granularidade).
--
-- Fixtures rodam como o dono do banco (bypassa RLS). As asercoes trocam de
-- papel via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE
-- authenticated, mesmo padrao do resto da suite.

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
  '80100000-0000-4000-8000-000000000001', '__cer_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('80200000-0000-4000-8000-000000000001', '__cer_company_a__', 'ativo',
   '80100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('80200000-0000-4000-8000-000000000002', '__cer_company_b__', 'ativo',
   '80100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '80300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'cer-admin-a@example.test', '', now(),
   '{}', '{"full_name":"CER Admin A"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '80300000-0000-4000-8000-000000000001';

UPDATE public.profiles SET empresa_id = '80200000-0000-4000-8000-000000000001'
WHERE user_id = '80300000-0000-4000-8000-000000000001';

-- Dependencias primeiro (trigger de 20260817230000_enforce_module_dependencies_all_flows.sql
-- valida que checkin_checkout so ativa se gestao_materiais/controle_estoque
-- ja estiverem ativos na mesma transacao) - mesma ordem de
-- checkin_checkout_granular_write_permissions_test.sql.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '80200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '80200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('80400000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', '__cer_category__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES (
  '80500000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001',
  '80400000-0000-4000-8000-000000000001', 'CER-M1', 'Material Evento', 'quantidade', 'disponivel', true
);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES ('80600000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', 'CER-ORIG', 'Origem', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES ('80200000-0000-4000-8000-000000000001', '80500000-0000-4000-8000-000000000001',
        '80600000-0000-4000-8000-000000000001', 10);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('80700000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001', '__cer_responsible__', 'Tecnico');

-- Evento real da empresa A (deve ser aceito) e evento de outra empresa B
-- (deve ser rejeitado - referencia_id nao tem FK, entao esta e a unica
-- barreira de integridade cross-tenant possivel).
INSERT INTO public.events (id, empresa_id, name, artist, city, venue, date)
VALUES
  ('80800000-0000-4000-8000-000000000001', '80200000-0000-4000-8000-000000000001',
   '__cer_event_a__', 'Artista A', 'Cidade A', 'Local A', current_date),
  ('80800000-0000-4000-8000-000000000002', '80200000-0000-4000-8000-000000000002',
   '__cer_event_b__', 'Artista B', 'Cidade B', 'Local B', current_date);

-- ----------------------------------------------------------------------------
-- 1. FINALIDADE 'evento' EXIGE referencia_tipo='evento' + evento real da empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 1,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  'CI022', NULL,
  'finalidade evento sem nenhuma referencia e rejeitada'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 1,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento', gen_random_uuid(),
    NULL, '80200000-0000-4000-8000-000000000001'
  )$test$,
  'CI022', NULL,
  'finalidade evento com um evento inexistente e rejeitada'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 1,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento',
    '80800000-0000-4000-8000-000000000002',
    NULL, '80200000-0000-4000-8000-000000000001'
  )$test$,
  'CI022', NULL,
  'finalidade evento apontando para evento de OUTRA empresa e rejeitada'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 1,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento',
    '80800000-0000-4000-8000-000000000001',
    NULL, '80200000-0000-4000-8000-000000000001'
  )$test$,
  'CI022', NULL,
  'referencia_tipo evento sem a finalidade evento correspondente e rejeitada'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 2,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento',
    '80800000-0000-4000-8000-000000000001',
    NULL, '80200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade evento com um evento real da mesma empresa e aceita'
);
SELECT is(
  (SELECT referencia_tipo FROM public.material_custodias
   WHERE material_id = '80500000-0000-4000-8000-000000000001' AND finalidade = 'evento'),
  'evento',
  'a custodia gravada carrega referencia_tipo=evento'
);
SELECT is(
  (SELECT referencia_id FROM public.material_custodias
   WHERE material_id = '80500000-0000-4000-8000-000000000001' AND finalidade = 'evento'),
  '80800000-0000-4000-8000-000000000001'::uuid,
  'a custodia gravada carrega referencia_id = id do evento selecionado'
);

-- ----------------------------------------------------------------------------
-- 2. DEMAIS FINALIDADES CONTINUAM SEM EXIGIR REFERENCIA (regressao)
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '80500000-0000-4000-8000-000000000001', 1,
    '80600000-0000-4000-8000-000000000001', 'funcionario',
    '80700000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    gen_random_uuid(), NULL, NULL, NULL, NULL, NULL,
    '80200000-0000-4000-8000-000000000001'
  )$test$,
  'finalidade uso_interno sem nenhuma referencia continua aceita, como antes desta migration'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
