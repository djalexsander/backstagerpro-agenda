-- End-to-end coverage of the per-company barcode counter and both RPCs.
-- Since 20260910100000 the generated value is a 13-digit EAN-13 ("200" +
-- 9-digit company sequence + GS1 check digit); the counter, idempotence,
-- per-company isolation, exhaustion and permission behaviour are unchanged.
-- Focused format/check-digit assertions live in material_barcode_ean13_test.sql.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(30);

SELECT has_table('public', 'material_barcode_counters', 'per-company barcode counter exists');
SELECT has_function('public', 'generate_material_barcode', ARRAY['uuid'], 'barcode generator RPC exists');
SELECT has_function('public', 'replace_material_barcode', ARRAY['uuid'], 'barcode replacement RPC exists');

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '__short_barcode_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  (
    '62000000-0000-4000-8000-000000000001', '__short_barcode_company_a__',
    'ativo', '61000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  ),
  (
    '62000000-0000-4000-8000-000000000002', '__short_barcode_company_b__',
    'ativo', '61000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '63000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'short-barcode-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Short Barcode Admin A"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '63000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'short-barcode-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Short Barcode Admin B"}'::jsonb, now(), now()
  );

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id IN (
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002'
);

UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '63000000-0000-4000-8000-000000000001'::uuid
    THEN '62000000-0000-4000-8000-000000000001'::uuid
  ELSE '62000000-0000-4000-8000-000000000002'::uuid
END,
    ativado = true,
    activated_at = now()
WHERE user_id IN (
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002'
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
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002'
  );

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES
  (
    '65000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000001',
    '__short_barcode_category_a__'
  ),
  (
    '65000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000002',
    '__short_barcode_category_b__'
  );

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, codigo_barras,
  tipo_identificacao, nome, tipo_controle, quantidade
)
SELECT
  fixture.id,
  fixture.empresa_id,
  fixture.categoria_id,
  fixture.codigo_interno,
  fixture.codigo_barras,
  CASE WHEN fixture.codigo_barras IS NULL THEN 'qr_code' ELSE 'codigo_barras' END::public.material_identification_type,
  fixture.nome,
  'individual'::public.material_control_type,
  1
FROM (
  VALUES
    ('66000000-0000-4000-8000-000000000001'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-1', NULL::text, '__short_a_1__'),
    ('66000000-0000-4000-8000-000000000002'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-2', NULL::text, '__short_a_2__'),
    ('66000000-0000-4000-8000-000000000003'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-3', NULL::text, '__short_a_3__'),
    ('66000000-0000-4000-8000-000000000004'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-4', NULL::text, '__short_a_4__'),
    ('66000000-0000-4000-8000-000000000005'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-5', NULL::text, '__short_a_5__'),
    ('66000000-0000-4000-8000-000000000006'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-OLD', 'BSP-A968A4040E074A928FBF', '__short_a_old__'),
    ('66000000-0000-4000-8000-000000000007'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-MANUAL', 'MANUAL-ABC-123', '__short_a_manual__'),
    ('66000000-0000-4000-8000-000000000008'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-LIMIT', NULL::text, '__short_a_limit__'),
    ('66000000-0000-4000-8000-000000000009'::uuid, '62000000-0000-4000-8000-000000000001'::uuid, '65000000-0000-4000-8000-000000000001'::uuid, 'SHORT-A-EXHAUSTED', NULL::text, '__short_a_exhausted__'),
    ('66000000-0000-4000-8000-000000000010'::uuid, '62000000-0000-4000-8000-000000000002'::uuid, '65000000-0000-4000-8000-000000000002'::uuid, 'SHORT-B-1', NULL::text, '__short_b_1__')
) AS fixture(id, empresa_id, categoria_id, codigo_interno, codigo_barras, nome);

SELECT set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000001'), '2000000000015', 'first sequence is "200" + 000000001 + a valid EAN-13 check digit');
SELECT is(length((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000001')), 13, 'automatic barcode has exactly thirteen characters');
SELECT matches((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000001'), '^200[0-9]{10}$', 'automatic barcode is a 13-digit "200" EAN-13');
SELECT is((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000001'), '2000000000015', 'generated barcode is persisted');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000002'), '2000000000022', 'company sequence increments');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000003'), '2000000000039', 'third EAN-13 check digit is correct');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000004'), '2000000000046', 'fourth EAN-13 check digit is correct');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000005'), '2000000000053', 'fifth EAN-13 check digit is correct');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000001'), '2000000000015', 'repeated request returns the existing barcode');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000006'), 'BSP-A968A4040E074A928FBF', 'legacy BSP barcode is returned unchanged');
SELECT is((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000006'), 'BSP-A968A4040E074A928FBF', 'legacy BSP barcode remains persisted unchanged');
SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000007'), 'MANUAL-ABC-123', 'manual barcode is returned unchanged');
SELECT is((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000007'), 'MANUAL-ABC-123', 'manual barcode remains persisted unchanged');

UPDATE public.materiais
SET conteudo_qr_code = 'BACKSTAGE-PRO:MATERIAL:' || identificador_unico::text,
    tipo_identificacao = 'ambos'
WHERE id = '66000000-0000-4000-8000-000000000006';

CREATE TEMP TABLE replacement_identity_snapshot AS
SELECT identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '66000000-0000-4000-8000-000000000006';

SELECT is(public.replace_material_barcode('66000000-0000-4000-8000-000000000006'), '2000000000060', 'legacy BSP barcode is replaced only through the explicit RPC');
SELECT is((SELECT codigo_barras FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000006'), '2000000000060', 'replacement barcode is persisted');
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000006'),
  (SELECT identificador_unico FROM replacement_identity_snapshot),
  'replacement preserves the immutable identifier'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '66000000-0000-4000-8000-000000000006'),
  (SELECT conteudo_qr_code FROM replacement_identity_snapshot),
  'replacement preserves QR content'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000010'), '2000000000015', 'a second company starts an independent sequence at one');

RESET ROLE;
SELECT is((SELECT ultima_sequencia FROM public.material_barcode_counters WHERE empresa_id = '62000000-0000-4000-8000-000000000001'), 6, 'company A counter includes the explicit replacement');
SELECT is((SELECT ultima_sequencia FROM public.material_barcode_counters WHERE empresa_id = '62000000-0000-4000-8000-000000000002'), 1, 'company B counter advanced independently');

UPDATE public.material_barcode_counters
SET ultima_sequencia = 999999998
WHERE empresa_id = '62000000-0000-4000-8000-000000000001';

SELECT set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(public.generate_material_barcode('66000000-0000-4000-8000-000000000008'), '2009999999997', 'last valid sequence receives the correct EAN-13 check digit');
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('66000000-0000-4000-8000-000000000009')$test$,
  'P0001',
  'A sequência de códigos de barras desta empresa atingiu o limite de 999999999.',
  'sequence exhaustion fails explicitly'
);

RESET ROLE;
SELECT is((SELECT ultima_sequencia FROM public.material_barcode_counters WHERE empresa_id = '62000000-0000-4000-8000-000000000001'), 999999999, 'counter never exceeds its nine-digit limit');

SELECT set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('66000000-0000-4000-8000-000000000010')$test$,
  '42501',
  NULL,
  'an administrator cannot generate a barcode for another company'
);
SELECT throws_ok(
  $test$SELECT public.replace_material_barcode('66000000-0000-4000-8000-000000000010')$test$,
  '42501',
  NULL,
  'an administrator cannot replace a barcode for another company'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $test$SELECT public.generate_material_barcode('66000000-0000-4000-8000-000000000001')$test$,
  '42501',
  NULL,
  'anonymous callers retain no execute permission'
);
SELECT throws_ok(
  $test$SELECT public.replace_material_barcode('66000000-0000-4000-8000-000000000001')$test$,
  '42501',
  NULL,
  'anonymous callers cannot replace barcodes'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
