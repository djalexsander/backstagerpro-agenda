BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

SELECT is(
  (
    SELECT count(*)
    FROM public.planos
    WHERE nome = 'Teste Gratuito de 7 Dias'
      AND periodicidade = 'trial'
      AND categoria = 'trial'
      AND valor = 0
      AND trial_days = 7
      AND max_usuarios = 5
      AND max_eventos = 20
      AND ativo = true
      AND disponivel_novo_cadastro = true
  ),
  1::bigint,
  'the public seven-day trial has its canonical values'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.planos
    WHERE nome = 'Vitalícia'
      AND periodicidade = 'vitalicio'
      AND categoria = 'plano_base'
      AND ativo = true
      AND disponivel_novo_cadastro = false
      AND valor = 0
      AND trial_days = 0
      AND max_usuarios IS NULL
      AND max_eventos IS NULL
      AND storage_limit IS NULL
  ),
  1::bigint,
  'the official lifetime plan is separate, unlimited and non-public'
);

SELECT isnt(
  (
    SELECT id
    FROM public.planos
    WHERE periodicidade = 'trial'
  ),
  (
    SELECT id
    FROM public.planos
    WHERE periodicidade = 'vitalicio'
  ),
  'trial and lifetime plans have different IDs'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.empresas AS company
    JOIN public.planos AS plan
      ON plan.id = company.plano_id
    WHERE company.nome_empresa =
          '64.257.267 ALEX SANDRO XAVIER VIEIRA'
      AND plan.periodicidade = 'vitalicio'
      AND company.status = 'ativo'
      AND company.status_pagamento = 'isento'
      AND company.vencimento IS NULL
      AND company.trial_expires_at IS NULL
  ),
  1::bigint,
  'the requested company remains assigned to the separate lifetime plan'
);

INSERT INTO public.empresas (
  id,
  nome_empresa,
  status,
  plano,
  plano_id,
  plano_bloqueado,
  precisa_escolher_plano,
  status_pagamento,
  vencimento,
  trial_expires_at
)
SELECT
  '25000000-0000-4000-8000-000000000001',
  '__lifetime_license_test__',
  'ativo',
  plan.nome,
  plan.id,
  false,
  false,
  'isento',
  NULL,
  NULL
FROM public.planos AS plan
WHERE plan.periodicidade = 'vitalicio';

SELECT ok(
  public.company_has_lifetime_subscription(
    '25000000-0000-4000-8000-000000000001'
  ),
  'company is recognized as lifetime'
);

SELECT ok(
  public.company_has_operational_access(
    '25000000-0000-4000-8000-000000000001'
  ),
  'lifetime company has operational access without payment or expiration'
);

SELECT ok(
  NOT public.company_has_active_module(
    '25000000-0000-4000-8000-000000000001',
    '__future_module_without_catalog_row__'
  ),
  'lifetime access fails closed for unknown catalog feature keys'
);

SELECT is(
  (
    SELECT max_usuarios
    FROM public.planos
    WHERE periodicidade = 'vitalicio'
  ),
  NULL::integer,
  'lifetime user capacity is unlimited'
);

SELECT is(
  (
    SELECT max_eventos
    FROM public.planos
    WHERE periodicidade = 'vitalicio'
  ),
  NULL::integer,
  'lifetime event capacity is unlimited'
);

SELECT throws_ok(
  $test$
    DELETE FROM public.planos
    WHERE periodicidade = 'vitalicio'
  $test$,
  'P0001',
  'The canonical lifetime plan cannot be deleted',
  'the canonical lifetime plan cannot be deleted'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.pagamentos (empresa_id, valor)
    VALUES ('25000000-0000-4000-8000-000000000001', 10)
  $test$,
  'P0001',
  'Lifetime companies do not accept plan or module charges',
  'legacy payment creation is rejected'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.asaas_payments (
      payment_type,
      empresa_id,
      amount
    )
    VALUES (
      'base_plan',
      '25000000-0000-4000-8000-000000000001',
      10
    )
  $test$,
  'P0001',
  'Lifetime companies do not accept plan or module charges',
  'Asaas payment creation is rejected'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.planos
    WHERE periodicidade IN ('trial', 'vitalicio')
  ),
  2::bigint,
  'there is exactly one trial and one lifetime system plan'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (
    SELECT user_id::text
    FROM public.user_roles
    WHERE role = 'master_admin'
    ORDER BY user_id
    LIMIT 1
  ),
  true
);

SELECT ok(
  NOT (
    public.set_company_lifetime_subscription(
      (
        SELECT id
        FROM public.empresas
        WHERE nome_empresa =
              '64.257.267 ALEX SANDRO XAVIER VIEIRA'
      )
    )->>'alterado'
  )::boolean,
  'the master-only lifetime RPC is idempotent on the separate plan'
);

SELECT * FROM finish();

ROLLBACK;
