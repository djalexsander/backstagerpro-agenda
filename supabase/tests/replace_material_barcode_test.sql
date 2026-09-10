-- replace_material_barcode swaps an existing barcode for a fresh server-side
-- code in one transaction. Regression: the bare `SET codigo_barras = NULL`
-- intermediate step used to violate materiais_identification_type_content
-- (SQLSTATE 23514) for any material whose tipo_identificacao was
-- 'codigo_barras'/'ambos' -- i.e. every real barcode. The fix moves
-- codigo_barras and tipo_identificacao together. identificador_unico and
-- conteudo_qr_code must stay untouched throughout.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(20);

SELECT has_function(
  'public', 'replace_material_barcode', ARRAY['uuid'],
  'barcode replacement RPC exists'
);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '81000000-0000-4000-8000-000000000001',
  '__replace_barcode_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  (
    '82000000-0000-4000-8000-000000000001', '__replace_barcode_company_a__',
    'ativo', '81000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  ),
  (
    '82000000-0000-4000-8000-000000000002', '__replace_barcode_company_b__',
    'ativo', '81000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '83000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'replace-barcode-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Replace Barcode Admin A"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '83000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'replace-barcode-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Replace Barcode Admin B"}'::jsonb, now(), now()
  );

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id IN (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);

UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '83000000-0000-4000-8000-000000000001'::uuid
    THEN '82000000-0000-4000-8000-000000000001'::uuid
  ELSE '82000000-0000-4000-8000-000000000002'::uuid
END,
    ativado = true,
    activated_at = now()
WHERE user_id IN (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
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
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002'
  );

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES
  (
    '85000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '__replace_barcode_category_a__'
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    '__replace_barcode_category_b__'
  );

-- m1: QR + automatic barcode (tipo 'ambos'); m2: barcode only (tipo
-- 'codigo_barras'); m3: no identification at all; m4: another company.
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES
  ('86000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'REPLACE-A-1', '__replace_a_1__', 'individual', 1),
  ('86000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'REPLACE-A-2', '__replace_a_2__', 'individual', 1),
  ('86000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'REPLACE-A-3', '__replace_a_3__', 'individual', 1),
  ('86000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002', 'REPLACE-B-1', '__replace_b_1__', 'individual', 1);

SELECT set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- ------------------------------------------------------------------------
-- 1. Material with QR + barcode (tipo 'ambos').
-- ------------------------------------------------------------------------
SELECT public.generate_material_qr_code('86000000-0000-4000-8000-000000000001');
SELECT public.generate_material_barcode('86000000-0000-4000-8000-000000000001');

CREATE TEMP TABLE m1_before AS
SELECT codigo_barras AS old_barcode, identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '86000000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  'ambos',
  'a material with QR and an automatic barcode starts as ambos'
);

-- Before the fix this raised 23514 on the intermediate SET codigo_barras = NULL.
SELECT lives_ok(
  $test$ SELECT public.replace_material_barcode('86000000-0000-4000-8000-000000000001') $test$,
  'replacing the barcode of a QR+barcode material succeeds'
);

SELECT matches(
  (SELECT codigo_barras FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  '^[0-9]{10}$',
  'replacement writes a fresh 10-digit server-side code'
);
SELECT isnt(
  (SELECT codigo_barras FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  (SELECT old_barcode FROM m1_before),
  'the replacement differs from the previous barcode'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  (SELECT conteudo_qr_code FROM m1_before),
  'the QR content is untouched by the replacement'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  (SELECT identificador_unico FROM m1_before),
  'the immutable technical identifier is untouched by the replacement'
);
SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  'ambos',
  'the identification type is restored to ambos after the replacement'
);
SELECT is(
  (SELECT status_identificacao::text FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000001'),
  'ativa',
  'the identification stays active after the replacement'
);

-- ------------------------------------------------------------------------
-- 2. Material with only a barcode (tipo 'codigo_barras').
-- ------------------------------------------------------------------------
SELECT public.generate_material_barcode('86000000-0000-4000-8000-000000000002');

CREATE TEMP TABLE m2_before AS
SELECT codigo_barras AS old_barcode, identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '86000000-0000-4000-8000-000000000002';

SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  'codigo_barras',
  'a barcode-only material starts as codigo_barras'
);

SELECT lives_ok(
  $test$ SELECT public.replace_material_barcode('86000000-0000-4000-8000-000000000002') $test$,
  'replacing the barcode of a barcode-only material succeeds'
);

SELECT matches(
  (SELECT codigo_barras FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  '^[0-9]{10}$',
  'the barcode-only material also gets a fresh 10-digit code'
);
SELECT isnt(
  (SELECT codigo_barras FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  (SELECT old_barcode FROM m2_before),
  'the barcode-only replacement differs from the previous barcode'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  (SELECT identificador_unico FROM m2_before),
  'the technical identifier is untouched for a barcode-only material'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  NULL,
  'no QR content is invented for a barcode-only material'
);
SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '86000000-0000-4000-8000-000000000002'),
  'codigo_barras',
  'the identification type stays codigo_barras after the replacement'
);

-- ------------------------------------------------------------------------
-- 3. Preserved validation: nothing to replace.
-- ------------------------------------------------------------------------
SELECT throws_ok(
  $test$ SELECT public.replace_material_barcode('86000000-0000-4000-8000-000000000003') $test$,
  'P0001',
  'O material não possui código de barras para substituir.',
  'replacing a material without a barcode still fails explicitly'
);

-- ------------------------------------------------------------------------
-- 4. Missing permission and unknown material.
-- ------------------------------------------------------------------------
SELECT throws_ok(
  $test$ SELECT public.replace_material_barcode('86000000-0000-4000-8000-000000000004') $test$,
  '42501',
  NULL,
  'an administrator cannot replace a barcode for another company'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $test$ SELECT public.replace_material_barcode('86000000-0000-4000-8000-000000000001') $test$,
  '42501',
  NULL,
  'anonymous callers retain no execute permission'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$ SELECT public.replace_material_barcode('99999999-9999-4999-8999-999999999999') $test$,
  '42501',
  NULL,
  'replacing an unknown material fails as not found'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
