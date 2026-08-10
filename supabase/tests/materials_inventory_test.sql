BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(23);

SELECT ok(
  position(
    'v_attempt integer'
    IN lower(
      pg_get_functiondef(
        'public.generate_material_barcode(uuid)'::regprocedure
      )
    )
  ) = 0
  AND pg_get_functiondef(
    'public.generate_material_barcode(uuid)'::regprocedure
  ) ~* 'FOR[[:space:]]+v_attempt[[:space:]]+IN[[:space:]]+1\.\.5[[:space:]]+LOOP',
  'barcode generation keeps five attempts without a shadowed loop variable'
);

INSERT INTO public.empresas (id, nome_empresa)
VALUES
  (
    '31000000-0000-4000-8000-000000000001',
    '__materials_company_a__'
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '__materials_company_b__'
  );

INSERT INTO public.categorias_materiais (
  id,
  empresa_id,
  nome,
  descricao
)
VALUES
  (
    '32000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'Áudio',
    'Equipamentos de áudio'
  ),
  (
    '32000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000002',
    'Áudio',
    NULL
  );

SELECT is(
  (
    SELECT nome
    FROM public.categorias_materiais
    WHERE id = '32000000-0000-4000-8000-000000000001'
  ),
  'Áudio',
  'a material category can be created'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.categorias_materiais (empresa_id, nome)
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      ' áudio '
    )
  $test$,
  '23505',
  NULL,
  'duplicate category names are blocked within a company'
);

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
  '33000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'MIX-001',
  'Mesa digital',
  'individual',
  1
);

SELECT ok(
  (
    SELECT identificador_unico IS NOT NULL
    FROM public.materiais
    WHERE id = '33000000-0000-4000-8000-000000000001'
  ),
  'an individual item receives an immutable technical identifier'
);

INSERT INTO public.materiais (
  id,
  empresa_id,
  categoria_id,
  codigo_interno,
  nome,
  tipo_controle,
  quantidade,
  unidade_medida
)
VALUES (
  '33000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'CAB-001',
  'Cabo XLR',
  'quantidade',
  20,
  'unidade'
);

SELECT is(
  (
    SELECT quantidade
    FROM public.materiais
    WHERE id = '33000000-0000-4000-8000-000000000002'
  ),
  0,
  'new material stock starts at zero until an explicit movement'
);

SELECT lives_ok(
  $test$
    INSERT INTO public.materiais (
      empresa_id, categoria_id, codigo_interno, nome,
      tipo_controle, quantidade
    )
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001',
      'IND-INVALID', 'Individual inválido', 'individual', 2
    )
  $test$,
  'direct insert quantity is ignored in favor of the protected zero projection'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais (
      empresa_id, categoria_id, codigo_interno, nome,
      tipo_controle, quantidade
    )
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001',
      ' mix-001 ', 'Código duplicado', 'quantidade', 1
    )
  $test$,
  '23505',
  NULL,
  'internal material codes are unique per company'
);

SELECT lives_ok(
  $test$
    INSERT INTO public.materiais (
      empresa_id, categoria_id, codigo_interno, nome,
      tipo_controle, quantidade
    )
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001',
      'NEG-QTY', 'Quantidade negativa', 'quantidade', -1
    )
  $test$,
  'legacy negative quantity input is ignored and cannot create a balance'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais (
      empresa_id, categoria_id, codigo_interno, nome,
      tipo_controle, quantidade, valor_reposicao
    )
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001',
      'NEG-VAL', 'Valor negativo', 'quantidade', 1, -0.01
    )
  $test$,
  '23514',
  NULL,
  'negative material values are rejected'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.materiais (
      empresa_id, categoria_id, codigo_interno, nome,
      tipo_controle, quantidade
    )
    VALUES (
      '31000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000002',
      'CROSS-TENANT', 'Categoria externa', 'quantidade', 1
    )
  $test$,
  'P0001',
  'Categoria deve pertencer à mesma empresa do material',
  'a material cannot reference another tenant category'
);

SELECT is(
  (
    SELECT count(*)
    FROM unnest(enum_range(NULL::public.material_operational_status))
      AS status(value)
    WHERE value::text IN ('locado', 'reservado')
  ),
  0::bigint,
  'future rental and reservation states are not mixed into stage-one operational status'
);

SELECT throws_ok(
  $test$
    UPDATE public.materiais
    SET status_operacional = 'avariado',
        justificativa_status = NULL
    WHERE id = '33000000-0000-4000-8000-000000000001'
  $test$,
  'P0001',
  'Justificativa é obrigatória para a alteração de status',
  'a manual operational status requires justification'
);

SELECT lives_ok(
  $test$
    UPDATE public.materiais
    SET status_operacional = 'avariado',
        justificativa_status = 'Display danificado'
    WHERE id = '33000000-0000-4000-8000-000000000001'
  $test$,
  'a justified manual status change is accepted'
);

SELECT lives_ok(
  $test$
    UPDATE public.materiais
    SET ativo = false
    WHERE id = '33000000-0000-4000-8000-000000000002';
    UPDATE public.materiais
    SET ativo = true
    WHERE id = '33000000-0000-4000-8000-000000000002'
  $test$,
  'a material can be inactivated and reactivated without deletion'
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
    '34000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001/33000000-0000-4000-8000-000000000001/one.jpg',
    'one.jpg',
    'image/jpeg',
    1024
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001/33000000-0000-4000-8000-000000000001/two.webp',
    'two.webp',
    'image/webp',
    2048
  );

SELECT is(
  (
    SELECT count(*)
    FROM public.materiais_fotos
    WHERE material_id = '33000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'multiple material photo metadata rows can be created'
);

UPDATE public.materiais_fotos
SET foto_principal = true
WHERE id = '34000000-0000-4000-8000-000000000002';

SELECT is(
  (
    SELECT id
    FROM public.materiais_fotos
    WHERE material_id = '33000000-0000-4000-8000-000000000001'
      AND foto_principal
  ),
  '34000000-0000-4000-8000-000000000002'::uuid,
  'exactly one photo can be selected as principal'
);

DELETE FROM public.materiais_fotos
WHERE id = '34000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT count(*)
    FROM public.materiais_fotos
    WHERE material_id = '33000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'material photo metadata can be removed'
);

SELECT throws_ok(
  $test$
    DELETE FROM public.categorias_materiais
    WHERE id = '32000000-0000-4000-8000-000000000001'
  $test$,
  'P0001',
  'Categoria em uso não pode ser excluída; inative-a',
  'a category in use cannot be physically deleted'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'categorias_materiais',
        'materiais',
        'materiais_fotos'
      )
      AND relation.relrowsecurity
  ),
  3::bigint,
  'RLS is enabled on all material tables'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'categorias_materiais',
        'materiais',
        'materiais_fotos'
      )
      AND (
        'anon' = ANY (roles)
        OR 'public' = ANY (roles)
      )
  ),
  0::bigint,
  'material policies never grant access to anon or public'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'materiais'
      AND cmd = 'SELECT'
      AND qual ILIKE '%can_read_company_module%empresa_id%'
      AND qual ILIKE '%gestao_materiais%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'materiais'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_module%empresa_id%'
      AND with_check ILIKE '%gestao_materiais%'
  ),
  'material reads and writes require the canonical company module'
);

SELECT ok(
  public.is_valid_material_photo_path(
    '31000000-0000-4000-8000-000000000001/33000000-0000-4000-8000-000000000001/photo.webp'
  ),
  'material Storage paths are tenant and material scoped'
);

SELECT is(
  (
    SELECT public
    FROM storage.buckets
    WHERE id = 'material-photos'
  ),
  false,
  'the material photo bucket is private'
);

SELECT * FROM finish();

ROLLBACK;
