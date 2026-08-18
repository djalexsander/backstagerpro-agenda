-- Regression coverage for P1-11 (20260818160000_empresa_billing_document.sql):
-- public.empresas.cpf_cnpj (new column) and prepare_asaas_charge's extended
-- return shape (adds 'empresa_documento').
--
-- Does not re-test prepare_asaas_charge's pre-existing authorization,
-- pricing or module-purchase logic (untouched by this migration) beyond
-- what's needed to prove the "active charge already exists" idempotency
-- guard still fires correctly after the CREATE OR REPLACE.
--
-- NOTE: authored and reviewed statically but NOT executed - this
-- environment has no local Postgres/Docker/pgTAP runtime (same constraint
-- noted throughout this repo's other pgTAP suites). Run with
-- `supabase test db --linked` (or an equivalent local Postgres) before
-- relying on it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(11);

INSERT INTO public.planos (id, nome, valor, periodicidade, ativo)
VALUES ('ba100000-0000-4000-8000-000000000001', '__billing_document_test_plan__', 149, 'mensal', true);

-- Company A: valid CNPJ on file, ready to purchase the plan above
-- (plano_id points at it and status_pagamento is 'aguardando_pagamento',
-- the exact precondition prepare_asaas_charge checks).
-- Company B: same purchase precondition, but no document at all yet - the
-- realistic "not migrated/filled in" state every existing company starts in.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at, cpf_cnpj
) VALUES
  ('ba000000-0000-4000-8000-000000000001', '__billing_document_company_a__',
   'ativo', 'ba100000-0000-4000-8000-000000000001', false, false, 'aguardando_pagamento', NULL, NULL, '11222333000181'),
  ('ba000000-0000-4000-8000-000000000002', '__billing_document_company_b__',
   'ativo', 'ba100000-0000-4000-8000-000000000001', false, false, 'aguardando_pagamento', NULL, NULL, NULL);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'ba200000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'billing-document-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Billing Document Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ba200000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'billing-document-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Billing Document Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'ba000000-0000-4000-8000-000000000001'
WHERE user_id = 'ba200000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = 'ba000000-0000-4000-8000-000000000002'
WHERE user_id = 'ba200000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles WHERE user_id IN (
  'ba200000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('ba200000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('ba200000-0000-4000-8000-000000000002', 'admin_empresa');

-- 1-2: column shape - digits-only, 11 or 14 characters, mirrors
-- clientes.cpf_cnpj's own constraint exactly.
SELECT lives_ok(
  $$ UPDATE public.empresas SET cpf_cnpj = '98765432100' WHERE id = 'ba000000-0000-4000-8000-000000000002' $$,
  'a well-shaped 11-digit CPF is accepted'
);
SELECT throws_ok(
  $$ UPDATE public.empresas SET cpf_cnpj = '123' WHERE id = 'ba000000-0000-4000-8000-000000000002' $$,
  '23514',
  'a document with the wrong digit count is rejected by the CHECK constraint'
);
-- Restore company B to "no document yet" for the prepare_asaas_charge scenarios below.
UPDATE public.empresas SET cpf_cnpj = NULL WHERE id = 'ba000000-0000-4000-8000-000000000002';

-- 3: a real-world CNPJ/CPF should never belong to two different tenant
-- companies on this platform (unlike clientes.cpf_cnpj, which is scoped
-- per empresa_id on purpose).
SELECT throws_ok(
  $$ UPDATE public.empresas SET cpf_cnpj = '11222333000181' WHERE id = 'ba000000-0000-4000-8000-000000000002' $$,
  '23505',
  'the same document cannot be reused by a second company (global uniqueness)'
);

-- 4, 6, 7: prepare_asaas_charge is called for company A exactly ONCE and its
-- full result stored - calling it a second time for the same company+plan
-- would itself hit the "active charge already exists" guard exercised
-- separately in assertion 8, so every field it returns is asserted from
-- this single captured call rather than re-invoking the RPC per field.
CREATE TEMP TABLE prepared_charge_a AS
SELECT public.prepare_asaas_charge(
  'ba200000-0000-4000-8000-000000000001'::uuid,
  'ba100000-0000-4000-8000-000000000001'::uuid,
  NULL
) AS result;

SELECT is(
  (SELECT result ->> 'empresa_documento' FROM prepared_charge_a),
  '11222333000181',
  'company A''s charge preparation returns company A''s own cpf_cnpj'
);
SELECT is(
  (SELECT result ->> 'empresa_nome' FROM prepared_charge_a),
  '__billing_document_company_a__',
  'empresa_nome is still returned alongside the new field'
);
SELECT is(
  (SELECT (result ->> 'amount')::numeric FROM prepared_charge_a),
  149::numeric,
  'amount still comes from the trusted catalog price, unaffected by the new field'
);

-- 5: company B's OWN (separate) preparation call returns NULL, never
-- company A's document - proves isolation without needing to reach into
-- create-asaas-charge's Deno runtime.
SELECT is(
  (public.prepare_asaas_charge('ba200000-0000-4000-8000-000000000002'::uuid, 'ba100000-0000-4000-8000-000000000001'::uuid, NULL) ->> 'empresa_documento'),
  NULL,
  'company B''s charge preparation returns NULL, never company A''s document, while B has none on file'
);

-- 8: idempotency guard (pre-existing, not touched by this migration) still
-- fires - the captured call above already left a 'pending' asaas_payments
-- row for company A's plan, so a further attempt must still be rejected
-- instead of creating a second reservation for the same resource.
SELECT throws_ok(
  $$ SELECT public.prepare_asaas_charge('ba200000-0000-4000-8000-000000000001'::uuid, 'ba100000-0000-4000-8000-000000000001'::uuid, NULL) $$,
  'P0001',
  'An active charge already exists for this plan',
  'the pre-existing "active charge already exists" idempotency guard still rejects a duplicate preparation after the CREATE OR REPLACE'
);

-- 9: authorization untouched - a non-admin actor is still rejected before
-- any company/document is even looked up.
DELETE FROM public.user_roles WHERE user_id = 'ba200000-0000-4000-8000-000000000002';
INSERT INTO public.user_roles (user_id, role) VALUES ('ba200000-0000-4000-8000-000000000002', 'usuario');
SELECT throws_ok(
  $$ SELECT public.prepare_asaas_charge('ba200000-0000-4000-8000-000000000002'::uuid, 'ba100000-0000-4000-8000-000000000001'::uuid, NULL) $$,
  'P0001',
  'Only a company administrator can create a charge',
  'a non-admin actor is still rejected, independent of the document field'
);

-- 10-11: ACL untouched by the CREATE OR REPLACE - only service_role may execute.
SELECT is(
  has_function_privilege('anon', 'public.prepare_asaas_charge(uuid, uuid, uuid)', 'EXECUTE'),
  false,
  'anon still has no EXECUTE on prepare_asaas_charge'
);
SELECT is(
  has_function_privilege('authenticated', 'public.prepare_asaas_charge(uuid, uuid, uuid)', 'EXECUTE'),
  false,
  'authenticated still has no EXECUTE on prepare_asaas_charge (service_role-only, called from the Edge Function)'
);

SELECT * FROM finish();
ROLLBACK;
