-- Regression coverage for 20260916180000_fix_monthly_vencimento_calendar_anchor.sql.
-- Run with `supabase test db` against a database containing all migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 1. next_monthly_due_date() in isolation — the exact scenarios requested.
-- ----------------------------------------------------------------------------

SELECT is(
  public.next_monthly_due_date('2026-10-16 14:30:00+00'::timestamptz, 16),
  '2026-11-16 14:30:00+00'::timestamptz,
  'dia-base 16: outubro -> novembro mantem o dia 16'
);
SELECT is(
  public.next_monthly_due_date('2026-11-16 14:30:00+00'::timestamptz, 16),
  '2026-12-16 14:30:00+00'::timestamptz,
  'dia-base 16: novembro -> dezembro mantem o dia 16'
);

SELECT is(
  public.next_monthly_due_date('2026-09-19 09:00:00+00'::timestamptz, 19),
  '2026-10-19 09:00:00+00'::timestamptz,
  'dia-base 19: setembro -> outubro mantem o dia 19'
);
SELECT is(
  public.next_monthly_due_date('2026-10-19 09:00:00+00'::timestamptz, 19),
  '2026-11-19 09:00:00+00'::timestamptz,
  'dia-base 19: outubro -> novembro mantem o dia 19'
);

-- 2026 nao e bissexto (2026 / 4 nao e inteiro), entao fevereiro tem 28 dias.
SELECT is(
  public.next_monthly_due_date('2026-01-31 00:00:00+00'::timestamptz, 31),
  '2026-02-28 00:00:00+00'::timestamptz,
  'dia-base 31: janeiro -> fevereiro cai no ultimo dia do mes (28)'
);
SELECT is(
  public.next_monthly_due_date('2026-02-28 00:00:00+00'::timestamptz, 31),
  '2026-03-31 00:00:00+00'::timestamptz,
  'dia-base 31: a partir do fevereiro ja clampado, marco volta para o dia 31 (nao perde o dia-base)'
);

-- ----------------------------------------------------------------------------
-- Shared fixtures
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, periodicidade, categoria, ativo,
  disponivel_novo_cadastro, trial_days
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  '__vencimento_fix_plan__',
  100,
  'mensal',
  'plano_base',
  true,
  true,
  0
);

-- ----------------------------------------------------------------------------
-- 2. choose_company_plan (self-service first purchase) — zero prior coverage.
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  'fa200000-0000-4000-8000-000000000001',
  '__vencimento_fix_choose_company__',
  'vencimento-fix-choose@example.test',
  '11222333000181',
  'ativo',
  NULL,
  NULL,
  false,
  true,
  NULL,
  NULL
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'fa300000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'vencimento-fix-choose-admin@example.test', '', now(), '{}',
  '{"full_name":"Vencimento Fix Choose Admin"}', now(), now()
);

UPDATE public.profiles SET empresa_id = 'fa200000-0000-4000-8000-000000000001'
WHERE user_id = 'fa300000-0000-4000-8000-000000000001';
DELETE FROM public.user_roles WHERE user_id = 'fa300000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles (user_id, role)
VALUES ('fa300000-0000-4000-8000-000000000001', 'admin_empresa');

CREATE TEMP TABLE choose_plan_before AS SELECT clock_timestamp() AS at;

SELECT public.choose_company_plan(
  'fa300000-0000-4000-8000-000000000001',
  'paid',
  'fa100000-0000-4000-8000-000000000001'
);

-- date_trunc('second', ...): choose_company_plan calls clock_timestamp()
-- internally a fraction of a second after this fixture's own capture, so an
-- exact-microsecond comparison would be flaky; the day/month/year/H/M/S
-- match is what actually proves the anchor logic.
SELECT is(
  date_trunc('second', (SELECT vencimento FROM public.empresas WHERE id = 'fa200000-0000-4000-8000-000000000001')),
  date_trunc('second', (SELECT public.next_monthly_due_date(at, EXTRACT(DAY FROM at)::integer) FROM choose_plan_before)),
  'choose_company_plan (mensal) ancora no proprio dia da compra, um mes calendario a frente'
);

-- ----------------------------------------------------------------------------
-- 3. master_set_company_plan fallback branch (no explicit _vencimento) —
--    zero prior coverage. data_contrato preexistente (dia 31) deve ser o
--    ancora, nao o dia de "agora".
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento, vencimento,
  data_contrato
) VALUES (
  'fa200000-0000-4000-8000-000000000002',
  '__vencimento_fix_master_company__',
  'vencimento-fix-master@example.test',
  '98765432100',
  'ativo',
  NULL,
  NULL,
  false,
  false,
  'pago',
  NULL,
  '2026-01-31'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'fa300000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated',
  'vencimento-fix-master@example.test', '', now(), '{}',
  '{"full_name":"Vencimento Fix Master"}', now(), now()
);

UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'fa300000-0000-4000-8000-000000000002';
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = 'fa300000-0000-4000-8000-000000000002';

SELECT set_config('request.jwt.claim.sub', 'fa300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE master_set_plan_before AS SELECT clock_timestamp() AS at;

SELECT public.master_set_company_plan(
  'fa200000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  'ativo',
  NULL,
  false
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT is(
  date_trunc('second', (SELECT vencimento FROM public.empresas WHERE id = 'fa200000-0000-4000-8000-000000000002')),
  date_trunc('second', (SELECT public.next_monthly_due_date(at, 31) FROM master_set_plan_before)),
  'master_set_company_plan sem _vencimento explicito ancora no dia de data_contrato (31), nao no dia de agora'
);

-- ----------------------------------------------------------------------------
-- 4. process_asaas_payment_webhook (renewal) — auto-cura de um vencimento ja
--    desviado por um ciclo anterior com a regra antiga (+30 dias): dia-base
--    31, vencimento atual em 28/02 (ja clampado), confirmacao antecipada
--    (antes de 28/02) deve avancar para 31/03, nao 28/03 nem uma data
--    derivada de "28 + 30 dias".
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento, vencimento,
  data_contrato
) VALUES (
  'fa200000-0000-4000-8000-000000000003',
  '__vencimento_fix_selfheal_company__',
  'vencimento-fix-selfheal@example.test',
  '11444777000161',
  'ativo',
  '__vencimento_fix_plan__',
  'fa100000-0000-4000-8000-000000000001',
  false,
  false,
  'pago',
  '2026-02-28 00:00:00+00',
  '2026-01-31'
);

INSERT INTO public.asaas_payments (
  id, source_app, payment_type, empresa_id, amount, status, payment_method,
  due_date, related_plano_id, renewal_competence, asaas_payment_id
) VALUES (
  'fa600000-0000-4000-8000-000000000001',
  'backstage_pro',
  'renewal',
  'fa200000-0000-4000-8000-000000000003',
  100,
  'pending',
  'pix',
  '2026-03-03',
  'fa100000-0000-4000-8000-000000000001',
  '2026-02-28',
  'pay_selfheal_test_0001'
);

INSERT INTO public.asaas_renewal_items (
  payment_id, item_type, related_plano_id, amount
) VALUES (
  'fa600000-0000-4000-8000-000000000001',
  'base_plan',
  'fa100000-0000-4000-8000-000000000001',
  100
);

SELECT is(
  public.process_asaas_payment_webhook(
    'evt_vencimento_fix_selfheal',
    'PAYMENT_CONFIRMED',
    'pay_selfheal_test_0001',
    100,
    NULL,
    '2026-02-20 10:00:00+00'::timestamptz
  ) ->> 'action',
  'activated',
  'a renovacao antecipada (antes do vencimento atual) e ativada pelo webhook'
);

SELECT is(
  (SELECT vencimento FROM public.empresas WHERE id = 'fa200000-0000-4000-8000-000000000003'),
  '2026-03-31 00:00:00+00'::timestamptz,
  'renovacao auto-cura um vencimento ja desviado: 28/02 (ja clampado) -> 31/03, usando data_contrato (dia 31) como ancora, nao o dia 28'
);

SELECT * FROM finish();
ROLLBACK;
