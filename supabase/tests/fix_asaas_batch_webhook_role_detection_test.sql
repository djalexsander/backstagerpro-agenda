-- Regression coverage for 20260916160000_fix_asaas_batch_webhook_role_detection.sql.
-- Reproduces the production incident: protect_asaas_batch_manual_transition()
-- and protect_asaas_batch_manual_activation() only checked the flat GUC
-- current_setting('request.jwt.claim.role', true), which this project's own
-- auth.role() proves is not reliably populated — it falls back to parsing
-- request.jwt.claims. The fixture below sets ONLY request.jwt.claims (the
-- exact shape a real PostgREST service-role request left the GUCs in),
-- never the flat claim, so this test would have failed against the original
-- 20260916100000 trigger bodies and must pass against the fixed ones.
-- Run with `supabase test db` against a database containing all migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.planos (
  id, nome, valor, periodicidade, categoria, ativo,
  disponivel_novo_cadastro, trial_days
) VALUES (
  'f9000000-0000-4000-8000-000000000001',
  '__asaas_webhook_role_fix_plan__',
  100,
  'mensal',
  'plano_base',
  true,
  true,
  0
);

INSERT INTO public.module_catalog (
  id, nome, feature_key, valor, periodicidade, ativo, ordem
) VALUES (
  'f9200000-0000-4000-8000-000000000001',
  '__asaas_webhook_role_fix_module__',
  '__asaas_webhook_role_fix_module__',
  10,
  'mensal',
  true,
  1
);

INSERT INTO public.empresas (
  id, nome_empresa, email, cpf_cnpj, status, plano, plano_id,
  plano_bloqueado, precisa_escolher_plano, status_pagamento,
  vencimento, trial_expires_at
) VALUES (
  'f9100000-0000-4000-8000-000000000001',
  '__asaas_webhook_role_fix_company__',
  'asaas-webhook-role-fix@example.test',
  '11222333000181',
  'ativo',
  '__asaas_webhook_role_fix_plan__',
  'f9000000-0000-4000-8000-000000000001',
  false,
  false,
  'pago',
  clock_timestamp() + interval '40 days',
  NULL
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'f9300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'awrf-regular-user@example.test', '', now(), '{}', '{"full_name":"AWRF Regular"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f9300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'awrf-master@example.test', '', now(), '{}', '{"full_name":"AWRF Master"}', now(), now());

UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'f9300000-0000-4000-8000-000000000002';

-- has_role()/is_master_admin() only recognize an activated account.
UPDATE public.profiles SET ativado = true, activated_at = now()
WHERE user_id = 'f9300000-0000-4000-8000-000000000002';

-- Batch exactly as prepare_asaas_module_batch_charge would create it.
INSERT INTO public.module_batch_requests (
  id, empresa_id, valor_total, status, payment_method, observacao
) VALUES (
  'f9400000-0000-4000-8000-000000000001',
  'f9100000-0000-4000-8000-000000000001',
  10,
  'pending',
  'asaas',
  'Server-created Asaas module batch charge'
);

INSERT INTO public.module_batch_request_items (
  id, batch_request_id, module_id, valor
) VALUES (
  'f9500000-0000-4000-8000-000000000001',
  'f9400000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  10
);

INSERT INTO public.asaas_payments (
  id, source_app, payment_type, empresa_id, amount, status, payment_method,
  due_date, related_batch_request_id, related_module_id,
  asaas_payment_id, activation_status
) VALUES (
  'f9600000-0000-4000-8000-000000000001',
  'backstage_pro',
  'modules',
  'f9100000-0000-4000-8000-000000000001',
  10,
  'pending',
  'pix',
  current_date + 3,
  'f9400000-0000-4000-8000-000000000001',
  NULL,
  'pay_awrf_test_0001',
  'pending'
);

-- The AFTER INSERT ON empresas trigger (provision_company_module_entitlements)
-- already seeded every catalog module, including this one, as status
-- 'inactive' — UPDATE that row instead of INSERTing (an INSERT collides with
-- prevent_duplicate_company_module). This also matches the real incident,
-- whose empresa_modules rows were pre-provisioned before payment.
UPDATE public.empresa_modules
SET status = 'inactive', valor_cobrado = 10, origem = 'provisioning'
WHERE empresa_id = 'f9100000-0000-4000-8000-000000000001'
  AND module_id = 'f9200000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 1. Usuario comum continua bloqueado (nem transicao do lote, nem ativacao
--    direta do modulo).
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'f9300000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT throws_ok(
  $test$UPDATE public.module_batch_requests SET status = 'approved' WHERE id = 'f9400000-0000-4000-8000-000000000001'$test$,
  '42501',
  'Asaas module batches can only be changed by the confirmed webhook',
  'usuario comum nao consegue transicionar lote Asaas diretamente'
);

SELECT throws_ok(
  $test$UPDATE public.empresa_modules SET status = 'active' WHERE empresa_id = 'f9100000-0000-4000-8000-000000000001' AND module_id = 'f9200000-0000-4000-8000-000000000001'$test$,
  '42501',
  'Asaas module batch entitlements can only be activated by the confirmed webhook',
  'usuario comum nao consegue ativar entitlement Asaas diretamente'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);

-- ----------------------------------------------------------------------------
-- 2. Protecao manual continua funcionando: master_admin continua impedido de
--    aprovar o lote Asaas via master_approve_module_batch_request (checagem
--    pre-existente, nao alterada por esta migration, mas testada aqui para
--    provar que o fix nao afrouxou a protecao geral introduzida em
--    20260916100000). Roda antes do grupo 3 porque aquele muda o status do
--    lote para 'approved'.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'f9300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.master_approve_module_batch_request('f9400000-0000-4000-8000-000000000001', NULL)$test$,
  '42501',
  'Asaas module batches can only be approved by the confirmed webhook',
  'master_admin continua impedido de aprovar lote Asaas manualmente via RPC'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

-- ----------------------------------------------------------------------------
-- 3. service_role consegue executar a transicao legitima quando somente
--    request.jwt.claims (JSON) carrega o role — exatamente como a chamada
--    real do asaas-webhook deixa as GUCs, e exatamente o cenario que
--    quebrou em producao com a versao original das triggers.
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'f9300000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

UPDATE public.module_batch_requests
SET status = 'approved', approved_at = clock_timestamp()
WHERE id = 'f9400000-0000-4000-8000-000000000001';

UPDATE public.empresa_modules
SET status = 'active', activated_at = clock_timestamp()
WHERE empresa_id = 'f9100000-0000-4000-8000-000000000001'
  AND module_id = 'f9200000-0000-4000-8000-000000000001';

SELECT is(
  (SELECT status FROM public.module_batch_requests WHERE id = 'f9400000-0000-4000-8000-000000000001'),
  'approved',
  'service_role (via request.jwt.claims JSON) consegue transicionar o lote Asaas'
);

SELECT is(
  (SELECT status FROM public.empresa_modules WHERE empresa_id = 'f9100000-0000-4000-8000-000000000001' AND module_id = 'f9200000-0000-4000-8000-000000000001'),
  'active',
  'service_role (via request.jwt.claims JSON) consegue ativar o entitlement Asaas'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
