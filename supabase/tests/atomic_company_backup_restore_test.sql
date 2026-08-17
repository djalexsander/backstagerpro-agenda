-- Regression coverage for P0-5. The restore RPC must either replace the
-- complete existing backup scope or leave it completely untouched.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(21);

-- Active lifetime tenants keep these fixtures independent from trial dates.
INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
)
SELECT
  company_id, company_name, 'ativo', plan.id, false, false, 'pago', NULL, NULL
FROM (
  VALUES
    ('b5000000-0000-4000-8000-000000000001'::uuid, '__backup_restore_a__'),
    ('b5000000-0000-4000-8000-000000000002'::uuid, '__backup_restore_b__')
) AS fixture(company_id, company_name)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos
  WHERE periodicidade = 'vitalicio' AND ativo
  LIMIT 1
) AS plan;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b5100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'backup-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Backup Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b5100000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'backup-user-a@example.test', '', now(),
   '{}', '{"full_name":"Backup User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b5100000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'backup-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Backup Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'b5000000-0000-4000-8000-000000000001'
WHERE user_id IN (
  'b5100000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000002'
);
UPDATE public.profiles SET empresa_id = 'b5000000-0000-4000-8000-000000000002'
WHERE user_id = 'b5100000-0000-4000-8000-000000000003';

DELETE FROM public.user_roles WHERE user_id IN (
  'b5100000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000002',
  'b5100000-0000-4000-8000-000000000003'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b5100000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b5100000-0000-4000-8000-000000000002', 'usuario'),
  ('b5100000-0000-4000-8000-000000000003', 'admin_empresa');

INSERT INTO public.events (
  id, date, status, name, artist, city, venue, created_by, empresa_id
) VALUES
  ('b5200000-0000-4000-8000-000000000001', '2026-08-01', 'confirmado',
   'Old A', 'Artist A', 'City A', 'Venue A',
   'b5100000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001'),
  ('b5200000-0000-4000-8000-000000000002', '2026-08-02', 'confirmado',
   'Protected B', 'Artist B', 'City B', 'Venue B',
   'b5100000-0000-4000-8000-000000000003', 'b5000000-0000-4000-8000-000000000002');

INSERT INTO public.event_days (
  id, event_id, day_number, date, artist, empresa_id
) VALUES
  ('b5300000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001',
   1, '2026-08-01', 'Artist A', 'b5000000-0000-4000-8000-000000000001'),
  ('b5300000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002',
   1, '2026-08-02', 'Artist B', 'b5000000-0000-4000-8000-000000000002');

INSERT INTO public.event_files (
  id, event_id, event_day_id, file_type, file_path, file_name, empresa_id
) VALUES
  ('b5400000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001',
   'b5300000-0000-4000-8000-000000000001', 'artist_rider', 'a/old.pdf', 'old.pdf',
   'b5000000-0000-4000-8000-000000000001'),
  ('b5400000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002',
   'b5300000-0000-4000-8000-000000000002', 'artist_rider', 'b/protected.pdf', 'protected.pdf',
   'b5000000-0000-4000-8000-000000000002');

INSERT INTO public.financials (id, event_id, cache, empresa_id) VALUES
  ('b5500000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 100,
   'b5000000-0000-4000-8000-000000000001'),
  ('b5500000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 200,
   'b5000000-0000-4000-8000-000000000002');

-- Build a schema-complete payload from real rows so this test follows future
-- nullable/default columns without hand-maintaining a parallel JSON schema.
SELECT set_config(
  'test.atomic_restore_payload',
  (
    SELECT jsonb_build_object(
      'versao', '1.0',
      'sistema', 'Backstage Pro',
      'meta', jsonb_build_object(
        'empresa_id', 'b5000000-0000-4000-8000-000000000001',
        'tipo', 'manual',
        'data_backup', '2026-08-17T12:00:00Z'
      ),
      'data', jsonb_build_object(
        'eventos', jsonb_build_array(
          (SELECT to_jsonb(event) || jsonb_build_object(
             'id', 'b5200000-0000-4000-8000-000000000003', 'name', 'Restored A'
           ) FROM public.events AS event
           WHERE id = 'b5200000-0000-4000-8000-000000000001')
        ),
        'event_days', jsonb_build_array(
          (SELECT to_jsonb(day) || jsonb_build_object(
             'id', 'b5300000-0000-4000-8000-000000000003',
             'event_id', 'b5200000-0000-4000-8000-000000000003'
           ) FROM public.event_days AS day
           WHERE id = 'b5300000-0000-4000-8000-000000000001')
        ),
        'event_files', jsonb_build_array(
          (SELECT to_jsonb(file) || jsonb_build_object(
             'id', 'b5400000-0000-4000-8000-000000000003',
             'event_id', 'b5200000-0000-4000-8000-000000000003',
             'event_day_id', 'b5300000-0000-4000-8000-000000000003',
             'file_path', 'a/restored.pdf', 'file_name', 'restored.pdf'
           ) FROM public.event_files AS file
           WHERE id = 'b5400000-0000-4000-8000-000000000001')
        ),
        'financials', jsonb_build_array(
          (SELECT to_jsonb(financial) || jsonb_build_object(
             'id', 'b5500000-0000-4000-8000-000000000003',
             'event_id', 'b5200000-0000-4000-8000-000000000003', 'cache', 999
           ) FROM public.financials AS financial
           WHERE id = 'b5500000-0000-4000-8000-000000000001')
        )
      )
    )::text
  ),
  true
);

SELECT set_config(
  'test.atomic_restore_conflict_payload',
  jsonb_set(
    jsonb_set(
      current_setting('test.atomic_restore_payload')::jsonb,
      '{data,event_days,0,id}',
      to_jsonb('b5300000-0000-4000-8000-000000000002'::text)
    ),
    '{data,event_files,0,event_day_id}',
    to_jsonb('b5300000-0000-4000-8000-000000000002'::text)
  )::text,
  true
);

SELECT ok(NOT has_function_privilege(
  'anon', 'public.restore_company_backup(uuid,jsonb)', 'EXECUTE'
), 'anon cannot execute the restore RPC');
SELECT ok(has_function_privilege(
  'authenticated', 'public.restore_company_backup(uuid,jsonb)', 'EXECUTE'
), 'authenticated can reach the restore RPC');
SELECT ok(NOT has_function_privilege(
  'service_role', 'public.restore_company_backup(uuid,jsonb)', 'EXECUTE'
), 'service_role has no unnecessary restore grant');

-- A common user reaches the authenticated facade but fails its own role check.
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b5000000-0000-4000-8000-000000000001',
    current_setting('test.atomic_restore_payload')::jsonb
  )$test$,
  'P0001', 'Actor is not an administrator of the active company',
  'a common user cannot restore a backup'
);
RESET ROLE;
SELECT is((SELECT name FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000001'),
  'Old A', 'unauthorized failure leaves old tenant data intact');

-- An administrator cannot select another tenant, even with an explicit UUID.
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b5000000-0000-4000-8000-000000000002',
    current_setting('test.atomic_restore_payload')::jsonb
  )$test$,
  '42501', 'Backup restore is restricted to the authenticated user company',
  'company A administrator cannot restore company B'
);
RESET ROLE;
SELECT is((SELECT name FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000002'),
  'Protected B', 'cross-tenant rejection leaves company B intact');

-- Structural validation happens before any destructive statement.
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b5000000-0000-4000-8000-000000000001',
    jsonb_set(current_setting('test.atomic_restore_payload')::jsonb,
      '{data,event_files}', '"invalid"'::jsonb)
  )$test$,
  'P0001', 'Invalid backup payload: all data collections must be arrays',
  'invalid payload is rejected before deletion'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.events WHERE empresa_id = 'b5000000-0000-4000-8000-000000000001'),
  1::bigint, 'invalid payload leaves the old event set intact');

-- This payload passes preflight validation, deletes A and inserts its event,
-- then collides with B's globally unique event_day id. The exception must roll
-- every earlier statement back.
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b5000000-0000-4000-8000-000000000001',
    current_setting('test.atomic_restore_conflict_payload')::jsonb
  )$test$,
  '23505', 'duplicate key value violates unique constraint "event_days_pkey"',
  'a failure after deletion and event insertion aborts the whole restore'
);
RESET ROLE;
SELECT is((SELECT name FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000001'),
  'Old A', 'rollback restores the old event after a mid-restore failure');
SELECT is((SELECT count(*) FROM public.event_days WHERE id = 'b5300000-0000-4000-8000-000000000001'),
  1::bigint, 'rollback preserves the old event day');
SELECT is((SELECT count(*) FROM public.event_files WHERE id = 'b5400000-0000-4000-8000-000000000001'),
  1::bigint, 'rollback preserves the old rider metadata');
SELECT is((SELECT count(*) FROM public.financials WHERE id = 'b5500000-0000-4000-8000-000000000001'),
  1::bigint, 'rollback preserves the old financial row');

-- A valid restore replaces exactly the four existing backup collections.
SELECT set_config('request.jwt.claim.sub', 'b5100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b5000000-0000-4000-8000-000000000001',
    current_setting('test.atomic_restore_payload')::jsonb
  )$test$,
  'a complete valid restore succeeds'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000001'),
  0::bigint, 'valid restore removes the previous event set');
SELECT is((SELECT name FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000003'),
  'Restored A', 'valid restore inserts the expected event');
SELECT is((SELECT count(*) FROM public.event_days WHERE event_id = 'b5200000-0000-4000-8000-000000000003'),
  1::bigint, 'valid restore inserts the expected event day');
SELECT is((SELECT count(*) FROM public.financials WHERE event_id = 'b5200000-0000-4000-8000-000000000003' AND cache = 999),
  1::bigint, 'valid restore inserts the expected financial row');
SELECT is((SELECT event_day_id FROM public.event_files WHERE id = 'b5400000-0000-4000-8000-000000000003'),
  'b5300000-0000-4000-8000-000000000003'::uuid,
  'restored rider remains linked to its restored event day');
SELECT is((SELECT name FROM public.events WHERE id = 'b5200000-0000-4000-8000-000000000002'),
  'Protected B', 'successful company A restore never changes company B');

SELECT * FROM finish();
ROLLBACK;
