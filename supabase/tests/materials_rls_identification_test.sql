BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(38);

-- Paid, operational companies are used so these tests isolate the material
-- entitlement and user role checks from subscription-state failures.
INSERT INTO public.planos (
  id,
  nome,
  valor,
  max_usuarios,
  max_eventos,
  ativo,
  periodicidade,
  categoria
)
VALUES (
  '51000000-0000-4000-8000-000000000001',
  '__materials_rls_paid_plan__',
  100,
  20,
  100,
  true,
  'mensal',
  'plano_base'
);

INSERT INTO public.empresas (
  id,
  nome_empresa,
  status,
  plano_id,
  plano_bloqueado,
  precisa_escolher_plano,
  status_pagamento,
  vencimento
)
VALUES
  (
    '52000000-0000-4000-8000-000000000001',
    '__materials_rls_company_enabled__',
    'ativo',
    '51000000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    now() + interval '30 days'
  ),
  (
    '52000000-0000-4000-8000-000000000002',
    '__materials_rls_company_disabled__',
    'ativo',
    '51000000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    now() + interval '30 days'
  );

-- auth.users is the source of the profile/role projection. The production
-- trigger creates a safe usuario first; fixture setup, running as the database
-- owner, then assigns the canonical company and the two administrator roles.
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '53000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'materials-admin-enabled@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Materials Admin Enabled"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '53000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'materials-user-enabled@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Materials User Enabled"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '53000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'materials-admin-disabled@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Materials Admin Disabled"}'::jsonb,
    now(),
    now()
  );

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id IN (
  '53000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000003'
);

-- ativado=true e obrigatorio desde 20260817210000_enforce_account_activation_gate.sql
-- (get_user_empresa_id/has_role passam a filtrar p.ativado=true) - fixture
-- antiga (Stage 1) nunca setava.
UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '53000000-0000-4000-8000-000000000001'::uuid
    THEN '52000000-0000-4000-8000-000000000001'::uuid
  WHEN '53000000-0000-4000-8000-000000000002'::uuid
    THEN '52000000-0000-4000-8000-000000000001'::uuid
  WHEN '53000000-0000-4000-8000-000000000003'::uuid
    THEN '52000000-0000-4000-8000-000000000002'::uuid
END,
  ativado = true,
  activated_at = now()
WHERE user_id IN (
  '53000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000002',
  '53000000-0000-4000-8000-000000000003'
);

-- UPDATE, not INSERT: the AFTER INSERT ON empresas trigger
-- (provision_company_module_entitlements, 20260804190000) already seeds
-- every company with an 'inactive' row per catalog module - inserting again
-- collides with prevent_duplicate_company_module (BEFORE INSERT, 23505).
-- id is pinned to the literal the rest of this file already targets
-- (deactivate/reactivate block further down keys off this exact id).
UPDATE public.empresa_modules
SET id = '54000000-0000-4000-8000-000000000001',
    status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '52000000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key = 'gestao_materiais');

INSERT INTO public.categorias_materiais (
  id,
  empresa_id,
  nome
)
VALUES
  (
    '55000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    '__materials_rls_category_enabled__'
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000002',
    '__materials_rls_category_disabled__'
  );

INSERT INTO public.materiais (
  id,
  empresa_id,
  categoria_id,
  codigo_interno,
  codigo_barras,
  tipo_identificacao,
  nome,
  tipo_controle,
  quantidade
)
VALUES
  (
    '56000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    'RLS-IND-001',
    'SHARED-CODE-001',
    'ambos',
    '__materials_rls_individual__',
    'individual',
    1
  ),
  (
    '56000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    'RLS-QTY-001',
    NULL,
    'qr_code',
    '__materials_rls_quantity__',
    'quantidade',
    25
  );

SELECT lives_ok(
  $test$
    INSERT INTO public.materiais (
      id,
      empresa_id,
      categoria_id,
      codigo_interno,
      codigo_barras,
      tipo_identificacao,
      nome,
      tipo_controle,
      quantidade
    )
    VALUES (
      '56000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000002',
      '55000000-0000-4000-8000-000000000002',
      'RLS-IND-002',
      'SHARED-CODE-001',
      'codigo_barras',
      '__materials_rls_other_tenant__',
      'individual',
      1
    )
  $test$,
  'the same barcode is allowed in different companies'
);

SELECT ok(
  (
    SELECT identificador_unico IS NOT NULL
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000002'
  ),
  'a quantity-controlled material also receives a technical UUID'
);

INSERT INTO public.materiais_fotos (
  id,
  empresa_id,
  material_id,
  storage_path,
  nome_arquivo,
  tipo_arquivo,
  tamanho_arquivo
)
VALUES
  (
    '57000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000001/enabled.jpg',
    'enabled.jpg',
    'image/jpeg',
    1024
  ),
  (
    '57000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000002',
    '56000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/disabled.jpg',
    'disabled.jpg',
    'image/jpeg',
    1024
  );

INSERT INTO storage.objects (
  id,
  bucket_id,
  name,
  metadata
)
VALUES
  (
    '58000000-0000-4000-8000-000000000001',
    'material-photos',
    '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000001/enabled.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb
  ),
  (
    '58000000-0000-4000-8000-000000000002',
    'material-photos',
    '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/disabled.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb
  );

-- Enabled company administrator: real RLS is active because both the database
-- role and auth.uid() are changed, rather than merely calling policy helpers.
SELECT set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.materiais),
  2::bigint,
  'an administrator with the module reads only its company materials'
);

SELECT is(
  (SELECT count(*) FROM public.materiais_fotos),
  1::bigint,
  'an enabled administrator reads only its company photo metadata'
);

SELECT is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'material-photos'
  ),
  1::bigint,
  'Storage RLS exposes only the enabled company registered object'
);

SELECT ok(
  public.can_read_material_photo_object(
    '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000001/enabled.jpg'
  ),
  'the Storage helper permits a registered photo from the enabled company'
);

SELECT ok(
  NOT public.can_read_material_photo_object(
    '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/disabled.jpg'
  ),
  'the Storage helper hides a photo from another company'
);

SELECT lives_ok(
  $test$
    INSERT INTO storage.objects (
      id,
      bucket_id,
      name,
      metadata
    )
    VALUES (
      '58000000-0000-4000-8000-000000000003',
      'material-photos',
      '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000002/admin-upload.webp',
      '{"mimetype":"image/webp","size":1024}'::jsonb
    )
  $test$,
  'an enabled administrator can upload to its material Storage path'
);

SELECT lives_ok(
  $test$
    INSERT INTO public.materiais (
      id,
      empresa_id,
      categoria_id,
      codigo_interno,
      nome,
      tipo_controle,
      quantidade
    )
    VALUES (
      '56000000-0000-4000-8000-000000000004',
      '52000000-0000-4000-8000-000000000001',
      '55000000-0000-4000-8000-000000000001',
      'RLS-ADMIN-WRITE',
      '__materials_rls_admin_write__',
      'individual',
      1
    )
  $test$,
  'an enabled company administrator can insert a material'
);

SELECT is(
  public.generate_material_qr_code(
    '56000000-0000-4000-8000-000000000001'
  ),
  (
    SELECT
      'BACKSTAGE-PRO:MATERIAL:' || identificador_unico::text
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000001'
  ),
  'the QR RPC derives content only from the stable technical UUID'
);

SELECT is(
  public.generate_material_qr_code(
    '56000000-0000-4000-8000-000000000001'
  ),
  (
    SELECT conteudo_qr_code
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000001'
  ),
  'generating the same QR Code again is idempotent'
);

-- localizacao is a dead/legacy column (BACKSTAGE_PRO_STATUS_POS_AUDITORIA.md
-- P3 debt list) - a later migration revoked column-level UPDATE on it (and
-- on id/empresa_id/identificador_unico/quantidade/created_*, all correctly
-- immutable via GRANT, not just RLS), so it is no longer "mutable material
-- data" and including it here only made this lives_ok fail with a generic
-- permission-denied before ever reaching nome. Stale expectation, not a
-- functional regression - the column-level lockdown is the intended,
-- stronger design.
SELECT lives_ok(
  $test$
    UPDATE public.materiais
    SET nome = '__materials_rls_renamed__'
    WHERE id = '56000000-0000-4000-8000-000000000001'
  $test$,
  'an enabled administrator can update mutable material data'
);

SELECT is(
  (
    SELECT conteudo_qr_code
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000001'
  ),
  (
    SELECT
      'BACKSTAGE-PRO:MATERIAL:' || identificador_unico::text
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000001'
  ),
  'editing name does not change the QR Code'
);

-- identificador_unico now has no column-level UPDATE grant for authenticated
-- at all (defense in depth added after this test was written), so the
-- attempt is rejected at 42501 before the P0001 immutability trigger this
-- test originally targeted is even reached - the column is still provably
-- immutable, just via an earlier, stronger layer.
SELECT throws_ok(
  $test$
    UPDATE public.materiais
    SET identificador_unico = gen_random_uuid()
    WHERE id = '56000000-0000-4000-8000-000000000001'
  $test$,
  '42501',
  NULL,
  'the technical UUID remains immutable for an authorized administrator'
);

-- Format changed from a random "BSP-"+hex Code 128 value to a sequential,
-- per-company EAN-13 ("200" restricted-distribution prefix + 9-digit
-- sequence + check digit) by 20260910100000_material_barcode_ean13.sql,
-- covered in full by material_barcode_ean13_test.sql - this assertion
-- predates that change and still expected the old shape.
SELECT ok(
  public.generate_material_barcode(
    '56000000-0000-4000-8000-000000000002'
  ) ~ '^200[0-9]{10}$',
  'the barcode RPC generates a company-local EAN-13 value'
);

SELECT is(
  public.generate_material_barcode(
    '56000000-0000-4000-8000-000000000002'
  ),
  (
    SELECT codigo_barras
    FROM public.materiais
    WHERE id = '56000000-0000-4000-8000-000000000002'
  ),
  'automatic barcode generation is idempotent'
);

SELECT throws_ok(
  $test$
    UPDATE public.materiais
    SET codigo_barras = ' shared-code-001 ',
        tipo_identificacao = 'codigo_barras'
    WHERE id = '56000000-0000-4000-8000-000000000002'
  $test$,
  '23505',
  NULL,
  'a duplicate barcode is blocked inside the same company'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais_fotos (
      id,
      empresa_id,
      material_id,
      storage_path,
      nome_arquivo,
      tipo_arquivo,
      tamanho_arquivo
    )
    VALUES (
      '57000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000002',
      '56000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/forbidden.jpg',
      'forbidden.jpg',
      'image/jpeg',
      1024
    )
  $test$,
  '42501',
  NULL,
  'an enabled administrator cannot attach metadata to another company material'
);

RESET ROLE;

-- Enabled ordinary user: reads are allowed, writes remain administrative.
SELECT set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000002',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.materiais),
  3::bigint,
  'an ordinary user can read company materials when the module is enabled'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais (
      id,
      empresa_id,
      categoria_id,
      codigo_interno,
      nome,
      tipo_controle,
      quantidade
    )
    VALUES (
      '56000000-0000-4000-8000-000000000005',
      '52000000-0000-4000-8000-000000000001',
      '55000000-0000-4000-8000-000000000001',
      'RLS-USER-DENIED',
      '__materials_rls_user_denied__',
      'individual',
      1
    )
  $test$,
  '42501',
  NULL,
  'an ordinary user cannot insert materials'
);

SELECT is(
  (SELECT count(*) FROM public.materiais_fotos),
  1::bigint,
  'an ordinary user reads only registered photos from its enabled company'
);

SELECT throws_ok(
  $test$
    INSERT INTO storage.objects (
      id,
      bucket_id,
      name,
      metadata
    )
    VALUES (
      '58000000-0000-4000-8000-000000000004',
      'material-photos',
      '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000002/user-denied.webp',
      '{"mimetype":"image/webp","size":1024}'::jsonb
    )
  $test$,
  '42501',
  NULL,
  'an ordinary user cannot upload material photos'
);

RESET ROLE;

-- Disabled company administrator: role alone cannot bypass the commercial
-- entitlement for tables, RPC writes, or private photo authorization.
SELECT set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000003',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.materiais),
  0::bigint,
  'an administrator without the module cannot read materials'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais (
      id,
      empresa_id,
      categoria_id,
      codigo_interno,
      nome,
      tipo_controle,
      quantidade
    )
    VALUES (
      '56000000-0000-4000-8000-000000000006',
      '52000000-0000-4000-8000-000000000002',
      '55000000-0000-4000-8000-000000000002',
      'RLS-MODULE-DENIED',
      '__materials_rls_module_denied__',
      'individual',
      1
    )
  $test$,
  '42501',
  NULL,
  'an administrator without the module cannot insert materials'
);

SELECT is(
  (SELECT count(*) FROM public.materiais_fotos),
  0::bigint,
  'an administrator without the module cannot read photo metadata'
);

SELECT is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'material-photos'
  ),
  0::bigint,
  'an administrator without the module cannot read material photo objects'
);

SELECT throws_ok(
  $test$
    INSERT INTO storage.objects (
      id,
      bucket_id,
      name,
      metadata
    )
    VALUES (
      '58000000-0000-4000-8000-000000000005',
      'material-photos',
      '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/module-denied.webp',
      '{"mimetype":"image/webp","size":1024}'::jsonb
    )
  $test$,
  '42501',
  NULL,
  'an administrator without the module cannot upload material photos'
);

SELECT ok(
  NOT public.can_read_material_photo_object(
    '52000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000003/disabled.jpg'
  ),
  'private Storage authorization also fails when the module is disabled'
);

RESET ROLE;

-- Disable the previously enabled module as a trusted owner fixture operation.
-- Rows remain present, while authenticated access fails closed.
SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.empresa_modules
SET status = 'inactive'
WHERE id = '54000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT count(*)
    FROM public.materiais
    WHERE empresa_id = '52000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'module deactivation preserves all material rows'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.materiais_fotos
    WHERE empresa_id = '52000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'module deactivation preserves photo metadata'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.materiais),
  0::bigint,
  'deactivation immediately removes authenticated material access'
);

SELECT is(
  (SELECT count(*) FROM public.materiais_fotos),
  0::bigint,
  'deactivation immediately removes authenticated photo access'
);

SELECT is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'material-photos'
  ),
  0::bigint,
  'deactivation immediately removes authenticated Storage object access'
);

SELECT throws_ok(
  $test$
    SELECT public.generate_material_qr_code(
      '56000000-0000-4000-8000-000000000002'
    )
  $test$,
  '42501',
  NULL,
  'deactivation also blocks identification RPC writes'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.empresa_modules
SET status = 'active',
    activated_at = now()
WHERE id = '54000000-0000-4000-8000-000000000001';

SELECT set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.materiais),
  3::bigint,
  'reactivation restores access to the preserved material rows'
);

SELECT is(
  (SELECT count(*) FROM public.materiais_fotos),
  1::bigint,
  'reactivation restores access to the preserved photo metadata'
);

SELECT is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'material-photos'
  ),
  1::bigint,
  'reactivation restores access to the preserved Storage object'
);

SELECT ok(
  public.can_read_material_photo_object(
    '52000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000001/enabled.jpg'
  ),
  'reactivation restores private Storage authorization'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
