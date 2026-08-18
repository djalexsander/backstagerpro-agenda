BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- Structural, modular and least-privilege contract.
SELECT has_table('public', 'material_custodias', 'custody operation table exists');
SELECT has_table('public', 'material_custodia_eventos', 'append-only custody event table exists');
SELECT has_type('public', 'material_custody_condition', 'physical condition enum exists');
SELECT has_type('public', 'material_custody_purpose', 'purpose enum exists');
SELECT has_type('public', 'material_custody_status', 'custody status enum exists');
SELECT has_type('public', 'material_custody_event_type', 'custody event enum exists');
SELECT has_function(
  'public', 'registrar_checkout_material',
  ARRAY['uuid','integer','uuid','text','uuid','text','text','uuid','timestamp with time zone','text','text','uuid','timestamp with time zone','uuid'],
  'atomic checkout RPC exists'
);
SELECT has_function(
  'public', 'registrar_checkin_material',
  ARRAY['uuid','integer','uuid','text','uuid','text','text','timestamp with time zone','uuid'],
  'atomic checkin RPC exists'
);
SELECT has_function(
  'public', 'cancelar_checkout_material',
  ARRAY['uuid','text','uuid','timestamp with time zone','uuid'],
  'explicit cancellation RPC exists'
);
SELECT has_function(
  'public', 'registrar_baixa_custodia_material',
  ARRAY['uuid','integer','text','text','uuid','text','timestamp with time zone','uuid'],
  'stock-neutral custody write-off RPC exists'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.registrar_baixa_custodia_material(uuid,integer,text,text,uuid,text,timestamp with time zone,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.registrar_baixa_custodia_material(uuid,integer,text,text,uuid,text,timestamp with time zone,uuid)', 'EXECUTE'),
  'write-off RPC is explicit authenticated-only API'
);
SELECT ok(
  (SELECT ativo FROM public.module_catalog WHERE feature_key = 'checkin_checkout'),
  'checkin_checkout is released in the canonical catalog'
);
SELECT ok(
  NOT (SELECT metadata ? 'planned' FROM public.module_catalog WHERE feature_key = 'checkin_checkout'),
  'released module is no longer marked planned'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.module_dependencies AS dependency
    JOIN public.module_catalog AS child ON child.id = dependency.module_id
    JOIN public.module_catalog AS parent ON parent.id = dependency.required_module_id
    WHERE child.feature_key = 'checkin_checkout'
      AND parent.feature_key IN ('gestao_materiais', 'controle_estoque')
  ),
  2::bigint,
  'custody depends on materials and canonical stock'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.material_custodias'::regclass),
  'custodies have RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.material_custodia_eventos'::regclass),
  'custody events have RLS'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.material_custodias', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.material_custodias', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.material_custodias', 'DELETE'),
  'authenticated clients cannot write custody rows directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.material_custodia_eventos', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.material_custodia_eventos', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.material_custodia_eventos', 'DELETE'),
  'authenticated clients cannot write custody events directly'
);
SELECT has_index(
  'public', 'material_custodias', 'material_custodias_individual_active_uidx',
  'individual material has one active-custody barrier'
);
SELECT has_trigger(
  'public', 'material_custodias', 'protect_material_custodias',
  'custody operation history is protected'
);
SELECT has_trigger(
  'public', 'material_custodia_eventos', 'protect_material_custodia_eventos',
  'custody event ledger is append-only'
);
SELECT ok(
  pg_get_functiondef(
    'public.apply_stock_movement(uuid,uuid,public.estoque_movimentacao_tipo,integer,uuid,uuid,text,text,text,text,timestamp with time zone,public.estoque_origem_modulo,uuid,uuid,text,uuid)'::regprocedure
  ) ILIKE '%checkin_checkout%',
  'the canonical stock writer authorizes the released custody source'
);
SELECT ok(
  pg_get_functiondef(
    'public.registrar_checkout_material(uuid,integer,uuid,text,uuid,text,text,uuid,timestamp with time zone,text,text,uuid,timestamp with time zone,uuid)'::regprocedure
  ) ILIKE '%FOR UPDATE%'
  AND pg_get_functiondef(
    'public.registrar_checkout_material(uuid,integer,uuid,text,uuid,text,text,uuid,timestamp with time zone,text,text,uuid,timestamp with time zone,uuid)'::regprocedure
  ) ILIKE '%pg_advisory_xact_lock%'
  AND pg_get_functiondef(
    'public.registrar_checkout_material(uuid,integer,uuid,text,uuid,text,text,uuid,timestamp with time zone,text,text,uuid,timestamp with time zone,uuid)'::regprocedure
  ) ILIKE '%apply_stock_movement%'
  AND pg_get_functiondef(
    'public.registrar_checkout_material(uuid,integer,uuid,text,uuid,text,text,uuid,timestamp with time zone,text,text,uuid,timestamp with time zone,uuid)'::regprocedure
  ) ILIKE '%INSERT INTO public.material_custodias%',
  'checkout serializes material and idempotency while coupling custody to stock'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'resolve_custody_company',
        'resolve_custody_responsible_name',
        'protect_material_custody_history',
        'apply_stock_movement'
      )
      AND has_function_privilege('authenticated', function.oid, 'EXECUTE')
  ),
  0::bigint,
  'internal custody/stock functions are not executable by clients'
);

-- Operational fixtures. All data is rolled back.
INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
)
VALUES
  ('71000000-0000-4000-8000-000000000001', '__custody_paid_plan__', 100, 20, 100, true, 'mensal', 'plano_base');

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
)
VALUES
  ('72000000-0000-4000-8000-000000000001', '__custody_company_a__', 'ativo', '71000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('72000000-0000-4000-8000-000000000002', '__custody_company_b__', 'ativo', '71000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('72000000-0000-4000-8000-000000000003', '__custody_module_disabled__', 'ativo', '71000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('72000000-0000-4000-8000-000000000004', '__custody_read_only__', 'ativo', '71000000-0000-4000-8000-000000000001', false, false, 'pendente', now() + interval '30 days');

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
)
SELECT
  '72000000-0000-4000-8000-000000000005',
  '__custody_lifetime__',
  'ativo',
  plan.id,
  false,
  false,
  'isento',
  NULL
FROM public.planos AS plan
WHERE plan.nome = 'Vitalícia'
  AND plan.periodicidade = 'vitalicio';

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'custody-admin-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'custody-user-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'custody-admin-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'custody-admin-disabled@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody Admin Disabled"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'custody-admin-readonly@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody Admin Readonly"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'custody-admin-lifetime@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Custody Admin Lifetime"}', now(), now());

UPDATE public.user_roles
SET role = 'admin_empresa'
WHERE user_id <> '73000000-0000-4000-8000-000000000002'
  AND user_id BETWEEN '73000000-0000-4000-8000-000000000001'::uuid
                  AND '73000000-0000-4000-8000-000000000006'::uuid;

UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN '73000000-0000-4000-8000-000000000001'::uuid THEN '72000000-0000-4000-8000-000000000001'::uuid
  WHEN '73000000-0000-4000-8000-000000000002'::uuid THEN '72000000-0000-4000-8000-000000000001'::uuid
  WHEN '73000000-0000-4000-8000-000000000003'::uuid THEN '72000000-0000-4000-8000-000000000002'::uuid
  WHEN '73000000-0000-4000-8000-000000000004'::uuid THEN '72000000-0000-4000-8000-000000000003'::uuid
  WHEN '73000000-0000-4000-8000-000000000005'::uuid THEN '72000000-0000-4000-8000-000000000004'::uuid
  WHEN '73000000-0000-4000-8000-000000000006'::uuid THEN '72000000-0000-4000-8000-000000000005'::uuid
END
WHERE user_id BETWEEN '73000000-0000-4000-8000-000000000001'::uuid
                  AND '73000000-0000-4000-8000-000000000006'::uuid;

-- Activate dependencies in canonical order for A, B and read-only. The
-- disabled fixture intentionally omits checkin_checkout. Lifetime requires no
-- empresa_modules rows and exercises the canonical license path.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company_id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES
  ('72000000-0000-4000-8000-000000000001'::uuid),
  ('72000000-0000-4000-8000-000000000002'::uuid),
  ('72000000-0000-4000-8000-000000000003'::uuid),
  ('72000000-0000-4000-8000-000000000004'::uuid)
) AS company(company_id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key = 'gestao_materiais';

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company_id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES
  ('72000000-0000-4000-8000-000000000001'::uuid),
  ('72000000-0000-4000-8000-000000000002'::uuid),
  ('72000000-0000-4000-8000-000000000003'::uuid),
  ('72000000-0000-4000-8000-000000000004'::uuid)
) AS company(company_id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key = 'controle_estoque';

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company_id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES
  ('72000000-0000-4000-8000-000000000001'::uuid),
  ('72000000-0000-4000-8000-000000000002'::uuid),
  ('72000000-0000-4000-8000-000000000004'::uuid)
) AS company(company_id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';

SELECT ok(
  public.company_has_active_module('72000000-0000-4000-8000-000000000005', 'checkin_checkout')
  AND public.company_has_active_module('72000000-0000-4000-8000-000000000005', 'controle_estoque')
  AND public.company_has_active_module('72000000-0000-4000-8000-000000000005', 'gestao_materiais'),
  'lifetime company receives the released module and dependencies canonically'
);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '__custody_category_a__'),
  ('74000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '__custody_category_b__'),
  ('74000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', '__custody_category_disabled__'),
  ('74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000004', '__custody_category_readonly__'),
  ('74000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000005', '__custody_category_lifetime__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome,
  tipo_controle, status_operacional, ativo
)
VALUES
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'CI-IND-A', 'Individual A', 'individual', 'disponivel', true),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'CI-QTY-A', 'Quantidade A', 'quantidade', 'disponivel', true),
  ('75000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'CI-INACTIVE-A', 'Inativo A', 'quantidade', 'disponivel', false),
  ('75000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 'CI-QTY-B', 'Quantidade B', 'quantidade', 'disponivel', true),
  ('75000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000003', '74000000-0000-4000-8000-000000000003', 'CI-DISABLED', 'Módulo desativado', 'quantidade', 'disponivel', true),
  ('75000000-0000-4000-8000-000000000006', '72000000-0000-4000-8000-000000000004', '74000000-0000-4000-8000-000000000004', 'CI-READONLY', 'Somente leitura', 'quantidade', 'disponivel', true),
  ('75000000-0000-4000-8000-000000000007', '72000000-0000-4000-8000-000000000005', '74000000-0000-4000-8000-000000000005', 'CI-LIFETIME', 'Vitalício', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'A-ORIG', 'Origem A', true),
  ('76000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'A-DEST', 'Destino A', true),
  ('76000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', 'A-INAT', 'Inativa A', false),
  ('76000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', 'B-ORIG', 'Origem B', true),
  ('76000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000003', 'D-ORIG', 'Origem desativada', true),
  ('76000000-0000-4000-8000-000000000006', '72000000-0000-4000-8000-000000000004', 'R-ORIG', 'Origem readonly', true),
  ('76000000-0000-4000-8000-000000000007', '72000000-0000-4000-8000-000000000005', 'L-ORIG', 'Origem vitalícia', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 1),
  ('72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 50),
  ('72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000003', '76000000-0000-4000-8000-000000000001', 5),
  ('72000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000004', '76000000-0000-4000-8000-000000000004', 10),
  ('72000000-0000-4000-8000-000000000003', '75000000-0000-4000-8000-000000000005', '76000000-0000-4000-8000-000000000005', 10),
  ('72000000-0000-4000-8000-000000000004', '75000000-0000-4000-8000-000000000006', '76000000-0000-4000-8000-000000000006', 10),
  ('72000000-0000-4000-8000-000000000005', '75000000-0000-4000-8000-000000000007', '76000000-0000-4000-8000-000000000007', 10);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES
  ('77000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Responsável A', 'Técnico'),
  ('77000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'Responsável B', 'Técnico'),
  ('77000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', 'Responsável Disabled', 'Técnico'),
  ('77000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000004', 'Responsável Readonly', 'Técnico'),
  ('77000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000005', 'Responsável Lifetime', 'Técnico');

-- Company A administrator: individual, quantity, partial/total return,
-- idempotency and logical concurrency barriers.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000001', 1,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000001', NULL, 'individual checkout',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'individual checkout succeeds once'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos WHERE material_id = '75000000-0000-4000-8000-000000000001'),
  0,
  'individual checkout atomically debits official stock'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000001', 1,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000002', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI012',
  'Este material individual já possui check-out ativo.',
  'second active individual checkout is rejected'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 20,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'evento', 'bom',
    '78000000-0000-4000-8000-000000000003', now() + interval '1 day', '20 units',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'quantity checkout succeeds partially'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos WHERE material_id = '75000000-0000-4000-8000-000000000002' AND localizacao_id = '76000000-0000-4000-8000-000000000001'),
  30,
  'quantity checkout leaves the correct official availability'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 31,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'evento', 'bom',
    '78000000-0000-4000-8000-000000000004', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'ST001',
  'Saldo insuficiente na localização de origem.',
  'checkout cannot exceed canonical stock'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 20,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'evento', 'bom',
    '78000000-0000-4000-8000-000000000003', now() + interval '1 day', '20 units',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'same checkout idempotency key and payload returns the original result'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
  1::bigint,
  'checkout retry creates no duplicate custody'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 19,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'evento', 'bom',
    '78000000-0000-4000-8000-000000000003', now() + interval '1 day', '20 units',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI013',
  'Esta operação já foi enviada com dados diferentes.',
  'idempotency key cannot be reused with another payload'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
    15, '76000000-0000-4000-8000-000000000002', 'bom',
    '78000000-0000-4000-8000-000000000005', 'partial return', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'partial checkin succeeds'
);
SELECT is(
  (SELECT status FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
  'parcial'::public.material_custody_status,
  'partial return keeps custody open'
);
SELECT is(
  (SELECT quantidade_devolvida FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
  15,
  'partial return updates only the returned projection'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
    15, '76000000-0000-4000-8000-000000000002', 'bom',
    '78000000-0000-4000-8000-000000000005', 'partial return', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'checkin retry is idempotent'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodia_eventos WHERE client_uuid = '78000000-0000-4000-8000-000000000005'),
  1::bigint,
  'checkin retry creates no duplicate event'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
    5, '76000000-0000-4000-8000-000000000002', 'com_avaria',
    '78000000-0000-4000-8000-000000000006', 'final return', 'case scratched', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'total checkin succeeds after a partial return'
);
SELECT is(
  (SELECT status FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
  'concluida'::public.material_custody_status,
  'full returned quantity closes custody'
);
SELECT is(
  (SELECT COALESCE(sum(quantidade), 0)::integer FROM public.estoque_saldos WHERE material_id = '75000000-0000-4000-8000-000000000002'),
  50,
  'partial plus total checkin restores canonical stock'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000003'),
    1, '76000000-0000-4000-8000-000000000002', 'bom',
    '78000000-0000-4000-8000-000000000007', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI014',
  'Esta operação não possui quantidade pendente para retorno.',
  'a completed custody rejects duplicate return with a new key'
);

-- P1-7: loss/damage closes physical custody without a fake check-in or stock entry.
SELECT lives_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000001'),
    1, 'extraviado', 'item perdido durante o transporte',
    '78300000-0000-4000-8000-000000000001', 'boletim registrado', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'total loss closes an individual custody'
);
SELECT is(
  (SELECT (status, quantidade_devolvida, quantidade_baixada)::text
   FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000001'),
  '(concluida,0,1)',
  'loss is accounted separately from physical return'
);
SELECT is(
  (SELECT status_operacional FROM public.materiais WHERE id = '75000000-0000-4000-8000-000000000001'),
  'extraviado'::public.material_operational_status,
  'individual lost material receives the existing extraviado status'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.material_custodia_eventos
    WHERE client_uuid = '78300000-0000-4000-8000-000000000001'
      AND tipo = 'correcao' AND quantidade = 1 AND movimento_estoque_id IS NULL
      AND executado_por = auth.uid() AND justificativa = 'item perdido durante o transporte'
      AND status_operacional_resultante = 'extraviado'),
  'correction event records actor, reason, classification and no stock movement'
);
SELECT lives_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000001'),
    1, 'extraviado', 'item perdido durante o transporte',
    '78300000-0000-4000-8000-000000000001', 'boletim registrado', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'retry with the same key is idempotent'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodia_eventos WHERE client_uuid = '78300000-0000-4000-8000-000000000001'),
  1::bigint,
  'idempotent retry does not apply a second write-off'
);

SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 10,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78300000-0000-4000-8000-000000000002', now() - interval '1 day', 'custody to reconcile',
    NULL, NULL, NULL, now() - interval '2 days', '72000000-0000-4000-8000-000000000001'
  )$test$,
  'quantity custody is prepared for partial return and write-off'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
    4, '76000000-0000-4000-8000-000000000002', 'bom',
    '78300000-0000-4000-8000-000000000003', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'physical partial return remains a normal check-in'
);
SELECT lives_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
    3, 'avariado', 'tres unidades sem condicao de retorno',
    '78300000-0000-4000-8000-000000000004', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'damage writes off only the informed quantity'
);
SELECT is(
  (SELECT (status, quantidade_devolvida, quantidade_baixada)::text FROM public.material_custodias
   WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
  '(parcial,4,3)',
  'partial return and partial damage leave only the real remainder open'
);
SELECT throws_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
    4, 'extraviado', 'quantidade acima da pendente',
    '78300000-0000-4000-8000-000000000005', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI021', 'A quantidade baixada supera a quantidade ainda em custodia.',
  'write-off above the remaining quantity is blocked'
);
SELECT lives_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
    3, 'extraviado', 'saldo restante perdido',
    '78300000-0000-4000-8000-000000000006', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'remaining quantity can be closed after a partial return'
);
SELECT is(
  (SELECT (status, quantidade_devolvida, quantidade_baixada)::text FROM public.material_custodias
   WHERE client_uuid = '78300000-0000-4000-8000-000000000002'),
  '(concluida,4,6)',
  'return plus write-off closes the custody without masking the split'
);
SELECT is(
  (SELECT COALESCE(sum(quantidade), 0)::integer FROM public.estoque_saldos WHERE material_id = '75000000-0000-4000-8000-000000000002'),
  44,
  'six written-off units never return to stock'
);
SELECT is(
  ((public.obter_indicadores_custodia('72000000-0000-4000-8000-000000000001')->>'itens_fora')::integer),
  0,
  'closed lost and damaged quantities leave the outside indicator'
);
SELECT is(
  ((public.obter_indicadores_custodia('72000000-0000-4000-8000-000000000001')->>'atrasados')::integer),
  0,
  'closed loss no longer remains overdue'
);

SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000003', 1,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000008', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI008',
  'Material inativo não pode sair em custódia.',
  'inactive material is rejected'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 1,
    '76000000-0000-4000-8000-000000000003', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000009', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI006',
  'Localização inativa não pode originar um novo check-out.',
  'inactive origin is rejected'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000004', 1,
    '76000000-0000-4000-8000-000000000004', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000010', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI005',
  'Material não encontrado.',
  'material from another company is rejected'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 1,
    '76000000-0000-4000-8000-000000000004', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000011', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI005',
  'Localização de origem inválida.',
  'location from another company is rejected'
);

-- Explicit cancellation creates a stock reversal and preserves history.
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 5,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'outro', 'bom',
    '78000000-0000-4000-8000-000000000012', NULL, 'wrong material',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'checkout prepared for explicit cancellation'
);
SELECT lives_ok(
  $test$SELECT public.cancelar_checkout_material(
    (SELECT id FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000012'),
    'material selecionado por engano',
    '78000000-0000-4000-8000-000000000013', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'checkout cancellation succeeds through reversal'
);
SELECT is(
  (SELECT status FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000012'),
  'cancelada'::public.material_custody_status,
  'cancelled checkout remains recorded'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.estoque_movimentacoes AS reversal
    JOIN public.material_custodias AS custody
      ON custody.movimento_saida_id = reversal.movimentacao_estornada_id
    WHERE custody.client_uuid = '78000000-0000-4000-8000-000000000012'
      AND reversal.tipo_movimentacao = 'estorno'
      AND reversal.origem_modulo = 'checkin_checkout'
  ),
  'cancellation is linked to an immutable stock reversal'
);
SELECT throws_ok(
  $$UPDATE public.material_custodia_eventos SET observacao = 'rewrite' WHERE client_uuid = '78000000-0000-4000-8000-000000000013'$$,
  '42501',
  'permission denied for table material_custodia_eventos',
  'authenticated client cannot rewrite the custody event ledger'
);
SELECT throws_ok(
  $$DELETE FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000012'$$,
  '42501',
  'permission denied for table material_custodias',
  'authenticated client cannot delete a custody operation'
);
SELECT throws_ok(
  $$INSERT INTO public.material_custodia_eventos DEFAULT VALUES$$,
  '42501',
  'permission denied for table material_custodia_eventos',
  'authenticated client cannot forge a custody event'
);

RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.material_custodia_eventos SET observacao = 'rewrite' WHERE client_uuid = '78000000-0000-4000-8000-000000000013'$$,
  'CI019',
  'O histórico de custódia é imutável.',
  'custody event trigger blocks privileged rewrites'
);
SELECT throws_ok(
  $$DELETE FROM public.material_custodias WHERE client_uuid = '78000000-0000-4000-8000-000000000012'$$,
  'CI019',
  'Operações de custódia não podem ser excluídas.',
  'custody trigger blocks privileged deletion'
);

-- Company B creates one operation, then A must not see it through RLS.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000004', 1,
    '76000000-0000-4000-8000-000000000004', 'funcionario',
    '77000000-0000-4000-8000-000000000002', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000014', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000002'
  )$test$,
  'second company creates its own custody'
);
RESET ROLE;

CREATE TEMP TABLE p17_cross_tenant_target ON COMMIT DROP AS
SELECT id FROM public.material_custodias
WHERE client_uuid = '78000000-0000-4000-8000-000000000014';
GRANT SELECT ON p17_cross_tenant_target TO authenticated;

SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    (SELECT id FROM p17_cross_tenant_target),
    1, 'extraviado', 'tentativa entre empresas',
    '78300000-0000-4000-8000-000000000007', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI005', 'Operacao de custodia nao encontrada.',
  'company A cannot write off company B custody'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodias WHERE empresa_id = '72000000-0000-4000-8000-000000000002'),
  0::bigint,
  'RLS hides another company custody operation'
);
RESET ROLE;

-- Current ordinary-user role reads but cannot write.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.material_custodias) > 0,
  'ordinary company user can read custody history'
);
SELECT throws_ok(
  $test$SELECT public.registrar_baixa_custodia_material(
    '00000000-0000-4000-8000-000000000001', 1, 'extraviado', 'sem permissao',
    '78300000-0000-4000-8000-000000000008', NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  '42501', 'Você não tem permissão para esta operação.',
  'ordinary user cannot write off custody'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000002', 1,
    '76000000-0000-4000-8000-000000000001', 'usuario',
    '73000000-0000-4000-8000-000000000002', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000015', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  '42501',
  'Você não tem permissão para esta operação.',
  'ordinary user has no custody write under current canonical roles'
);
RESET ROLE;

-- Disabled entitlement fails before data access.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000005', 1,
    '76000000-0000-4000-8000-000000000005', 'funcionario',
    '77000000-0000-4000-8000-000000000003', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000016', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000003'
  )$test$,
  'CI009',
  'O módulo Check-in e Check-out não está ativo para esta empresa.',
  'disabled checkin module blocks writes'
);
RESET ROLE;

-- Paid but non-operational company is read-only.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000006', 1,
    '76000000-0000-4000-8000-000000000006', 'funcionario',
    '77000000-0000-4000-8000-000000000004', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000017', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000004'
  )$test$,
  'CI010',
  'A empresa está em modo somente leitura.',
  'read-only company cannot create custody'
);
RESET ROLE;

-- Lifetime license uses the same released catalog and RPCs, no parallel logic.
SELECT set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000007', 1,
    '76000000-0000-4000-8000-000000000007', 'funcionario',
    '77000000-0000-4000-8000-000000000005', 'uso_interno', 'bom',
    '78000000-0000-4000-8000-000000000018', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000005'
  )$test$,
  'lifetime company can use the released custody module'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT * FROM finish();

\if :{?persist_fixtures}
COMMIT;
\else
ROLLBACK;
\endif
