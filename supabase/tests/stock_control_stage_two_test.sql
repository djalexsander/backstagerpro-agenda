BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(102);

-- 1..3 canonical tables
SELECT has_table('public', 'estoque_localizacoes', 'canonical locations table exists');
SELECT has_table('public', 'estoque_saldos', 'canonical balances table exists');
SELECT has_table('public', 'estoque_movimentacoes', 'canonical ledger table exists');

-- 4..11 location contract
SELECT has_column('public', 'estoque_localizacoes', 'id', 'location has id');
SELECT has_column('public', 'estoque_localizacoes', 'empresa_id', 'location has company');
SELECT has_column('public', 'estoque_localizacoes', 'localizacao_pai_id', 'location has parent');
SELECT has_column('public', 'estoque_localizacoes', 'codigo', 'location has code');
SELECT has_column('public', 'estoque_localizacoes', 'nome', 'location has name');
SELECT has_column('public', 'estoque_localizacoes', 'tipo', 'location has type');
SELECT has_column('public', 'estoque_localizacoes', 'ativa', 'location has active flag');
SELECT has_column('public', 'estoque_localizacoes', 'updated_at', 'location is timestamped');

-- 12..17 balance contract
SELECT has_column('public', 'estoque_saldos', 'id', 'balance has id');
SELECT has_column('public', 'estoque_saldos', 'empresa_id', 'balance has company');
SELECT has_column('public', 'estoque_saldos', 'material_id', 'balance has material');
SELECT has_column('public', 'estoque_saldos', 'localizacao_id', 'balance has location');
SELECT has_column('public', 'estoque_saldos', 'quantidade', 'balance has quantity');
SELECT has_column('public', 'estoque_saldos', 'updated_at', 'balance is timestamped');

-- 18..37 immutable ledger contract
SELECT has_column('public', 'estoque_movimentacoes', 'id', 'movement has id');
SELECT has_column('public', 'estoque_movimentacoes', 'empresa_id', 'movement has company');
SELECT has_column('public', 'estoque_movimentacoes', 'material_id', 'movement has material');
SELECT has_column('public', 'estoque_movimentacoes', 'tipo_movimentacao', 'movement has type');
SELECT has_column('public', 'estoque_movimentacoes', 'quantidade', 'movement has quantity');
SELECT has_column('public', 'estoque_movimentacoes', 'localizacao_origem_id', 'movement has origin');
SELECT has_column('public', 'estoque_movimentacoes', 'localizacao_destino_id', 'movement has destination');
SELECT has_column('public', 'estoque_movimentacoes', 'saldo_total_anterior', 'movement snapshots old total');
SELECT has_column('public', 'estoque_movimentacoes', 'saldo_total_posterior', 'movement snapshots new total');
SELECT has_column('public', 'estoque_movimentacoes', 'motivo', 'movement has reason');
SELECT has_column('public', 'estoque_movimentacoes', 'justificativa', 'movement has justification');
SELECT has_column('public', 'estoque_movimentacoes', 'observacao', 'movement has note');
SELECT has_column('public', 'estoque_movimentacoes', 'documento_referencia', 'movement has reference');
SELECT has_column('public', 'estoque_movimentacoes', 'data_efetiva', 'movement has effective date');
SELECT has_column('public', 'estoque_movimentacoes', 'origem_modulo', 'movement has source module');
SELECT has_column('public', 'estoque_movimentacoes', 'origem_id', 'movement has source id');
SELECT has_column('public', 'estoque_movimentacoes', 'client_uuid', 'movement has idempotency key');
SELECT has_column('public', 'estoque_movimentacoes', 'payload_hash', 'movement has payload hash');
SELECT has_column('public', 'estoque_movimentacoes', 'movimentacao_estornada_id', 'movement links reversal');
SELECT has_column('public', 'estoque_movimentacoes', 'created_by', 'movement has actor');

-- 38..40 enums
SELECT has_type('public', 'estoque_localizacao_tipo', 'location enum exists');
SELECT has_type('public', 'estoque_movimentacao_tipo', 'movement enum exists');
SELECT has_type('public', 'estoque_origem_modulo', 'source module enum exists');

-- 41..43 public mutation boundary
SELECT has_function(
  'public', 'registrar_movimentacao_estoque',
  ARRAY['uuid','text','integer','uuid','uuid','uuid','text','text','text','timestamp with time zone','text','uuid','uuid'],
  'register movement RPC exists'
);
SELECT has_function(
  'public', 'ajustar_estoque_material',
  ARRAY['uuid','uuid','integer','text','text','uuid','text','timestamp with time zone','uuid'],
  'physical adjustment RPC exists'
);
SELECT has_function(
  'public', 'estornar_movimentacao_estoque',
  ARRAY['uuid','text','uuid','timestamp with time zone','uuid'],
  'reversal RPC exists'
);

-- 44..50 performance and uniqueness
SELECT has_index('public', 'estoque_localizacoes', 'estoque_localizacoes_empresa_codigo_uidx', 'location code index exists');
SELECT has_index('public', 'estoque_localizacoes', 'estoque_localizacoes_empresa_nome_uidx', 'location name index exists');
SELECT has_index('public', 'estoque_saldos', 'estoque_saldos_empresa_material_localizacao_unique', 'balance triple is unique');
SELECT has_index('public', 'estoque_movimentacoes', 'estoque_movimentacoes_empresa_client_unique', 'client key is unique');
SELECT has_index('public', 'estoque_movimentacoes', 'estoque_movimentacoes_original_estorno_uidx', 'only one reversal is allowed');
SELECT has_index('public', 'estoque_movimentacoes', 'estoque_movimentacoes_company_date_idx', 'company history index exists');
SELECT has_index('public', 'estoque_movimentacoes', 'estoque_movimentacoes_material_date_idx', 'material history index exists');

-- 51..53 RLS
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.estoque_localizacoes'::regclass), 'locations have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.estoque_saldos'::regclass), 'balances have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.estoque_movimentacoes'::regclass), 'ledger has RLS');

-- 54..55 observability views
SELECT has_view('public', 'estoque_divergencias_saldo', 'divergence view exists');
SELECT has_view('public', 'estoque_reconciliacao_legado', 'legacy reconciliation view exists');

-- 56..62 module, dependency and write isolation
SELECT ok((SELECT ativo FROM public.module_catalog WHERE feature_key = 'controle_estoque'), 'stock module is released');
SELECT ok(
  NOT (SELECT metadata ? 'planned' FROM public.module_catalog WHERE feature_key = 'controle_estoque'),
  'stock module is no longer marked planned'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.module_dependencies dependency
    JOIN public.module_catalog child ON child.id = dependency.module_id
    JOIN public.module_catalog parent ON parent.id = dependency.required_module_id
    WHERE child.feature_key = 'controle_estoque'
      AND parent.feature_key = 'gestao_materiais'
  ),
  'stock keeps the materials dependency'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'estoque_localizacoes',
        'estoque_saldos',
        'estoque_movimentacoes'
      )
      AND (
        COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
      ) ILIKE '%gestao_materiais%'
  ),
  6::bigint,
  'every stock policy also enforces the materials dependency'
);
SELECT ok(
  col_description('public.materiais'::regclass, (
    SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.materiais'::regclass AND attname = 'quantidade'
  )) ILIKE '%projection%',
  'legacy quantity is documented as projection'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'estoque_localizacoes'
      AND indexname = 'estoque_localizacoes_empresa_nome_uidx'
  ),
  'location names are unambiguously unique per company'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_saldos', 'INSERT'),
  'authenticated clients cannot insert balances'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_movimentacoes', 'INSERT'),
  'authenticated clients cannot insert ledger rows'
);

-- 64..83 least privilege, safe definer context and hardened relationships
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.estoque_divergencias_saldo',
    'SELECT'
  ),
  'authenticated clients cannot read the administrative divergence view'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.estoque_reconciliacao_legado',
    'SELECT'
  ),
  'authenticated clients cannot read the administrative legacy view'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_saldos', 'UPDATE'),
  'authenticated clients cannot update balances'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_saldos', 'DELETE'),
  'authenticated clients cannot delete balances'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_movimentacoes', 'UPDATE'),
  'authenticated clients cannot update ledger rows'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.estoque_movimentacoes', 'DELETE'),
  'authenticated clients cannot delete ledger rows'
);
SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.materiais',
    'quantidade',
    'UPDATE'
  ),
  'ordinary material CRUD cannot update the stock projection'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.materiais', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.materiais', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.materiais', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.materiais', 'TRIGGER'),
  'material CRUD has no destructive or structural table privileges'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.estoque_localizacoes',
    'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.estoque_localizacoes',
    'REFERENCES'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.estoque_localizacoes',
    'TRIGGER'
  ),
  'location management does not retain excessive table privileges'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = ANY (ARRAY[
        'resolve_stock_company',
        'apply_stock_movement',
        'prepare_stock_location_write',
        'protect_used_stock_location',
        'protect_material_stock_projection',
        'sync_material_stock_projection',
        'validate_stock_balance',
        'protect_stock_ledger'
      ])
      AND has_function_privilege('authenticated', function.oid, 'EXECUTE')
  ),
  0::bigint,
  'authenticated clients cannot execute private stock functions directly'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = ANY (ARRAY[
        'resolve_stock_company',
        'apply_stock_movement',
        'prepare_stock_location_write',
        'protect_used_stock_location',
        'protect_material_stock_projection',
        'sync_material_stock_projection',
        'validate_stock_balance',
        'protect_stock_ledger',
        'registrar_movimentacao_estoque',
        'ajustar_estoque_material',
        'estornar_movimentacao_estoque',
        'listar_estoque_resumo'
      ])
      AND has_function_privilege('service_role', function.oid, 'EXECUTE')
  ),
  0::bigint,
  'service role has no direct execution path through stock functions'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = ANY (ARRAY[
        'registrar_movimentacao_estoque',
        'ajustar_estoque_material',
        'estornar_movimentacao_estoque',
        'listar_estoque_resumo'
      ])
      AND has_function_privilege('authenticated', function.oid, 'EXECUTE')
  ),
  4::bigint,
  'only the four required public stock RPCs are executable by authenticated clients'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = ANY (ARRAY[
        'resolve_stock_company',
        'prepare_stock_location_write',
        'protect_used_stock_location',
        'protect_material_stock_projection',
        'validate_stock_balance',
        'sync_material_stock_projection',
        'protect_stock_ledger',
        'apply_stock_movement',
        'registrar_movimentacao_estoque',
        'ajustar_estoque_material',
        'estornar_movimentacao_estoque',
        'listar_estoque_resumo'
      ])
      AND function.prosecdef
      AND function.proconfig @> ARRAY['search_path=pg_catalog, public']
  ),
  12::bigint,
  'every stock SECURITY DEFINER function has the canonical safe search path'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.estoque_movimentacoes'::regclass
      AND conname = 'estoque_movimentacoes_estornada_fkey'
      AND array_length(conkey, 1) = 3
  ),
  'reversal references are constrained by company, material and movement'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.estoque_movimentacoes'::regclass
      AND conname = 'estoque_movimentacoes_reversal_reference_shape'
  ),
  'only reversal rows can reference a reversed movement'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'registrar_movimentacao_estoque',
        'ajustar_estoque_material',
        'estornar_movimentacao_estoque'
      )
      AND function.prosrc ILIKE '%sha256(convert_to(%'
      AND function.prosrc NOT ILIKE '%digest(%'
  ),
  3::bigint,
  'idempotency hashes use built-in SHA-256 without an undeclared extension'
);
SELECT ok(
  (
    SELECT function.prosrc
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'resolve_stock_company'
  ) ILIKE '%get_user_empresa_id(auth.uid())%'
  AND (
    SELECT function.prosrc
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'resolve_stock_company'
  ) ILIKE '%_requested_company_id <> v_company_id%',
  'ordinary users derive the company canonically and cannot override it'
);
SELECT ok(
  (
    SELECT function.prosrc
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'apply_stock_movement'
  ) ILIKE '%FROM public.estoque_localizacoes%ORDER BY id%FOR UPDATE%'
  AND (
    SELECT function.prosrc
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname = 'apply_stock_movement'
  ) ILIKE '%FROM public.estoque_saldos%ORDER BY localizacao_id%FOR UPDATE%',
  'movement core locks locations and balances in deterministic order'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_trigger AS trigger
    JOIN pg_proc AS function ON function.oid = trigger.tgfoid
    WHERE trigger.tgrelid IN (
      'public.materiais'::regclass,
      'public.estoque_saldos'::regclass
    )
      AND NOT trigger.tgisinternal
      AND (
        trigger.tgname ILIKE '%saldo_inicial%'
        OR function.prosrc ILIKE '%tipo_movimentacao = ''saldo_inicial''%'
      )
  ),
  0::bigint,
  'no trigger creates an automatic initial balance'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function
    JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'public'
      AND function.proname IN (
        'registrar_movimentacao_estoque',
        'ajustar_estoque_material',
        'estornar_movimentacao_estoque',
        'listar_estoque_resumo'
      )
      AND function.prosrc ILIKE '%resolve_stock_company(%'
  ),
  4::bigint,
  'every public stock RPC resolves company and permissions through the private guard'
);

-- 84..91 stable enum and trigger contracts
SELECT results_eq(
  $$SELECT unnest(enum_range(NULL::public.estoque_movimentacao_tipo))::text$$,
  $$VALUES ('entrada'),('saida'),('transferencia'),('ajuste_positivo'),('ajuste_negativo'),('saldo_inicial'),('estorno')$$,
  'movement types are canonical'
);
SELECT results_eq(
  $$SELECT unnest(enum_range(NULL::public.estoque_localizacao_tipo))::text$$,
  $$VALUES ('deposito'),('almoxarifado'),('sala'),('veiculo'),('estrutura'),('area_tecnica'),('outra')$$,
  'location types are canonical'
);
SELECT ok(
  ARRAY['manual','controle_estoque','checkin_checkout','locacao_materiais','manutencao_equipamentos']
    <@ ARRAY(SELECT unnest(enum_range(NULL::public.estoque_origem_modulo))::text),
  'source enum reserves structurally compatible future origins'
);
SELECT col_type_is('public', 'estoque_saldos', 'quantidade', 'integer', 'balances use integer units');
SELECT col_type_is('public', 'materiais', 'estoque_minimo', 'integer', 'minimum stock uses integer units');
SELECT has_trigger('public', 'estoque_movimentacoes', 'protect_stock_ledger', 'ledger has append-only trigger');
SELECT has_trigger('public', 'estoque_saldos', 'sync_material_stock_projection', 'balance changes sync projection');
SELECT has_trigger('public', 'estoque_saldos', 'validate_stock_balance', 'individual invariants have a second barrier');

-- Fixtures for 92..102. Owner setup deliberately bypasses RLS but not triggers.
INSERT INTO public.empresas (id, nome_empresa)
VALUES ('61000000-0000-4000-8000-000000000001', '__stock_stage_two_company__');

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES (
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '__stock_stage_two_category__'
);

SELECT lives_ok(
  $test$
    INSERT INTO public.materiais (
      id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
    ) VALUES
      ('63000000-0000-4000-8000-000000000001',
       '61000000-0000-4000-8000-000000000001',
       '62000000-0000-4000-8000-000000000001',
       'STOCK-QTY', 'Quantidade', 'quantidade', 99),
      ('63000000-0000-4000-8000-000000000002',
       '61000000-0000-4000-8000-000000000001',
       '62000000-0000-4000-8000-000000000001',
       'STOCK-IND', 'Individual', 'individual', 99)
  $test$,
  'materials ignore direct initial quantity input'
);

SELECT is(
  (SELECT quantidade FROM public.materiais WHERE id = '63000000-0000-4000-8000-000000000001'),
  0,
  'new material projection starts at zero'
);
SELECT is(
  (SELECT quantidade_legada_etapa1 FROM public.materiais WHERE id = '63000000-0000-4000-8000-000000000001'),
  NULL::integer,
  'new materials do not receive a fake legacy quantity'
);
SELECT throws_ok(
  $$UPDATE public.materiais SET quantidade = 7 WHERE id = '63000000-0000-4000-8000-000000000001'$$,
  'ST018',
  'O saldo só pode ser alterado por uma movimentação de estoque.',
  'direct projection updates are blocked'
);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES
  ('64000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'DEP-A', 'Depósito A'),
  ('64000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', 'DEP-B', 'Depósito B');

SELECT throws_ok(
  $$UPDATE public.estoque_localizacoes
    SET localizacao_pai_id = '64000000-0000-4000-8000-000000000002'
    WHERE id = '64000000-0000-4000-8000-000000000001';
    UPDATE public.estoque_localizacoes
    SET localizacao_pai_id = '64000000-0000-4000-8000-000000000001'
    WHERE id = '64000000-0000-4000-8000-000000000002'$$,
  'ST016',
  'A hierarquia de localizações não pode conter ciclos.',
  'location cycles are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.estoque_localizacoes (empresa_id, codigo, nome)
    VALUES ('61000000-0000-4000-8000-000000000001', ' dep-a ', 'Outro depósito')$$,
  '23505',
  NULL,
  'location codes are unique after normalization'
);
SELECT lives_ok(
  $$INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
    VALUES (
      '61000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '64000000-0000-4000-8000-000000000001',
      3
    )$$,
  'a valid official balance can be persisted internally'
);
SELECT is(
  (SELECT quantidade FROM public.materiais WHERE id = '63000000-0000-4000-8000-000000000001'),
  3,
  'material projection equals the official balance sum'
);
SELECT throws_ok(
  $$UPDATE public.estoque_saldos
    SET localizacao_id = '64000000-0000-4000-8000-000000000002'
    WHERE material_id = '63000000-0000-4000-8000-000000000001'$$,
  'ST018',
  'A identidade de um saldo de estoque é imutável.',
  'balance identity cannot be reassigned after creation'
);
SELECT throws_ok(
  $$UPDATE public.estoque_saldos SET quantidade = -1
    WHERE material_id = '63000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'negative balances are blocked by a check constraint'
);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES (
  '61000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000001',
  1
);
SELECT throws_ok(
  $$INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
    VALUES (
      '61000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      '64000000-0000-4000-8000-000000000002',
      1
    )$$,
  'ST002',
  'Um material individual só pode ter saldo total zero ou um.',
  'individual stock cannot exist in two locations'
);

SELECT * FROM finish();
ROLLBACK;
