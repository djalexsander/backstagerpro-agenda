-- generate_material_barcode now issues a valid 13-digit EAN-13 in the "200"
-- internal range (Gestão Pro standard, src/lib/barcode.ts). This suite pins:
--   1. the value has 13 digits;
--   2. its GS1 mod-10 check digit is correct (recomputed independently here);
--   3. successive calls produce different, strictly increasing codes;
--   4. replace_material_barcode returns another valid, different EAN-13;
--   5. the QR content and the immutable identificador_unico never change.
-- Plus the invariants that must survive the format change: per-company
-- counter isolation, idempotence, and the 42501 permission gate.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Independent re-derivation of the EAN-13 check digit (not a call into the
-- function under test): weight 1 on odd positions, 3 on even, from the left.
CREATE FUNCTION pg_temp.ean13_ok(_code text)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sum integer := 0;
  v_digit integer;
  v_position integer;
BEGIN
  IF _code !~ '^[0-9]{13}$' THEN
    RETURN false;
  END IF;
  FOR v_position IN 1..12 LOOP
    v_digit := substr(_code, v_position, 1)::integer;
    IF mod(v_position, 2) = 0 THEN
      v_digit := v_digit * 3;
    END IF;
    v_sum := v_sum + v_digit;
  END LOOP;
  RETURN mod(10 - mod(v_sum, 10), 10) = substr(_code, 13, 1)::integer;
END;
$fn$;

SELECT plan(29);

SELECT has_function(
  'public', 'generate_material_barcode', ARRAY['uuid'],
  'barcode generator RPC exists'
);
SELECT has_function(
  'public', 'replace_material_barcode', ARRAY['uuid'],
  'barcode replacement RPC exists'
);

-- Sanity-check the local re-derivation against known real EAN-13 barcodes.
SELECT ok(pg_temp.ean13_ok('4006381333931'), 'check-digit helper accepts a real EAN-13');
SELECT ok(NOT pg_temp.ean13_ok('4006381333930'), 'check-digit helper rejects a broken EAN-13');

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '90000000-0000-4000-8000-000000000001',
  '__ean13_barcode_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  (
    '90100000-0000-4000-8000-000000000001', '__ean13_barcode_company_a__',
    'ativo', '90000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  ),
  (
    '90100000-0000-4000-8000-000000000002', '__ean13_barcode_company_b__',
    'ativo', '90000000-0000-4000-8000-000000000001', false, false,
    'pago', now() + interval '30 days'
  );

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '90200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'ean13-barcode-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"EAN13 Barcode Admin A"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'ean13-barcode-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"EAN13 Barcode Admin B"}'::jsonb, now(), now()
  );

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id IN (
  '90200000-0000-4000-8000-000000000001',
  '90200000-0000-4000-8000-000000000002'
);

UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '90200000-0000-4000-8000-000000000001'::uuid
    THEN '90100000-0000-4000-8000-000000000001'::uuid
  ELSE '90100000-0000-4000-8000-000000000002'::uuid
END,
    ativado = true,
    activated_at = now()
WHERE user_id IN (
  '90200000-0000-4000-8000-000000000001',
  '90200000-0000-4000-8000-000000000002'
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
    '90100000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000002'
  );

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES
  (
    '90300000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    '__ean13_barcode_category_a__'
  ),
  (
    '90300000-0000-4000-8000-000000000002',
    '90100000-0000-4000-8000-000000000002',
    '__ean13_barcode_category_b__'
  );

-- m1: QR + barcode (ends as 'ambos'); m2 and m3: barcode only; m4: company B.
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES
  ('90400000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000001', 'EAN13-A-1', '__ean13_a_1__', 'individual', 1),
  ('90400000-0000-4000-8000-000000000002', '90100000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000001', 'EAN13-A-2', '__ean13_a_2__', 'individual', 1),
  ('90400000-0000-4000-8000-000000000003', '90100000-0000-4000-8000-000000000001', '90300000-0000-4000-8000-000000000001', 'EAN13-A-3', '__ean13_a_3__', 'individual', 1),
  ('90400000-0000-4000-8000-000000000004', '90100000-0000-4000-8000-000000000002', '90300000-0000-4000-8000-000000000002', 'EAN13-B-1', '__ean13_b_1__', 'individual', 1);

SELECT set_config('request.jwt.claim.sub', '90200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- m1 gets a QR first, so the barcode has an identity to preserve.
SELECT public.generate_material_qr_code('90400000-0000-4000-8000-000000000001');

CREATE TEMP TABLE m1_identity AS
SELECT identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '90400000-0000-4000-8000-000000000001';

-- 1. Thirteen digits, "200" range, first company sequence.
SELECT is(
  public.generate_material_barcode('90400000-0000-4000-8000-000000000001'),
  '2000000000015',
  'first company code is "200" + 000000001 + EAN-13 check digit'
);
SELECT is(
  length((SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001')),
  13,
  'the automatic barcode has exactly thirteen characters'
);
SELECT matches(
  (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  '^200[0-9]{10}$',
  'the automatic barcode is 13 numeric digits in the "200" internal range'
);

-- 2. The check digit is a valid EAN-13 check digit.
SELECT ok(
  pg_temp.ean13_ok((SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001')),
  'the generated code carries a valid EAN-13 check digit'
);
SELECT is(
  (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  '2000000000015',
  'the generated barcode is persisted verbatim'
);

-- 5. QR content and technical identifier untouched by generation.
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  (SELECT conteudo_qr_code FROM m1_identity),
  'generation leaves the QR content untouched'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  (SELECT identificador_unico FROM m1_identity),
  'generation leaves the immutable technical identifier untouched'
);
SELECT is(
  (SELECT tipo_identificacao::text FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  'ambos',
  'a material that already had a QR becomes "ambos" once the barcode exists'
);

-- 3. Successive calls: different, strictly increasing codes.
SELECT is(
  public.generate_material_barcode('90400000-0000-4000-8000-000000000002'),
  '2000000000022',
  'the second material consumes the next company sequence'
);
SELECT is(
  public.generate_material_barcode('90400000-0000-4000-8000-000000000003'),
  '2000000000039',
  'the third material consumes the next company sequence'
);
SELECT ok(
  (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001')
    < (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000002')
  AND (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000002')
    < (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000003'),
  'the three codes are strictly increasing'
);
SELECT is(
  (SELECT count(DISTINCT codigo_barras) FROM public.materiais
   WHERE id IN (
     '90400000-0000-4000-8000-000000000001',
     '90400000-0000-4000-8000-000000000002',
     '90400000-0000-4000-8000-000000000003'
   )),
  3::bigint,
  'the three codes are distinct'
);
SELECT ok(
  pg_temp.ean13_ok((SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000002'))
  AND pg_temp.ean13_ok((SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000003')),
  'every code in the sequence is a valid EAN-13'
);

-- Idempotence: a repeat call returns the stored code without consuming a
-- sequence number.
SELECT is(
  public.generate_material_barcode('90400000-0000-4000-8000-000000000001'),
  '2000000000015',
  'a repeated request returns the existing barcode'
);

-- material_barcode_counters is REVOKEd from authenticated; read it as the
-- owner, then restore the caller context.
RESET ROLE;
SELECT is(
  (SELECT ultima_sequencia FROM public.material_barcode_counters
   WHERE empresa_id = '90100000-0000-4000-8000-000000000001'),
  3,
  'the idempotent call did not advance the counter'
);
SELECT set_config('request.jwt.claim.sub', '90200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- 4. Replacement: another valid, different EAN-13.
CREATE TEMP TABLE m1_before_replace AS
SELECT codigo_barras AS old_code, identificador_unico, conteudo_qr_code
FROM public.materiais
WHERE id = '90400000-0000-4000-8000-000000000001';

SELECT is(
  public.replace_material_barcode('90400000-0000-4000-8000-000000000001'),
  '2000000000046',
  'replacement issues the next company sequence as an EAN-13'
);
SELECT isnt(
  (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  (SELECT old_code FROM m1_before_replace),
  'the replacement differs from the previous barcode'
);
SELECT matches(
  (SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  '^200[0-9]{10}$',
  'the replacement is also a 13-digit "200" EAN-13'
);
SELECT ok(
  pg_temp.ean13_ok((SELECT codigo_barras FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001')),
  'the replacement carries a valid EAN-13 check digit'
);
SELECT is(
  (SELECT conteudo_qr_code FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  (SELECT conteudo_qr_code FROM m1_before_replace),
  'replacement leaves the QR content untouched'
);
SELECT is(
  (SELECT identificador_unico FROM public.materiais WHERE id = '90400000-0000-4000-8000-000000000001'),
  (SELECT identificador_unico FROM m1_before_replace),
  'replacement leaves the immutable technical identifier untouched'
);

-- Per-company counter isolation: company B starts its own sequence at one.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '90200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.generate_material_barcode('90400000-0000-4000-8000-000000000004'),
  '2000000000015',
  'a second company runs an independent sequence starting at one'
);

-- Permission gate unchanged.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '90200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$ SELECT public.generate_material_barcode('90400000-0000-4000-8000-000000000004') $test$,
  '42501',
  NULL,
  'an administrator cannot generate a barcode for another company'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $test$ SELECT public.generate_material_barcode('90400000-0000-4000-8000-000000000002') $test$,
  '42501',
  NULL,
  'anonymous callers retain no execute permission on generation'
);
SELECT throws_ok(
  $test$ SELECT public.replace_material_barcode('90400000-0000-4000-8000-000000000002') $test$,
  '42501',
  NULL,
  'anonymous callers retain no execute permission on replacement'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
