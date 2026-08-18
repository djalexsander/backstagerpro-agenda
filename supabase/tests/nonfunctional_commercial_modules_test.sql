BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(10);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN (
      'agenda_compartilhada',
      'equipe_permissoes',
      'notificacoes_premium',
      'relatorios_materiais'
    )
  ),
  4::bigint,
  'all historical catalog rows are preserved'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN (
      'agenda_compartilhada',
      'equipe_permissoes',
      'notificacoes_premium',
      'relatorios_materiais'
    )
      AND ativo
  ),
  0::bigint,
  'modules without a separate deliverable are not commercially active'
);

SELECT is(
  (
    SELECT metadata ->> 'implementation_status'
    FROM public.module_catalog
    WHERE feature_key = 'equipe_permissoes'
  ),
  'covered_by_core',
  'team and permissions is documented as covered by core administration'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN (
      'agenda_compartilhada',
      'notificacoes_premium',
      'relatorios_materiais'
    )
      AND metadata ->> 'implementation_status' = 'not_implemented'
  ),
  3::bigint,
  'the three modules without dedicated implementations are documented'
);

SELECT ok(
  (SELECT ativo FROM public.module_catalog WHERE feature_key = 'gestao_materiais'),
  'a real materials module remains commercially active'
);

SELECT ok(
  (SELECT ativo FROM public.module_catalog WHERE feature_key = 'relatorios'),
  'the implemented general reports module remains commercially active'
);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
)
VALUES (
  '71000000-0000-4000-8000-000000000001',
  '__p1_3_plan__', 100, 10, 100, false, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
)
VALUES
  (
    '72000000-0000-4000-8000-000000000001', '__p1_3_company_a__',
    'ativo', '71000000-0000-4000-8000-000000000001', false,
    false, 'pago', now() + interval '30 days'
  ),
  (
    '72000000-0000-4000-8000-000000000002', '__p1_3_company_b__',
    'ativo', '71000000-0000-4000-8000-000000000001', false,
    false, 'pago', now() + interval '30 days'
  );

INSERT INTO public.empresa_modules (
  id, empresa_id, module_id, status, activated_at,
  granted_by_admin, valor_cobrado, origem
)
SELECT
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  id,
  'active',
  now() - interval '10 days',
  true,
  25,
  'historical'
FROM public.module_catalog
WHERE feature_key = 'agenda_compartilhada';

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE id = '73000000-0000-4000-8000-000000000001'
      AND empresa_id = '72000000-0000-4000-8000-000000000001'
      AND status = 'active'
      AND valor_cobrado = 25
  ),
  1::bigint,
  'historical entitlement data is not deleted or rewritten'
);

SELECT is(
  (
    SELECT catalog.feature_key
    FROM public.empresa_modules AS entitlement
    JOIN public.module_catalog AS catalog ON catalog.id = entitlement.module_id
    WHERE entitlement.id = '73000000-0000-4000-8000-000000000001'
  ),
  'agenda_compartilhada',
  'Master history can still resolve an entitlement to its catalog row'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules
    WHERE empresa_id = '72000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'historical entitlement remains isolated to its own company'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE ativo
      AND feature_key NOT IN (
        'agenda_compartilhada',
        'equipe_permissoes',
        'notificacoes_premium',
        'relatorios_materiais'
      )
  ),
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE ativo
  ),
  'no functional active module was disabled by mistake'
);

SELECT * FROM finish();

ROLLBACK;

