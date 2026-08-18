BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(29);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN (
      'gestao_materiais',
      'controle_estoque',
      'checkin_checkout',
      'locacao_materiais',
      'manutencao_equipamentos',
      'etiquetas_materiais',
      'relatorios_materiais'
    )
  ),
  7::bigint,
  'the materials family uses seven stable catalog feature keys'
);

SELECT ok(
  (
    SELECT ativo
    FROM public.module_catalog
    WHERE feature_key = 'gestao_materiais'
  ),
  'the stage-one base module is globally available'
);

-- Five modules planned in Stage 1 have shipped dedicated functionality.
-- relatorios_materiais deliberately remains a stable historical key but is
-- no longer commercially active until it has a dedicated implementation.
SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN (
      'controle_estoque',
      'checkin_checkout',
      'locacao_materiais',
      'manutencao_equipamentos',
      'etiquetas_materiais'
    )
      AND ativo = true
  ),
  5::bigint,
  'every implemented material module planned in Stage 1 is released'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_dependencies AS dependency
    JOIN public.module_catalog AS child
      ON child.id = dependency.module_id
    JOIN public.module_catalog AS base
      ON base.id = dependency.required_module_id
    WHERE base.feature_key = 'gestao_materiais'
      AND child.feature_key <> 'gestao_materiais'
  ),
  6::bigint,
  'every planned material module depends on the base module'
);

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
  '41000000-0000-4000-8000-000000000001',
  '__materials_module_paid_plan__',
  100,
  10,
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
    '42000000-0000-4000-8000-000000000001',
    '__materials_module_company_a__',
    'ativo',
    '41000000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    now() + interval '30 days'
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '__materials_module_company_b__',
    'ativo',
    '41000000-0000-4000-8000-000000000001',
    false,
    false,
    'pago',
    now() + interval '30 days'
  ),
  (
    '42000000-0000-4000-8000-000000000003',
    '__materials_module_lifetime__',
    'ativo',
    (
      SELECT id
      FROM public.planos
      WHERE periodicidade = 'vitalicio'
      ORDER BY id
      LIMIT 1
    ),
    false,
    false,
    'isento',
    NULL
  );

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'an ordinary company has no material access by default'
);

INSERT INTO public.empresa_modules (
  id,
  empresa_id,
  module_id,
  status,
  activated_at,
  granted_by_admin,
  origem
)
SELECT
  '43000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  id,
  'active',
  now(),
  true,
  'manual_admin'
FROM public.module_catalog
WHERE feature_key = 'gestao_materiais';

SELECT ok(
  public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'an active company entitlement enables the material module'
);

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000002',
    'gestao_materiais'
  ),
  'a module entitlement never leaks to another company'
);

INSERT INTO public.categorias_materiais (
  id,
  empresa_id,
  nome
)
VALUES (
  '44000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '__preserved_when_module_disabled__'
);

UPDATE public.empresa_modules
SET status = 'inactive'
WHERE id = '43000000-0000-4000-8000-000000000001';

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'inactivating the entitlement removes access'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.categorias_materiais
    WHERE id = '44000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'inactivating the module does not delete material data'
);

UPDATE public.empresa_modules
SET status = 'active',
    activated_at = now()
WHERE id = '43000000-0000-4000-8000-000000000001';

SELECT ok(
  public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'reactivating the entitlement restores access'
);

UPDATE public.empresa_modules
SET expires_at = now() - interval '1 second'
WHERE id = '43000000-0000-4000-8000-000000000001';

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'an expired entitlement fails closed'
);

SELECT ok(
  public.company_has_active_module(
    '42000000-0000-4000-8000-000000000003',
    'gestao_materiais'
  ),
  'a lifetime company receives current and future module access'
);

-- etiquetas_materiais was the "not released yet" example when this test was
-- written, but it shipped in Stage 6 - pinning this check to whichever real
-- module happens to still be unreleased is exactly the fragility that broke
-- this assertion once already. A synthetic catalog row scoped to this
-- transaction exercises the same "exists but ativo=false" code path without
-- depending on the state of the real release backlog.
INSERT INTO public.module_catalog (feature_key, nome, ativo, metadata)
VALUES ('__unreleased_test_module__', '__unreleased_test_module__', false, '{"planned":true}'::jsonb);

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000003',
    '__unreleased_test_module__'
  ),
  'a lifetime company cannot enter a module that is not released yet'
);

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000003',
    '__unknown_material_module__'
  ),
  'a lifetime company cannot use an unknown feature key'
);

UPDATE public.module_catalog
SET ativo = true
WHERE feature_key = 'controle_estoque';

SELECT ok(
  public.company_has_active_module(
    '42000000-0000-4000-8000-000000000003',
    'controle_estoque'
  ),
  'a released future module becomes available to a lifetime company'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_modules (
      empresa_id,
      module_id,
      status,
      activated_at,
      granted_by_admin,
      origem
    )
    SELECT
      '42000000-0000-4000-8000-000000000001',
      id,
      'active',
      now(),
      true,
      'manual_admin'
    FROM public.module_catalog
    WHERE feature_key = 'controle_estoque'
  $test$,
  'P0001',
  'Cannot activate a module before its dependencies',
  'a dependent module cannot be activated before its base module'
);

UPDATE public.empresa_modules
SET expires_at = now() + interval '30 days'
WHERE id = '43000000-0000-4000-8000-000000000001';

SELECT lives_ok(
  $test$
    INSERT INTO public.empresa_modules (
      id,
      empresa_id,
      module_id,
      status,
      activated_at,
      granted_by_admin,
      origem
    )
    SELECT
      '43000000-0000-4000-8000-000000000002',
      '42000000-0000-4000-8000-000000000001',
      id,
      'active',
      now(),
      true,
      'manual_admin'
    FROM public.module_catalog
    WHERE feature_key = 'controle_estoque'
  $test$,
  'a dependent entitlement can be activated after its base module'
);

SELECT ok(
  public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'controle_estoque'
  ),
  'dependency-aware access recognizes the enabled child module'
);

SELECT throws_ok(
  $test$
    UPDATE public.empresa_modules
    SET status = 'inactive'
    WHERE id = '43000000-0000-4000-8000-000000000001'
  $test$,
  'P0001',
  'Cannot disable a module while dependent modules are active',
  'the base module cannot be disabled while a child remains active'
);

SELECT lives_ok(
  $test$
    UPDATE public.empresa_modules
    SET status = 'inactive'
    WHERE id = '43000000-0000-4000-8000-000000000002';

    UPDATE public.empresa_modules
    SET status = 'inactive'
    WHERE id = '43000000-0000-4000-8000-000000000001'
  $test$,
  'dependent modules can be disabled before their base module'
);

SELECT ok(
  NOT public.company_has_active_module(
    '42000000-0000-4000-8000-000000000001',
    'gestao_materiais'
  ),
  'the base module is inaccessible after an orderly deactivation'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.categorias_materiais
    WHERE id = '44000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'module deactivation preserves data for a later reactivation'
);

SELECT throws_ok(
  $test$
    DELETE FROM public.module_catalog
    WHERE feature_key = 'gestao_materiais'
  $test$,
  'P0001',
  'Canonical material module catalog entries cannot be deleted',
  'stable material module catalog entries cannot be deleted accidentally'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'materiais'
      AND cmd = 'SELECT'
      AND qual ILIKE '%can_read_company_module%'
      AND qual ILIKE '%gestao_materiais%'
  ),
  'material reads require the commercial module in RLS'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'materiais'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_module%'
      AND with_check ILIKE '%gestao_materiais%'
  ),
  'material writes require both administrator role and module entitlement'
);

SELECT ok(
  pg_get_functiondef(
    'public.can_read_material_photo_object(text)'::regprocedure
  ) ILIKE '%can_read_company_module%'
  AND pg_get_functiondef(
    'public.can_manage_material_photo_object(text)'::regprocedure
  ) ILIKE '%can_write_company_module%',
  'private Storage authorization also requires the material module'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.module_dependencies'::regclass
  ),
  'the reusable module dependency graph has RLS enabled'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'categorias_materiais',
        'materiais',
        'materiais_fotos',
        'module_dependencies'
      )
      AND (
        'anon' = ANY (roles)
        OR 'public' = ANY (roles)
      )
  ),
  0::bigint,
  'material entitlements never grant policies to anon or public'
);

SELECT ok(
  pg_get_functiondef(
    'public.company_has_active_module(uuid,text)'::regprocedure
  ) ILIKE '%company_module_dependencies_satisfied%',
  'the canonical entitlement helper validates module dependencies'
);

SELECT * FROM finish();

ROLLBACK;
