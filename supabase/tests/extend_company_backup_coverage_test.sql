-- Regression coverage for P1-10 (this migration extends restore_company_backup,
-- added for P0-5 by 20260817200000_atomic_company_backup_restore.sql, whose
-- own coverage stays in atomic_company_backup_restore_test.sql and is not
-- duplicated here). This file only exercises what 20260818090000 adds:
-- clientes/funcionarios (upsert, never deleted) and event_funcionarios/
-- event_checklist_items/document_templates/generated_documents (delete and
-- replace, same as the original four collections).
--
-- NOTE: this suite was authored and reviewed statically but NOT executed -
-- this environment has no local Postgres/Docker/pgTAP runtime (same
-- constraint noted throughout this repo's other pgTAP suites, see
-- docs/stage-2-5-concurrency-validation.md). Run with
-- `supabase test db --linked` (or an equivalent local Postgres) before
-- relying on it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(22);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
)
SELECT
  company_id, company_name, 'ativo', plan.id, false, false, 'pago', NULL, NULL
FROM (
  VALUES
    ('b6000000-0000-4000-8000-000000000001'::uuid, '__backup_coverage_a__'),
    ('b6000000-0000-4000-8000-000000000002'::uuid, '__backup_coverage_b__')
) AS fixture(company_id, company_name)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos WHERE periodicidade = 'vitalicio' AND ativo LIMIT 1
) AS plan;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b6100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'coverage-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Coverage Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b6100000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'coverage-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Coverage Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'b6000000-0000-4000-8000-000000000001'
WHERE user_id = 'b6100000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = 'b6000000-0000-4000-8000-000000000002'
WHERE user_id = 'b6100000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles WHERE user_id IN (
  'b6100000-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b6100000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b6100000-0000-4000-8000-000000000002', 'admin_empresa');

-- Company A: one pre-existing event (to be replaced by restore) plus
-- clientes/funcionarios/event_funcionarios/checklist/template/document rows
-- that already exist before any restore runs.
INSERT INTO public.events (id, date, status, name, artist, city, venue, created_by, empresa_id)
VALUES ('b6200000-0000-4000-8000-000000000001', '2026-08-01', 'confirmado', 'Old Event',
        'Artist', 'City', 'Venue', 'b6100000-0000-4000-8000-000000000001',
        'b6000000-0000-4000-8000-000000000001');

INSERT INTO public.clientes (id, empresa_id, nome, tipo_pessoa, created_by, updated_by)
VALUES
  ('b6300000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
   'Cliente Existente', 'fisica', 'b6100000-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000001'),
  ('b6300000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000001',
   'Cliente Ausente Do Backup', 'fisica', 'b6100000-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000001');

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES
  ('b6400000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'Funcionario Existente', 'Tecnico'),
  ('b6400000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000001', 'Funcionario Ausente Do Backup', 'Roadie');

INSERT INTO public.event_funcionarios (id, event_id, funcionario_id, empresa_id)
VALUES ('b6500000-0000-4000-8000-000000000001', 'b6200000-0000-4000-8000-000000000001',
        'b6400000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001');

INSERT INTO public.event_checklist_items (id, empresa_id, event_id, categoria, descricao)
VALUES ('b6600000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000001', 'som', 'Item antigo');

INSERT INTO public.document_templates (id, empresa_id, nome, tipo, conteudo)
VALUES ('b6700000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
        'Template Antigo', 'contrato', 'conteudo antigo');

INSERT INTO public.generated_documents (id, empresa_id, event_id, template_id, nome, tipo, conteudo_final)
VALUES ('b6800000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
        'b6200000-0000-4000-8000-000000000001', 'b6700000-0000-4000-8000-000000000001',
        'Documento Antigo', 'contrato', 'final antigo');

-- Company B: a client/funcionario that must never be touched by company A's restore.
INSERT INTO public.clientes (id, empresa_id, nome, tipo_pessoa, created_by, updated_by)
VALUES ('b6300000-0000-4000-8000-000000000099', 'b6000000-0000-4000-8000-000000000002',
        'Cliente B', 'fisica', 'b6100000-0000-4000-8000-000000000002', 'b6100000-0000-4000-8000-000000000002');
INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('b6400000-0000-4000-8000-000000000099', 'b6000000-0000-4000-8000-000000000002', 'Funcionario B', 'Tecnico');

-- Old-format payload: only the four collections the RPC has covered since
-- P0-5, none of the six new keys at all (mirrors a pre-1.1 export).
SELECT set_config(
  'test.legacy_payload',
  jsonb_build_object(
    'versao', '1.0',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b6000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T09:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', jsonb_build_array(
        (SELECT to_jsonb(e) || jsonb_build_object('id', 'b6200000-0000-4000-8000-000000000002', 'name', 'Legacy Restore')
         FROM public.events AS e WHERE id = 'b6200000-0000-4000-8000-000000000001')
      ),
      'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb,
      'financials', '[]'::jsonb
    )
  )::text,
  true
);

-- New-format payload: replaces the event and exercises all six new
-- collections, referencing one already-existing funcionario (not repeated
-- in the payload's own funcionarios array) to prove event_funcionarios
-- validates against the live table, not just the payload array.
SELECT set_config(
  'test.full_payload',
  jsonb_build_object(
    'versao', '1.1',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b6000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T09:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', jsonb_build_array(
        (SELECT to_jsonb(e) || jsonb_build_object('id', 'b6200000-0000-4000-8000-000000000003', 'name', 'New Event')
         FROM public.events AS e WHERE id = 'b6200000-0000-4000-8000-000000000001')
      ),
      'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb,
      'financials', '[]'::jsonb,
      'clientes', jsonb_build_array(
        (SELECT to_jsonb(c) || jsonb_build_object('nome', 'Cliente Atualizado')
         FROM public.clientes AS c WHERE id = 'b6300000-0000-4000-8000-000000000001'),
        (SELECT to_jsonb(c) || jsonb_build_object('id', 'b6300000-0000-4000-8000-000000000003', 'nome', 'Cliente Novo')
         FROM public.clientes AS c WHERE id = 'b6300000-0000-4000-8000-000000000001')
      ),
      'funcionarios', jsonb_build_array(
        (SELECT to_jsonb(f) || jsonb_build_object('id', 'b6400000-0000-4000-8000-000000000003', 'nome', 'Funcionario Novo')
         FROM public.funcionarios AS f WHERE id = 'b6400000-0000-4000-8000-000000000001')
      ),
      'event_funcionarios', jsonb_build_array(
        jsonb_build_object(
          'id', 'b6500000-0000-4000-8000-000000000002',
          'event_id', 'b6200000-0000-4000-8000-000000000003',
          -- References the pre-existing funcionario, deliberately absent
          -- from this payload's own 'funcionarios' array above.
          'funcionario_id', 'b6400000-0000-4000-8000-000000000001',
          'empresa_id', 'b6000000-0000-4000-8000-000000000001'
        )
      ),
      'event_checklist_items', jsonb_build_array(
        jsonb_build_object(
          'id', 'b6600000-0000-4000-8000-000000000002',
          'event_id', 'b6200000-0000-4000-8000-000000000003',
          'empresa_id', 'b6000000-0000-4000-8000-000000000001',
          'categoria', 'som', 'descricao', 'Item novo'
        )
      ),
      'document_templates', jsonb_build_array(
        (SELECT to_jsonb(t) || jsonb_build_object('id', 'b6700000-0000-4000-8000-000000000002', 'nome', 'Template Novo')
         FROM public.document_templates AS t WHERE id = 'b6700000-0000-4000-8000-000000000001')
      ),
      'generated_documents', jsonb_build_array(
        jsonb_build_object(
          'id', 'b6800000-0000-4000-8000-000000000002',
          'empresa_id', 'b6000000-0000-4000-8000-000000000001',
          'event_id', 'b6200000-0000-4000-8000-000000000003',
          'template_id', 'b6700000-0000-4000-8000-000000000002',
          'nome', 'Documento Novo', 'tipo', 'contrato', 'conteudo_final', 'final novo'
        )
      )
    )
  )::text,
  true
);

-- 1. A restore from an old-format (no new keys) payload leaves every 1.1
--    table completely untouched, even though the event it replaces owned
--    an event_funcionarios/checklist/document row.
SELECT set_config('request.jwt.claim.sub', 'b6100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b6000000-0000-4000-8000-000000000001', current_setting('test.legacy_payload')::jsonb
  )$test$,
  'a legacy-format restore succeeds'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.clientes WHERE empresa_id = 'b6000000-0000-4000-8000-000000000001'),
  2::bigint, 'legacy restore leaves both existing clientes in place');
SELECT is((SELECT count(*) FROM public.funcionarios WHERE empresa_id = 'b6000000-0000-4000-8000-000000000001'),
  2::bigint, 'legacy restore leaves both existing funcionarios in place');
-- The old event is deleted by the original (always-unconditional) events
-- step even for a legacy payload. event_funcionarios/event_checklist_items
-- both have ON DELETE CASCADE on event_id (confirmed against
-- 20260318145220 and 20260414115511), so they disappear with their event
-- via the database's own cascade - not because this migration's new,
-- payload-presence-gated DELETE statements ran (they did not, since the
-- legacy payload has no 'event_funcionarios'/'event_checklist_items' keys).
-- generated_documents.event_id is ON DELETE SET NULL instead (confirmed
-- against 20260317112245), so that row survives with event_id cleared
-- rather than being removed - a real difference in per-table FK behavior
-- this suite pins down explicitly rather than assuming.
SELECT is((SELECT count(*) FROM public.event_funcionarios WHERE id = 'b6500000-0000-4000-8000-000000000001'),
  0::bigint, 'legacy restore cascade-removes event_funcionarios via its deleted event, not via this migration''s new code');
SELECT is((SELECT count(*) FROM public.event_checklist_items WHERE id = 'b6600000-0000-4000-8000-000000000001'),
  0::bigint, 'legacy restore cascade-removes event_checklist_items via its deleted event, not via this migration''s new code');
SELECT is((SELECT event_id FROM public.generated_documents WHERE id = 'b6800000-0000-4000-8000-000000000001'),
  NULL, 'legacy restore preserves the old generated_document row but nulls its event_id (ON DELETE SET NULL, not CASCADE)');
SELECT is((SELECT count(*) FROM public.document_templates WHERE empresa_id = 'b6000000-0000-4000-8000-000000000001'),
  1::bigint, 'legacy restore never touches document_templates (not event-scoped, key entirely absent)');

-- 2. The full 1.1 payload: clientes/funcionarios are upserted (existing
--    updated in place, untouched one preserved, new one inserted); the four
--    leaf tables are fully replaced under the new event.
SELECT set_config('request.jwt.claim.sub', 'b6100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b6000000-0000-4000-8000-000000000001', current_setting('test.full_payload')::jsonb
  )$test$,
  'a full 1.1 payload restore succeeds'
);
RESET ROLE;

SELECT is((SELECT nome FROM public.clientes WHERE id = 'b6300000-0000-4000-8000-000000000001'),
  'Cliente Atualizado', 'clientes upsert updates an existing row in place');
SELECT is((SELECT count(*) FROM public.clientes WHERE id = 'b6300000-0000-4000-8000-000000000002'),
  1::bigint, 'clientes upsert never deletes a client absent from the payload');
SELECT is((SELECT nome FROM public.clientes WHERE id = 'b6300000-0000-4000-8000-000000000003'),
  'Cliente Novo', 'clientes upsert inserts a brand-new row');
SELECT is((SELECT count(*) FROM public.funcionarios WHERE id = 'b6400000-0000-4000-8000-000000000002'),
  1::bigint, 'funcionarios upsert never deletes an employee absent from the payload');
SELECT is((SELECT nome FROM public.funcionarios WHERE id = 'b6400000-0000-4000-8000-000000000003'),
  'Funcionario Novo', 'funcionarios upsert inserts a brand-new row');

SELECT is((SELECT funcionario_id FROM public.event_funcionarios WHERE id = 'b6500000-0000-4000-8000-000000000002'),
  'b6400000-0000-4000-8000-000000000001'::uuid,
  'event_funcionarios accepts a funcionario_id that exists live but is absent from this payload''s own funcionarios array');
SELECT is((SELECT descricao FROM public.event_checklist_items WHERE id = 'b6600000-0000-4000-8000-000000000002'),
  'Item novo', 'event_checklist_items is replaced under the new event');
SELECT is((SELECT count(*) FROM public.event_checklist_items WHERE id = 'b6600000-0000-4000-8000-000000000001'),
  0::bigint, 'the old event_checklist_item was removed with its event');
SELECT is((SELECT nome FROM public.document_templates WHERE id = 'b6700000-0000-4000-8000-000000000002'),
  'Template Novo', 'document_templates is fully replaced');
SELECT is((SELECT count(*) FROM public.document_templates WHERE id = 'b6700000-0000-4000-8000-000000000001'),
  0::bigint, 'the old document_template was removed');
SELECT is((SELECT template_id FROM public.generated_documents WHERE id = 'b6800000-0000-4000-8000-000000000002'),
  'b6700000-0000-4000-8000-000000000002'::uuid,
  'generated_documents is replaced and keeps its template relationship');

-- 3. Cross-tenant safety: company B was never touched by any of the above.
SELECT is((SELECT count(*) FROM public.clientes WHERE id = 'b6300000-0000-4000-8000-000000000099'),
  1::bigint, 'company B clientes is untouched by company A restores');
SELECT is((SELECT count(*) FROM public.funcionarios WHERE id = 'b6400000-0000-4000-8000-000000000099'),
  1::bigint, 'company B funcionarios is untouched by company A restores');

-- 4. event_funcionarios referencing a funcionario that exists in neither the
--    payload nor the live table for this company is rejected before any
--    destructive statement runs (reuses the full payload with the
--    reference swapped to an unrelated company B funcionario).
SELECT set_config('request.jwt.claim.sub', 'b6100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b6000000-0000-4000-8000-000000000001',
    jsonb_set(
      current_setting('test.full_payload')::jsonb,
      '{data,event_funcionarios,0,funcionario_id}',
      to_jsonb('b6400000-0000-4000-8000-000000000099'::text)
    )
  )$test$,
  'P0001',
  'Invalid backup payload: event_funcionarios references a funcionario that does not exist in this company',
  'event_funcionarios cannot reference another company''s funcionario'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
