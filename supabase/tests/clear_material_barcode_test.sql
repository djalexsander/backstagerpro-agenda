-- clear_material_barcode removes only the barcode of an existing material.
-- The QR content and identificador_unico must survive untouched, and the
-- unchanged generate_material_barcode RPC must be able to issue a fresh code
-- afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(20);

SELECT has_function(
  'public', 'clear_material_barcode', ARRAY['uuid'],
  'barcode removal RPC exists'
);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '71000000-0000-4000-8000-000000000001',
  '__clear_barcode_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  (
    '72000000-0000-4000-8000-000000000001', '__clear_barcode_company_a__',
    'ativo', '71000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  ),
  (
    '72000000-0000-4000-8000-000000000002', '__clear_barcode_company_b__',
    'ativo', '71000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'clear-barcode-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Clear Barcode Admin A"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '73000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'clear-barcode-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Clear Barcode Admin B"}'::jsonb, now(), now()
  );

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id IN (
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000002'
);

UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '73000000-0000-4000-8000-000000000001'::uuid
    THEN '72000000-0000-4000-8000-000000000001'::uuid
  ELSE '72000000-0000-4000-8000-000000000002'::uuid
END,
    ativado = true,
    activated_at = now()
WHERE user_id IN (
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000002'
);

-- provision_company_module_entitlements already seeded an inactive row for
-- every catalog module when each company was inserted; activate the one this
-- suite needs.
UPDATE public.empresa_modules AS company_module
SET status = 'active',
    activated_at = now(),
    granted_by_admin = true,
    origem = 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.id = company_module.module_id
  AND catalog.feature_key = 'gestao_materiais'
  AND company_module.empresa_id IN (
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002'
  );

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES
  (
    '75000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    '__clear_barcode_category_a__'
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000002',
    '__clear_barcode_category_b__'
  );

-- m1: QR + automatic barcode (tipo 'ambos'); m2: barcode only (tipo
-- 'codigo_barras'); m3: no identification at all; m4: another company.
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'CLEAR-A-1', '__clear_a_1__', 'individual', 1),
  ('76000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'CLEAR-A-2', '__clear_a_2__', 'individual', 1),
  ('76000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'CLEAR-A-3', '__clear_a_3__', 'individual', 1),
  ('76000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000002', 'CLEAR-B-1', '__clear_b_1__', 'individual', 1);

SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- m1: QR + barcode.
SELECT public.generate_material_qr_code('76000000-0000-4000-8000-000000000001');
SELECT public.generate_material_barcode('76000000-0000-4000-8000-000000000001');

CREATE TEMP TABLE m1_identity AS
SELECT identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '76000000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  'ambos',
  'a material with QR and an automatic barcode starts as ambos'
);

SELECT lives_ok(
  $test$ SELECT public.clear_material_barcode('76000000-0000-4000-8000-000000000001') $test$,
  'removing the barcode of a QR+barcode material succeeds'
);

SELECT is(
  (SELECT codigo_barras FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  NULL,
  'the barcode is cleared'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  (SELECT conteudo_qr_code FROM m1_identity),
  'the QR content is preserved'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  (SELECT identificador_unico FROM m1_identity),
  'the immutable technical identifier is preserved'
);
SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  'qr_code',
  'the identification type falls back to qr_code'
);
SELECT is(
  (SELECT status_identificacao::text FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  'ativa',
  'the identification stays active while the QR remains'
);

-- The existing generator issues a fresh code with the current format
-- (13-digit "200" EAN-13 since 20260910100000).
SELECT matches(
  public.generate_material_barcode('76000000-0000-4000-8000-000000000001'),
  '^200[0-9]{10}$',
  'the unchanged generator issues a fresh EAN-13 barcode afterwards'
);
SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  'ambos',
  'regenerating restores the ambos identification type'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000001'),
  (SELECT conteudo_qr_code FROM m1_identity),
  'regenerating still leaves the QR content untouched'
);

-- m2: barcode only.
SELECT public.generate_material_barcode('76000000-0000-4000-8000-000000000002');
CREATE TEMP TABLE m2_identity AS
SELECT identificador_unico FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000002';

SELECT lives_ok(
  $test$ SELECT public.clear_material_barcode('76000000-0000-4000-8000-000000000002') $test$,
  'removing the only identification of a barcode-only material succeeds'
);
SELECT is(
  (SELECT codigo_barras FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000002'),
  NULL,
  'the barcode-only material loses its barcode'
);
SELECT is(
  (SELECT status_identificacao::text FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000002'),
  'nao_gerada',
  'a material with no remaining identification returns to nao_gerada'
);
SELECT is(
  (SELECT identificacao_gerada_em FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000002'),
  NULL,
  'the generation metadata is cleared with the last identification'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '76000000-0000-4000-8000-000000000002'),
  (SELECT identificador_unico FROM m2_identity),
  'the technical identifier survives even a full identification reset'
);

-- m3: nothing to remove.
SELECT throws_ok(
  $test$ SELECT public.clear_material_barcode('76000000-0000-4000-8000-000000000003') $test$,
  'P0001',
  'O material não possui código de barras para excluir.',
  'clearing a material without a barcode fails explicitly'
);

-- Cross-tenant and anonymous callers.
SELECT throws_ok(
  $test$ SELECT public.clear_material_barcode('76000000-0000-4000-8000-000000000004') $test$,
  '42501',
  NULL,
  'an administrator cannot clear a barcode for another company'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $test$ SELECT public.clear_material_barcode('76000000-0000-4000-8000-000000000001') $test$,
  '42501',
  NULL,
  'anonymous callers retain no execute permission'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$ SELECT public.clear_material_barcode('99999999-9999-4999-8999-999999999999') $test$,
  '42501',
  NULL,
  'clearing an unknown material fails as not found'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
