-- Regression coverage for P1-10C (20260818150000_extend_backup_rfid_labels_printing.sql),
-- which extends restore_company_backup and gather_company_backup_data to
-- cover RFID (rfid_tags, rfid_read_sessions), etiquetas/impressão
-- (etiqueta_modelos, etiqueta_impressoes, etiqueta_solicitacoes,
-- etiqueta_solicitacao_itens) and the company's shared printer/bobina
-- configuration (empresa_bobina_perfis, empresa_impressora_config).
-- Coverage for every table already handled by P1-10/P1-10B is not
-- duplicated here.
--
-- Scenario 10 from the request ("override local de terminal não é tratado
-- pelo backup") has no assertion here on purpose: local per-terminal
-- printer preferences live in the browser's localStorage / desktop config
-- file, not in any database table, so there is nothing for a SQL suite to
-- exercise. It is verified by construction: gather_company_backup_data and
-- restore_company_backup only ever read/write empresa_bobina_perfis and
-- empresa_impressora_config (both company-shared, empresa_id-scoped
-- tables) - see the migration's own header comment.
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

SELECT plan(20);

-- Non-lifetime plan: company_has_lifetime_subscription must be false for
-- company A, or deactivating rfid_materiais below would not actually
-- change anything (same reasoning as gather_company_backup_data_test.sql).
INSERT INTO public.planos (id, nome, valor, periodicidade, ativo)
VALUES ('b9100000-0000-4000-8000-000000000001', '__rfid_labels_printing_test_plan__', 99, 'mensal', true);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
) VALUES
  ('b9000000-0000-4000-8000-000000000001', '__rfid_labels_printing_a__',
   'ativo', 'b9100000-0000-4000-8000-000000000001', false, false, 'pago', NULL, NULL),
  ('b9000000-0000-4000-8000-000000000002', '__rfid_labels_printing_b__',
   'ativo', 'b9100000-0000-4000-8000-000000000001', false, false, 'pago', NULL, NULL);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b9200000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'rfid-labels-admin-a@example.test', '', now(),
   '{}', '{"full_name":"RFID Labels Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b9200000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'rfid-labels-admin-b@example.test', '', now(),
   '{}', '{"full_name":"RFID Labels Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'b9000000-0000-4000-8000-000000000001'
WHERE user_id = 'b9200000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = 'b9000000-0000-4000-8000-000000000002'
WHERE user_id = 'b9200000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles WHERE user_id IN (
  'b9200000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b9200000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b9200000-0000-4000-8000-000000000002', 'admin_empresa');

-- rfid_materiais active for company A, so the first (module-active) restore
-- below is not the interesting case - scenario 11 deactivates it later.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at)
SELECT 'b9000000-0000-4000-8000-000000000001', catalog.id, 'active', now()
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'rfid_materiais';

-- ---------------------------------------------------------------------
-- Fixtures: one individual-control material for company A (required by
-- prepare_rfid_tag_write - only tipo_controle='individual' can receive an
-- RFID tag), one for company B (cross-tenant proof), and one pre-existing
-- LIVE rfid_tags row already deactivated (scenario 2).
-- ---------------------------------------------------------------------
INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('b9300000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001', 'Categoria RFID A');
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional
) VALUES (
  'b9400000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001',
  'b9300000-0000-4000-8000-000000000001', 'RFID-001', 'Material Individual A', 'individual', 'disponivel'
);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('b9300000-0000-4000-8000-000000000099', 'b9000000-0000-4000-8000-000000000002', 'Categoria RFID B');
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional
) VALUES (
  'b9400000-0000-4000-8000-000000000099', 'b9000000-0000-4000-8000-000000000002',
  'b9300000-0000-4000-8000-000000000099', 'RFID-B01', 'Material Individual B', 'individual', 'disponivel'
);

-- Pre-existing, already-deactivated tag (id b95...01). desativada_shape
-- only requires desativada_em IS NOT NULL when status <> 'ativa'.
INSERT INTO public.rfid_tags (
  id, empresa_id, material_id, epc, status, desativada_em, motivo_desativacao
) VALUES (
  'b9500000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001',
  'b9400000-0000-4000-8000-000000000001', 'AAAA1111', 'perdida', now() - interval '2 days', 'Perdida em evento'
);

-- ---------------------------------------------------------------------
-- Full-stack P1-10C payload for company A: a NEW active tag on a
-- different material would collide with the individual-material
-- constraint, so this payload reuses the SAME already-deactivated tag id
-- but with status 'ativa' - simulating an OLDER backup taken before the
-- live deactivation above happened. This is the scenario-2 case. A
-- second, brand-new tag id is not needed since rfid_tags_material_ativa_uidx
-- allows only one active tag per material anyway, and this payload's
-- purpose is specifically to prove the reactivation guard.
-- ---------------------------------------------------------------------
SELECT set_config(
  'test.full_payload',
  jsonb_build_object(
    'versao', '1.3',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b9000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T16:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', '[]'::jsonb, 'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb, 'financials', '[]'::jsonb,
      'rfid_tags', jsonb_build_array(
        -- The already-deactivated tag, replayed as if the backup had been
        -- taken while it was still active (scenario 2: must NOT reactivate).
        jsonb_build_object(
          'id', 'b9500000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'material_id', 'b9400000-0000-4000-8000-000000000001',
          'epc', 'AAAA1111', 'status', 'ativa'
        ),
        -- A brand-new tag (no live row yet) restored as active - scenario 1,
        -- distinct from scenario 2 above. Legal because the material
        -- currently has zero active tags (the row above stays 'perdida'),
        -- so rfid_tags_material_ativa_uidx is not violated.
        jsonb_build_object(
          'id', 'b9500000-0000-4000-8000-000000000002',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'material_id', 'b9400000-0000-4000-8000-000000000001',
          'epc', 'BBBB2222', 'status', 'ativa'
        )
      ),
      'rfid_read_sessions', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9600000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'tipo', 'inventario',
          'responsavel_user_id', 'b9200000-0000-4000-8000-000000000001'
        )
      ),
      'etiqueta_modelos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9700000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'nome', 'Modelo Padrão A', 'largura_mm', 60, 'altura_mm', 40
        )
      ),
      'etiqueta_impressoes', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9800000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'modelo_id', 'b9700000-0000-4000-8000-000000000001',
          'material_id', 'b9400000-0000-4000-8000-000000000001',
          'quantidade', 2, 'modelo_snapshot', jsonb_build_object('nome', 'Modelo Padrão A'),
          'material_snapshot', jsonb_build_object('nome', 'Material Individual A'),
          'solicitada_por', 'b9200000-0000-4000-8000-000000000001',
          'solicitante_nome', 'Admin A', 'client_uuid', 'b9800000-0000-4000-8000-0000000000c1',
          'payload_hash', repeat('a', 64)
        )
      ),
      'etiqueta_solicitacoes', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9900000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'modelo_id', 'b9700000-0000-4000-8000-000000000001',
          'modelo_snapshot', jsonb_build_object('nome', 'Modelo Padrão A'),
          'quantidade_materiais', 1, 'quantidade_etiquetas', 2,
          'solicitada_por', 'b9200000-0000-4000-8000-000000000001',
          'solicitante_nome', 'Admin A', 'client_uuid', 'b9900000-0000-4000-8000-0000000000c2',
          'payload_hash', repeat('b', 64)
        )
      ),
      'etiqueta_solicitacao_itens', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9a00000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'solicitacao_id', 'b9900000-0000-4000-8000-000000000001',
          'material_id', 'b9400000-0000-4000-8000-000000000001',
          'ordem', 1, 'quantidade', 2,
          'material_snapshot', jsonb_build_object('nome', 'Material Individual A')
        )
      ),
      'empresa_bobina_perfis', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9b00000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'nome', 'Perfil Padrão A', 'largura_etiqueta_mm', 60, 'altura_etiqueta_mm', 40
        )
      ),
      'empresa_impressora_config', jsonb_build_array(
        jsonb_build_object(
          'id', 'b9c00000-0000-4000-8000-000000000001',
          'empresa_id', 'b9000000-0000-4000-8000-000000000001',
          'finalidade', 'etiqueta',
          'perfil_bobina_padrao_id', 'b9b00000-0000-4000-8000-000000000001'
        )
      )
    )
  )::text,
  true
);

-- 1. The full payload restores cleanly with rfid_materiais still active.
SELECT set_config('request.jwt.claim.sub', 'b9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b9000000-0000-4000-8000-000000000001', current_setting('test.full_payload')::jsonb
  )$test$,
  'the full RFID/labels/printing payload restores without error'
);
RESET ROLE;

-- 2. rfid_tags: the already-deactivated tag was NOT reactivated - status
--    stays whatever the live deactivation set it to (scenario 2, the core
--    rule this migration protects).
SELECT is((SELECT status::text FROM public.rfid_tags WHERE id = 'b9500000-0000-4000-8000-000000000001'),
  'perdida', 'a historically-deactivated rfid tag is never reactivated by a restore, even when the backup says ativa');

-- 3. Its EPC is unchanged (immutability preserved).
SELECT is((SELECT epc FROM public.rfid_tags WHERE id = 'b9500000-0000-4000-8000-000000000001'),
  'AAAA1111', 'rfid_tags preserves the exact EPC');

-- 3b. A brand-new active tag (no prior live row) restores normally as
--    'ativa' - scenario 1, distinct from the reactivation guard above.
SELECT is((SELECT status::text FROM public.rfid_tags WHERE id = 'b9500000-0000-4000-8000-000000000002'),
  'ativa', 'a brand-new rfid tag restores with its backed-up active status');

-- 4. rfid_read_sessions restores.
SELECT is((SELECT tipo::text FROM public.rfid_read_sessions WHERE id = 'b9600000-0000-4000-8000-000000000001'),
  'inventario', 'rfid_read_sessions restores the session');

-- 5. etiqueta_modelos restores.
SELECT is((SELECT nome FROM public.etiqueta_modelos WHERE id = 'b9700000-0000-4000-8000-000000000001'),
  'Modelo Padrão A', 'etiqueta_modelos restores the model');

-- 6. etiqueta_impressoes (print history) restores.
SELECT is((SELECT quantidade FROM public.etiqueta_impressoes WHERE id = 'b9800000-0000-4000-8000-000000000001'),
  2, 'etiqueta_impressoes restores the print-history row');

-- 7-8. etiqueta_solicitacoes + etiqueta_solicitacao_itens (the batch pair,
--    satisfying the deferred completeness constraint together) restore.
SELECT is((SELECT quantidade_etiquetas FROM public.etiqueta_solicitacoes WHERE id = 'b9900000-0000-4000-8000-000000000001'),
  2, 'etiqueta_solicitacoes restores the batch request');
SELECT is((SELECT quantidade FROM public.etiqueta_solicitacao_itens WHERE id = 'b9a00000-0000-4000-8000-000000000001'),
  2, 'etiqueta_solicitacao_itens restores the batch item');

-- 9. empresa_bobina_perfis restores.
SELECT is((SELECT nome FROM public.empresa_bobina_perfis WHERE id = 'b9b00000-0000-4000-8000-000000000001'),
  'Perfil Padrão A', 'empresa_bobina_perfis restores the shared bobina profile');

-- 10. empresa_impressora_config restores, keeping its link to the bobina
--     profile (both restored in the same transaction, in the correct order).
SELECT is((SELECT perfil_bobina_padrao_id FROM public.empresa_impressora_config WHERE id = 'b9c00000-0000-4000-8000-000000000001'),
  'b9b00000-0000-4000-8000-000000000001'::uuid,
  'empresa_impressora_config restores the shared printer config and its bobina link');

-- 11. Idempotent re-restore: running the identical payload again succeeds
--     and does not duplicate the append-only collections.
SELECT set_config('request.jwt.claim.sub', 'b9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b9000000-0000-4000-8000-000000000001', current_setting('test.full_payload')::jsonb
  )$test$,
  're-running the identical RFID/labels/printing payload is idempotent'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.rfid_read_sessions WHERE id = 'b9600000-0000-4000-8000-000000000001'),
  1::bigint, 'rfid_read_sessions is not duplicated by a second identical restore'
);
SELECT is(
  (SELECT count(*) FROM public.etiqueta_impressoes WHERE id = 'b9800000-0000-4000-8000-000000000001'),
  1::bigint, 'etiqueta_impressoes (print history) is not duplicated by a second identical restore'
);

-- 12. Cross-tenant safety: a payload whose rfid_tags references a
--     material_id belonging to a different company is rejected.
SELECT set_config('request.jwt.claim.sub', 'b9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b9000000-0000-4000-8000-000000000001',
    jsonb_set(
      current_setting('test.full_payload')::jsonb,
      '{data,rfid_tags,0,material_id}',
      to_jsonb('b9400000-0000-4000-8000-000000000099'::text)
    )
  )$test$,
  'P0001',
  'Invalid backup payload: rfid_tags references a material that does not exist in this company',
  'rfid_tags cannot reference another company''s material'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.materiais WHERE id = 'b9400000-0000-4000-8000-000000000099'),
  1::bigint, 'company B material is untouched by any of company A''s restores');

-- 13. Backward compatibility: a payload with none of the eight P1-10C keys
--     (mirrors a pre-1.3 export) leaves every one of them untouched.
SELECT set_config(
  'test.legacy_payload',
  jsonb_build_object(
    'versao', '1.2',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b9000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T17:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', '[]'::jsonb, 'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb, 'financials', '[]'::jsonb
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'b9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b9000000-0000-4000-8000-000000000001', current_setting('test.legacy_payload')::jsonb
  )$test$,
  'a payload with none of the P1-10C keys still restores successfully'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.rfid_tags WHERE empresa_id = 'b9000000-0000-4000-8000-000000000001'),
  -- Two rows by this point: the originally-deactivated tag (b9500...01,
  -- still 'perdida') and the brand-new active tag from scenario 1
  -- (b9500...02). A legacy-shaped restore must leave both exactly as they are.
  2::bigint, 'a legacy-shaped restore leaves rfid_tags untouched (no accidental wipe of an absent collection)'
);
SELECT is(
  (SELECT count(*) FROM public.empresa_impressora_config WHERE empresa_id = 'b9000000-0000-4000-8000-000000000001'),
  1::bigint, 'a legacy-shaped restore leaves empresa_impressora_config untouched'
);

-- 14-15. Module deactivated does not block historical export: deactivate
--     rfid_materiais, confirm normal RLS now blocks a direct read (proving
--     nothing was loosened), then confirm gather_company_backup_data still
--     returns the company's RFID history.
UPDATE public.empresa_modules AS em
SET status = 'cancelled'
FROM public.module_catalog AS catalog
WHERE em.empresa_id = 'b9000000-0000-4000-8000-000000000001'
  AND em.module_id = catalog.id
  AND catalog.feature_key = 'rfid_materiais';

SELECT set_config('request.jwt.claim.sub', 'b9200000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  -- Two rows by this point (see the legacy-restore assertion above for why).
  (SELECT jsonb_array_length(public.gather_company_backup_data('b9000000-0000-4000-8000-000000000001') -> 'rfid_tags')),
  2, 'gather_company_backup_data still exports the company''s rfid_tags after rfid_materiais is deactivated'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
