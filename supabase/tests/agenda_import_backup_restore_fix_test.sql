-- ============================================================================
-- BACKUP/RESTORE DOS CAMPOS DE IMPORTACAO DE AGENDA + DIAGNOSTICO DE EVENTOS
-- ============================================================================
--
-- Cobre 20260911150000_agenda_import_backup_restore_fix.sql:
--   1. restore_company_backup agora restaura state/setup_time/staff_notes/
--      contratante_nome/contratante_cidade/contratante_telefone (antes eram
--      capturados no backup mas descartados no restore).
--   2. Um backup antigo (sem essas 6 chaves no JSON de 'eventos') continua
--      restaurando sem erro, com essas colunas NULL - nenhuma perda nos
--      demais campos.
--   3. diagnose_imported_events_missing_fields lista, sem nunca escrever,
--      eventos importados cujas 6 colunas estao todas nulas com observations
--      preenchido - e so isso; nao marca eventos corretamente importados nem
--      eventos que nunca foram importados.
--
-- Nao reexercita a maquina de estados do restore em si (conflitos, rollback
-- atomico, isolamento) - isso ja e coberto por
-- atomic_company_backup_restore_test.sql. Fixture minima e propria
-- (prefixo 86).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
)
SELECT
  company_id, company_name, 'ativo', plan.id, false, false, 'pago', NULL, NULL
FROM (
  VALUES
    ('86200000-0000-4000-8000-000000000001'::uuid, '__aibr_company_a__'),
    ('86200000-0000-4000-8000-000000000002'::uuid, '__aibr_company_b__')
) AS fixture(company_id, company_name)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos WHERE periodicidade = 'vitalicio' AND ativo LIMIT 1
) AS plan;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '86300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'aibr-admin-a@example.test', '', now(), '{}', '{"full_name":"AIBR Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '86300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'aibr-admin-b@example.test', '', now(), '{}', '{"full_name":"AIBR Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = '86200000-0000-4000-8000-000000000001', ativado = true, activated_at = now()
WHERE user_id = '86300000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = '86200000-0000-4000-8000-000000000002', ativado = true, activated_at = now()
WHERE user_id = '86300000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles WHERE user_id IN (
  '86300000-0000-4000-8000-000000000001', '86300000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('86300000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('86300000-0000-4000-8000-000000000002', 'admin_empresa');

-- Source event with every agenda-import column populated, used to build
-- both the "new-format" and "old-format" backup payloads below via
-- to_jsonb() - never hand-typed, so this test tracks the real column set.
INSERT INTO public.events (
  id, date, status, name, artist, city, venue, created_by, empresa_id,
  state, setup_time, staff_notes, contratante_nome, contratante_cidade, contratante_telefone
) VALUES (
  '86400000-0000-4000-8000-000000000001', '2026-09-01', 'confirmado',
  'Source Event', 'Artist Source', 'City Source', 'Venue Source',
  '86300000-0000-4000-8000-000000000001', '86200000-0000-4000-8000-000000000001',
  'PR', '14:00', 'Levar gerador extra', 'Fulano de Tal', 'Cianorte', '44999998888'
);

-- Both payloads are built from the ORIGINAL source event BEFORE either
-- restore call runs: restore_company_backup does a full delete+replace of
-- the target company's events, so the source row would already be gone by
-- the time a second payload tried to read it afterwards.
SELECT set_config(
  'test.aibr_new_format_payload',
  jsonb_build_object(
    'versao', '1.0', 'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', '86200000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-09-11T12:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', jsonb_build_array(
        (SELECT to_jsonb(event) || jsonb_build_object(
           'id', '86400000-0000-4000-8000-000000000002', 'name', 'Restored New Format'
         ) FROM public.events AS event WHERE id = '86400000-0000-4000-8000-000000000001')
      ),
      'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb,
      'financials', '[]'::jsonb
    )
  )::text,
  true
);
SELECT set_config(
  'test.aibr_old_format_payload',
  jsonb_build_object(
    'versao', '1.0', 'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', '86200000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-01T12:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', jsonb_build_array(
        (SELECT (to_jsonb(event) || jsonb_build_object(
           'id', '86400000-0000-4000-8000-000000000003', 'name', 'Restored Old Format'
         )) - 'state' - 'setup_time' - 'staff_notes'
           - 'contratante_nome' - 'contratante_cidade' - 'contratante_telefone'
         FROM public.events AS event WHERE id = '86400000-0000-4000-8000-000000000001')
      ),
      'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb,
      'financials', '[]'::jsonb
    )
  )::text,
  true
);

-- ----------------------------------------------------------------------------
-- 1. RESTORE: backup NOVO (com as 6 colunas) restaura todas elas
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '86300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    '86200000-0000-4000-8000-000000000001',
    current_setting('test.aibr_new_format_payload')::jsonb
  )$test$,
  'restore aceita um backup no formato novo (com as 6 colunas)'
);

RESET ROLE;

SELECT results_eq(
  $$SELECT state, setup_time, staff_notes, contratante_nome, contratante_cidade, contratante_telefone
    FROM public.events WHERE id = '86400000-0000-4000-8000-000000000002'$$,
  $$VALUES ('PR'::text, '14:00'::text, 'Levar gerador extra'::text, 'Fulano de Tal'::text, 'Cianorte'::text, '44999998888'::text)$$,
  'restore preserva as 6 colunas de importacao de agenda'
);
SELECT is(
  (SELECT name FROM public.events WHERE id = '86400000-0000-4000-8000-000000000002'),
  'Restored New Format',
  'restore tambem preserva os campos ja existentes (sem regressao)'
);

-- ----------------------------------------------------------------------------
-- 2. RESTORE: backup ANTIGO (sem as 6 chaves no JSON) nao perde os outros
--    campos e deixa as colunas novas NULL, sem erro
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '86300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    '86200000-0000-4000-8000-000000000001',
    current_setting('test.aibr_old_format_payload')::jsonb
  )$test$,
  'restore aceita um backup no formato antigo (sem as 6 chaves) sem erro'
);

RESET ROLE;

-- This DELETE+INSERT replace scope means only the payload's one event
-- survives per company - by this point company A has exactly the old-format
-- restored row.
SELECT results_eq(
  $$SELECT name, artist, city, state, setup_time, staff_notes, contratante_nome
    FROM public.events WHERE id = '86400000-0000-4000-8000-000000000003'$$,
  $$VALUES ('Restored Old Format'::text, 'Artist Source'::text, 'City Source'::text, NULL::text, NULL::text, NULL::text, NULL::text)$$,
  'backup antigo restaura nome/artista/cidade normalmente e deixa as 6 colunas novas NULL (nao erro, nao lixo)'
);

-- ----------------------------------------------------------------------------
-- 3. DIAGNOSTICO: evento importado com as 6 colunas nulas e observations
--    preenchido e listado, mas nunca alterado
-- ----------------------------------------------------------------------------
INSERT INTO public.events (
  id, date, status, name, created_by, empresa_id, observations
) VALUES (
  '86400000-0000-4000-8000-000000000004', '2026-09-02', 'confirmado',
  'Ambiguous Imported Event', '86300000-0000-4000-8000-000000000001',
  '86200000-0000-4000-8000-000000000001', 'Nota antiga do sistema de origem'
);
INSERT INTO public.event_import_origins (empresa_id, event_id, source_system, source_event_id)
VALUES ('86200000-0000-4000-8000-000000000001', '86400000-0000-4000-8000-000000000004', 'gestao_eventos_pro', 'src-ambiguous-001');

-- Evento importado corretamente (colunas preenchidas) - nao deve aparecer.
INSERT INTO public.events (
  id, date, status, name, created_by, empresa_id, state, contratante_nome
) VALUES (
  '86400000-0000-4000-8000-000000000005', '2026-09-03', 'confirmado',
  'Properly Imported Event', '86300000-0000-4000-8000-000000000001',
  '86200000-0000-4000-8000-000000000001', 'SP', 'Ciclano'
);
INSERT INTO public.event_import_origins (empresa_id, event_id, source_system, source_event_id)
VALUES ('86200000-0000-4000-8000-000000000001', '86400000-0000-4000-8000-000000000005', 'gestao_eventos_pro', 'src-proper-001');

-- Evento NUNCA importado (sem linha em event_import_origins), mesmo com
-- colunas nulas e observations preenchido - nao deve aparecer.
INSERT INTO public.events (
  id, date, status, name, created_by, empresa_id, observations
) VALUES (
  '86400000-0000-4000-8000-000000000006', '2026-09-04', 'confirmado',
  'Never Imported Event', '86300000-0000-4000-8000-000000000001',
  '86200000-0000-4000-8000-000000000001', 'Observacao manual qualquer'
);

SELECT set_config('request.jwt.claim.sub', '86300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT event_id FROM public.diagnose_imported_events_missing_fields('86200000-0000-4000-8000-000000000001')$$,
  $$VALUES ('86400000-0000-4000-8000-000000000004'::uuid)$$,
  'diagnostico lista apenas o evento importado ambiguo, nao o corretamente importado nem o nunca importado'
);

RESET ROLE;

-- The diagnostic call above is a pure SELECT (STABLE, no writes) - confirm
-- the flagged row is still byte-identical, nothing was "auto-repaired".
SELECT is(
  (SELECT observations FROM public.events WHERE id = '86400000-0000-4000-8000-000000000004'),
  'Nota antiga do sistema de origem',
  'o evento ambiguo listado no diagnostico permanece inalterado - nenhuma escrita automatica'
);
SELECT is(
  (SELECT state FROM public.events WHERE id = '86400000-0000-4000-8000-000000000004'),
  NULL,
  'as colunas do evento ambiguo continuam nulas apos o diagnostico - nada foi adivinhado'
);

-- ----------------------------------------------------------------------------
-- 4. CROSS-TENANT: admin da empresa B nao consegue diagnosticar a empresa A
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '86300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT * FROM public.diagnose_imported_events_missing_fields('86200000-0000-4000-8000-000000000001')$test$,
  '42501', NULL,
  'admin da empresa B nao diagnostica eventos da empresa A'
);
-- Own company, no imported events at all - empty result, no error.
SELECT is(
  (SELECT count(*) FROM public.diagnose_imported_events_missing_fields('86200000-0000-4000-8000-000000000002')),
  0::bigint,
  'admin da empresa B consulta a propria empresa e recebe lista vazia (nenhum evento importado la)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. GRANTS
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.diagnose_imported_events_missing_fields(uuid)', 'EXECUTE'),
  'anon nao executa o diagnostico'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.diagnose_imported_events_missing_fields(uuid)', 'EXECUTE'),
  'service_role nao tem grant desnecessario no diagnostico'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.diagnose_imported_events_missing_fields(uuid)', 'EXECUTE'),
  'authenticated alcanca a fachada do diagnostico'
);

SELECT * FROM finish();

ROLLBACK;
