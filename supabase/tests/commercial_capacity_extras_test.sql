BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(25);

SELECT is(
  (
    SELECT count(*)
    FROM public.module_catalog
    WHERE feature_key IN ('extra_eventos', 'extra_usuarios', 'extra_storage')
  ),
  3::bigint,
  'all three historical capacity catalog rows remain present'
);

SELECT ok(
  NOT (SELECT ativo FROM public.module_catalog WHERE feature_key = 'extra_storage'),
  'storage extra is not commercially active without byte enforcement'
);

SELECT is(
  (
    SELECT metadata ->> 'implementation_status'
    FROM public.module_catalog
    WHERE feature_key = 'extra_storage'
  ),
  'not_enforced',
  'storage extra records why it is not sold'
);

SELECT is(
  (SELECT valor FROM public.module_catalog WHERE feature_key = 'extra_eventos'),
  49.90::numeric,
  'event extra receives the approved monthly catalog price'
);

SELECT is(
  (
    SELECT capacidade_extra_eventos
    FROM public.module_catalog
    WHERE feature_key = 'extra_eventos'
  ),
  20,
  'event extra receives the approved +20 capacity'
);

SELECT ok(
  (SELECT ativo FROM public.module_catalog WHERE feature_key = 'extra_eventos'),
  'event extra is commercially active with real capacity'
);

SELECT is(
  (SELECT valor FROM public.module_catalog WHERE feature_key = 'extra_usuarios'),
  39.90::numeric,
  'user extra receives the approved monthly catalog price'
);

SELECT is(
  (
    SELECT capacidade_extra_usuarios
    FROM public.module_catalog
    WHERE feature_key = 'extra_usuarios'
  ),
  20,
  'user extra receives the approved +20 capacity'
);

SELECT ok(
  (SELECT ativo FROM public.module_catalog WHERE feature_key = 'extra_usuarios'),
  'user extra is commercially active with real capacity'
);

SELECT throws_ok(
  $test$
    UPDATE public.module_catalog
    SET ativo = true
    WHERE feature_key = 'extra_storage'
  $test$,
  '23514',
  NULL,
  'storage extra cannot be reactivated before real enforcement exists'
);

SELECT throws_ok(
  $test$
    UPDATE public.module_catalog
    SET ativo = true,
        is_capacity_module = true,
        capacidade_extra_eventos = 0
    WHERE feature_key = 'extra_eventos'
  $test$,
  '23514',
  NULL,
  'event extra cannot be sold with zero effective capacity'
);

SELECT throws_ok(
  $test$
    UPDATE public.module_catalog
    SET ativo = true,
        is_capacity_module = true,
        capacidade_extra_usuarios = 0
    WHERE feature_key = 'extra_usuarios'
  $test$,
  '23514',
  NULL,
  'user extra cannot be sold with zero effective capacity'
);

SELECT lives_ok(
  $test$
    UPDATE public.module_catalog
    SET ativo = true,
        is_capacity_module = true
    WHERE feature_key = 'extra_eventos';

    UPDATE public.module_catalog
    SET ativo = true,
        is_capacity_module = true
    WHERE feature_key = 'extra_usuarios'
  $test$,
  'event and user extras may be active with real positive capacities'
);

SELECT ok(
  pg_get_functiondef('public.request_company_module_batch(uuid[],text)'::regprocedure)
    ILIKE '%sum(catalog.valor)%'
  AND pg_get_functiondef('public.request_company_module_batch(uuid[],text)'::regprocedure)
    ILIKE '%catalog.valor%',
  'self-service snapshots the server-side catalog price'
);

SELECT ok(
  pg_get_functiondef('public.check_event_limit()'::regprocedure)
    ILIKE '%capacidade_extra_eventos%'
  AND pg_get_functiondef('public.check_event_limit()'::regprocedure)
    ILIKE '%company_module.empresa_id = new.empresa_id%'
  AND pg_get_functiondef('public.check_event_limit()'::regprocedure)
    ILIKE '%company_module.status = ''active''%',
  'event quota enforcement sums active capacity in the same company'
);

SELECT ok(
  pg_get_functiondef('public.check_user_limit()'::regprocedure)
    ILIKE '%capacidade_extra_usuarios%'
  AND pg_get_functiondef('public.check_user_limit()'::regprocedure)
    ILIKE '%company_module.empresa_id = new.empresa_id%'
  AND pg_get_functiondef('public.check_user_limit()'::regprocedure)
    ILIKE '%company_module.status = ''active''%',
  'user quota enforcement sums active capacity in the same company'
);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
)
SELECT
  '74000000-0000-4000-8000-000000000001',
  '__p1_4_fallback_plan__', 100, 1, 1, true, 'mensal', 'plano_base'
WHERE NOT EXISTS (
  SELECT 1 FROM public.planos
  WHERE categoria = 'plano_base'
    AND ativo
    AND periodicidade IN ('mensal', 'anual')
);

UPDATE public.planos
SET max_usuarios = 1,
    max_eventos = 1
WHERE id = (
  SELECT id FROM public.planos
  WHERE categoria = 'plano_base'
    AND ativo
    AND periodicidade IN ('mensal', 'anual')
  ORDER BY id
  LIMIT 1
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
)
SELECT company_id, company_name, 'ativo', plan.id, false, false, 'pago',
       now() + interval '30 days'
FROM (
  VALUES
    ('75000000-0000-4000-8000-000000000001'::uuid, '__p1_4_company_a__'),
    ('75000000-0000-4000-8000-000000000002'::uuid, '__p1_4_company_b__')
) AS fixture(company_id, company_name)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos
  WHERE categoria = 'plano_base'
    AND ativo
    AND periodicidade IN ('mensal', 'anual')
  ORDER BY id
  LIMIT 1
) AS plan;

DELETE FROM public.empresa_modules
WHERE empresa_id IN (
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002'
)
  AND module_id IN (
    SELECT id FROM public.module_catalog
    WHERE feature_key IN ('extra_eventos', 'extra_usuarios', 'extra_storage')
  );

INSERT INTO public.events (
  id, date, status, name, artist, city, venue, empresa_id
)
VALUES
  ('76000000-0000-4000-8000-000000000001', current_date, 'pendente',
   '__p1_4_a_event_1__', 'Test', 'Test', 'Test',
   '75000000-0000-4000-8000-000000000001'),
  ('76000000-0000-4000-8000-000000000002', current_date, 'pendente',
   '__p1_4_b_event_1__', 'Test', 'Test', 'Test',
   '75000000-0000-4000-8000-000000000002');

SELECT throws_ok(
  $test$
    INSERT INTO public.events (
      id, date, status, name, artist, city, venue, empresa_id
    ) VALUES (
      '76000000-0000-4000-8000-000000000003', current_date, 'pendente',
      '__p1_4_a_event_blocked__', 'Test', 'Test', 'Test',
      '75000000-0000-4000-8000-000000000001'
    )
  $test$,
  'P0001',
  'Company event limit reached (1 of 1)',
  'base event quota blocks the next event before the extra is active'
);

INSERT INTO public.empresa_modules (
  empresa_id, module_id, status, activated_at, granted_by_admin,
  valor_cobrado, origem
)
SELECT
  '75000000-0000-4000-8000-000000000001', id, 'active', now(), true,
  valor, 'p1_4_test'
FROM public.module_catalog
WHERE feature_key = 'extra_eventos';

SELECT lives_ok(
  $test$
    DO $loop$
    BEGIN
      FOR sequence IN 1..20 LOOP
        INSERT INTO public.events (
          id, date, status, name, artist, city, venue, empresa_id
        ) VALUES (
          gen_random_uuid(), current_date, 'pendente',
          '__p1_4_a_extra_event_' || sequence, 'Test', 'Test', 'Test',
          '75000000-0000-4000-8000-000000000001'
        );
      END LOOP;
    END;
    $loop$
  $test$,
  'active +Eventos permits all twenty additional events'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.events (
      id, date, status, name, artist, city, venue, empresa_id
    ) VALUES (
      '76000000-0000-4000-8000-000000000006', current_date, 'pendente',
      '__p1_4_a_event_over_plus_20__', 'Test', 'Test', 'Test',
      '75000000-0000-4000-8000-000000000001'
    )
  $test$,
  'P0001',
  'Company event limit reached (21 of 21)',
  'event trigger applies exactly the configured +20 capacity'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.events (
      id, date, status, name, artist, city, venue, empresa_id
    ) VALUES (
      '76000000-0000-4000-8000-000000000006', current_date, 'pendente',
      '__p1_4_b_event_still_blocked__', 'Test', 'Test', 'Test',
      '75000000-0000-4000-8000-000000000002'
    )
  $test$,
  'P0001',
  'Company event limit reached (1 of 1)',
  'event capacity entitlement does not leak to another company'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
  '',
  now(),
  '{}',
  jsonb_build_object('full_name', email),
  now(),
  now()
FROM (
  SELECT
    (
      '77000000-0000-4000-8000-'
      || lpad(sequence::text, 12, '0')
    )::uuid AS user_id,
    'p1-4-user-' || sequence || '@example.test' AS email
  FROM generate_series(1, 24) AS sequence
) AS fixture(user_id, email);

INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
VALUES
  ('75000000-0000-4000-8000-000000000001',
   '77000000-0000-4000-8000-000000000001', 'usuario'),
  ('75000000-0000-4000-8000-000000000002',
   '77000000-0000-4000-8000-000000000002', 'usuario');

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
    VALUES (
      '75000000-0000-4000-8000-000000000001',
      '77000000-0000-4000-8000-000000000003', 'usuario'
    )
  $test$,
  'P0001',
  'Company user limit reached (1 of 1)',
  'base user quota blocks the next membership before the extra is active'
);

INSERT INTO public.empresa_modules (
  empresa_id, module_id, status, activated_at, granted_by_admin,
  valor_cobrado, origem
)
SELECT
  '75000000-0000-4000-8000-000000000001', id, 'active', now(), true,
  valor, 'p1_4_test'
FROM public.module_catalog
WHERE feature_key = 'extra_usuarios';

SELECT lives_ok(
  $test$
    DO $loop$
    BEGIN
      FOR sequence IN 3..22 LOOP
        INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
        VALUES (
          '75000000-0000-4000-8000-000000000001',
          (
            '77000000-0000-4000-8000-'
            || lpad(sequence::text, 12, '0')
          )::uuid,
          'usuario'
        );
      END LOOP;
    END;
    $loop$
  $test$,
  'active +Usuarios permits all twenty additional memberships'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
    VALUES (
      '75000000-0000-4000-8000-000000000001',
      '77000000-0000-4000-8000-000000000023', 'usuario'
    )
  $test$,
  'P0001',
  'Company user limit reached (21 of 21)',
  'user trigger applies exactly the configured +20 capacity'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
    VALUES (
      '75000000-0000-4000-8000-000000000002',
      '77000000-0000-4000-8000-000000000024', 'usuario'
    )
  $test$,
  'P0001',
  'Company user limit reached (1 of 1)',
  'user capacity entitlement does not leak to another company'
);

INSERT INTO public.empresa_modules (
  empresa_id, module_id, status, granted_by_admin, valor_cobrado, origem
)
SELECT
  '75000000-0000-4000-8000-000000000001', id, 'inactive', true, 15,
  'historical'
FROM public.module_catalog
WHERE feature_key = 'extra_storage';

SELECT is(
  (
    SELECT count(*)
    FROM public.empresa_modules AS entitlement
    JOIN public.module_catalog AS catalog ON catalog.id = entitlement.module_id
    WHERE entitlement.empresa_id = '75000000-0000-4000-8000-000000000001'
      AND catalog.feature_key = 'extra_storage'
      AND entitlement.status = 'inactive'
      AND entitlement.valor_cobrado = 15
  ),
  1::bigint,
  'historical storage entitlement remains available to Master history'
);

SELECT * FROM finish();

ROLLBACK;
