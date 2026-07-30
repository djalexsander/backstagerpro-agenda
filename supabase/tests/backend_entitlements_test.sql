BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(17);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade
)
VALUES
  (
    '21000000-0000-4000-8000-000000000001',
    '__backend_entitlement_monthly__',
    100, 10, 100, true, 'mensal'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '__backend_entitlement_lifetime__',
    1000, 10, 100, true, 'vitalicio'
  );

INSERT INTO public.empresas (
  id,
  nome_empresa,
  status,
  plano_id,
  plano_bloqueado,
  precisa_escolher_plano,
  status_pagamento,
  vencimento,
  trial_expires_at
)
VALUES
  (
    '22000000-0000-4000-8000-000000000001',
    '__active_paid__', 'ativo',
    '21000000-0000-4000-8000-000000000001',
    false, false, 'pago', now() + interval '30 days', NULL
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '__pending_payment__', 'ativo',
    '21000000-0000-4000-8000-000000000001',
    true, false, 'aguardando_pagamento',
    now() + interval '30 days', NULL
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '__expired_paid__', 'ativo',
    '21000000-0000-4000-8000-000000000001',
    false, false, 'pago', now() - interval '1 second', NULL
  ),
  (
    '22000000-0000-4000-8000-000000000004',
    '__explicitly_blocked__', 'ativo',
    '21000000-0000-4000-8000-000000000001',
    true, false, 'pago', now() + interval '30 days', NULL
  ),
  (
    '22000000-0000-4000-8000-000000000005',
    '__inactive__', 'inativo',
    '21000000-0000-4000-8000-000000000001',
    false, false, 'pago', now() + interval '30 days', NULL
  ),
  (
    '22000000-0000-4000-8000-000000000006',
    '__needs_plan__', 'ativo', NULL,
    false, true, NULL, NULL, NULL
  ),
  (
    '22000000-0000-4000-8000-000000000007',
    '__active_trial__', 'ativo', NULL,
    false, false, NULL, NULL, now() + interval '1 day'
  ),
  (
    '22000000-0000-4000-8000-000000000008',
    '__expired_trial__', 'ativo', NULL,
    false, false, NULL, NULL, now() - interval '1 second'
  ),
  (
    '22000000-0000-4000-8000-000000000009',
    '__active_lifetime__', 'ativo',
    '21000000-0000-4000-8000-000000000002',
    false, false, 'pago', NULL, NULL
  );

SELECT ok(
  public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000001'
  ),
  'active paid company can perform operational writes'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000002'
  ),
  'pending payment company fails closed'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000003'
  ),
  'expired paid company is read-only'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000004'
  ),
  'explicitly blocked company is read-only'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000005'
  ),
  'inactive company is read-only'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000006'
  ),
  'company awaiting plan selection fails closed'
);
SELECT ok(
  public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000007'
  ),
  'unexpired trial allows operational writes'
);
SELECT ok(
  NOT public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000008'
  ),
  'expired trial is read-only'
);
SELECT ok(
  public.company_has_operational_access(
    '22000000-0000-4000-8000-000000000009'
  ),
  'paid lifetime plan does not require an expiry date'
);

INSERT INTO public.module_catalog (
  id, nome, feature_key, valor, ativo
)
VALUES
  (
    '23000000-0000-4000-8000-000000000001',
    '__active_finance_module__',
    '__backend_entitlement_finance__',
    10, true
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '__inactive_catalog_module__',
    '__backend_entitlement_inactive__',
    10, false
  );

INSERT INTO public.empresa_modules (
  empresa_id, module_id, status, expires_at
)
VALUES
  (
    '22000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'active', now() + interval '1 day'
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '23000000-0000-4000-8000-000000000001',
    'active', now() - interval '1 second'
  );

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_modules (
      empresa_id, module_id, status, expires_at
    )
    VALUES (
      '22000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000002',
      'active', NULL
    )
  $test$,
  'P0001',
  'Cannot activate an inactive catalog module',
  'inactive catalog modules cannot receive active entitlements'
);

SELECT ok(
  public.company_has_active_module(
    '22000000-0000-4000-8000-000000000001',
    '__backend_entitlement_finance__'
  ),
  'active unexpired module is licensed'
);
SELECT ok(
  NOT public.company_has_active_module(
    '22000000-0000-4000-8000-000000000003',
    '__backend_entitlement_finance__'
  ),
  'expired company module is not licensed'
);
SELECT ok(
  NOT public.company_has_active_module(
    '22000000-0000-4000-8000-000000000001',
    '__backend_entitlement_inactive__'
  ),
  'inactive catalog entry is not licensed'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'empresa_modules'
      AND cmd = 'ALL'
  ),
  1::bigint,
  'only the master policy has unrestricted module entitlement commands'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'empresa_usuarios'
      AND cmd = 'ALL'
  ),
  1::bigint,
  'only the master policy has unrestricted company membership commands'
);

INSERT INTO public.events (
  id, date, status, name, artist, city, venue, empresa_id
)
VALUES (
  '24000000-0000-4000-8000-000000000001',
  current_date, 'pendente', '__tenant_a_event__',
  'Test', 'Test', 'Test',
  '22000000-0000-4000-8000-000000000001'
);

SELECT ok(
  public.event_belongs_to_company(
    '24000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001'
  ),
  'event parent relationship accepts the owning tenant'
);
SELECT ok(
  NOT public.event_belongs_to_company(
    '24000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000009'
  ),
  'event parent relationship rejects a cross-tenant UUID'
);

SELECT * FROM finish();

ROLLBACK;
