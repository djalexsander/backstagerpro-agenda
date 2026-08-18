-- Regression coverage for P1-10B (20260818120000_extend_operational_core_backup.sql),
-- which extends restore_company_backup (P0-5, then P1-10 in
-- 20260818090000) to also cover the operational core: categorias_materiais,
-- materiais, estoque_localizacoes, estoque_saldos, estoque_movimentacoes,
-- material_custodias, material_custodia_eventos, material_locacoes,
-- material_locacao_itens, material_locacao_eventos, manutencao_ordens,
-- manutencao_ordem_insumos, manutencao_ordem_eventos,
-- financeiro_lancamentos, financeiro_parcelas, financeiro_recebimentos.
-- Coverage for the original four collections and the six P1-10 collections
-- is not duplicated here - see atomic_company_backup_restore_test.sql and
-- extend_company_backup_coverage_test.sql.
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

SELECT plan(38);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento, trial_expires_at
)
SELECT
  company_id, company_name, 'ativo', plan.id, false, false, 'pago', NULL, NULL
FROM (
  VALUES
    ('b7000000-0000-4000-8000-000000000001'::uuid, '__op_core_backup_a__'),
    ('b7000000-0000-4000-8000-000000000002'::uuid, '__op_core_backup_b__')
) AS fixture(company_id, company_name)
CROSS JOIN LATERAL (
  SELECT id FROM public.planos WHERE periodicidade = 'vitalicio' AND ativo LIMIT 1
) AS plan;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'b7100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'op-core-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Op Core Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b7100000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'op-core-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Op Core Admin B"}', now(), now());

UPDATE public.profiles SET empresa_id = 'b7000000-0000-4000-8000-000000000001'
WHERE user_id = 'b7100000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = 'b7000000-0000-4000-8000-000000000002'
WHERE user_id = 'b7100000-0000-4000-8000-000000000002';

DELETE FROM public.user_roles WHERE user_id IN (
  'b7100000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000002'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b7100000-0000-4000-8000-000000000001', 'admin_empresa'),
  ('b7100000-0000-4000-8000-000000000002', 'admin_empresa');

-- ---------------------------------------------------------------------
-- Company A pre-existing (live, not part of any restore payload below) -
-- one row per forced-upsert table, to prove a restore never deletes
-- company data the backup does not mention.
-- ---------------------------------------------------------------------
INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('b7300000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'Categoria Antiga');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional
) VALUES (
  'b7400000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000001', 'OLD-001', 'Material Ausente Do Backup', 'quantidade', 'disponivel'
);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES ('b7500000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'OLD-LOC', 'Localizacao Antiga');

INSERT INTO public.clientes (id, empresa_id, nome, tipo_pessoa, created_by, updated_by)
VALUES ('b7600000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        'Cliente Op Core', 'fisica', 'b7100000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001');

INSERT INTO public.material_locacoes (
  id, empresa_id, cliente_id, numero, responsavel_nome, responsavel_tipo, responsavel_usuario_id,
  retirada_prevista_em, devolucao_prevista_em, client_uuid, payload_hash, created_by, updated_by
) VALUES (
  'b7700000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
  'b7600000-0000-4000-8000-000000000001', 'LOC-OLD-000001', 'Fulano', 'usuario',
  'b7100000-0000-4000-8000-000000000001',
  '2026-01-01', '2026-01-05', 'b7700000-0000-4000-8000-000000000091', 'hash-old-loc',
  'b7100000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001'
);
INSERT INTO public.material_locacao_itens (id, empresa_id, locacao_id, material_id, quantidade_contratada)
VALUES ('b7800000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        'b7700000-0000-4000-8000-000000000001', 'b7400000-0000-4000-8000-000000000001', 2);

INSERT INTO public.manutencao_ordens (
  id, empresa_id, material_id, numero, tipo, defeito_relatado, tipo_controle,
  quantidade_afetada, client_uuid, payload_hash, created_by, updated_by
) VALUES (
  'b7900000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
  'b7400000-0000-4000-8000-000000000001', 'MAN-OLD-000001', 'corretiva', 'Defeito antigo', 'quantidade',
  1, 'b7900000-0000-4000-8000-000000000091', 'hash-old-ordem',
  'b7100000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001'
);

INSERT INTO public.financeiro_lancamentos (id, empresa_id, origem_tipo, origem_id, valor_original)
VALUES ('b7a00000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        'locacao_material', 'b7700000-0000-4000-8000-000000000001', 50);

-- Company B: one material that must never be touched by company A's restore,
-- and is also used to prove cross-tenant references are rejected.
INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('b7300000-0000-4000-8000-000000000099', 'b7000000-0000-4000-8000-000000000002', 'Categoria B');
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional
) VALUES (
  'b7400000-0000-4000-8000-000000000099', 'b7000000-0000-4000-8000-000000000002',
  'b7300000-0000-4000-8000-000000000099', 'B-001', 'Material B', 'quantidade', 'disponivel'
);

-- ---------------------------------------------------------------------
-- Full-stack payload: one self-consistent chain through all sixteen
-- tables for company A. The new material is deliberately given a fixed
-- identificador_unico and a non-'disponivel' status_operacional - both
-- would be rejected/overwritten by prepare_material_write without the new
-- backstage.materials_restore_write bypass. The new manutencao_ordens row
-- is 'aberta' (active) for the SAME material the new custódia checks out -
-- proving the custódia-before-manutenção insert order keeps
-- block_custody_when_maintenance_active from rejecting a historically
-- valid combination. estoque_localizacoes lists the CHILD before the
-- PARENT on purpose, to prove the topological (BFS) insert order is
-- computed rather than assumed from array order.
-- ---------------------------------------------------------------------
SELECT set_config(
  'test.full_payload',
  jsonb_build_object(
    'versao', '1.2',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b7000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T12:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', '[]'::jsonb, 'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb, 'financials', '[]'::jsonb,
      'categorias_materiais', jsonb_build_array(
        (SELECT to_jsonb(c) || jsonb_build_object('nome', 'Categoria Atualizada')
         FROM public.categorias_materiais AS c WHERE id = 'b7300000-0000-4000-8000-000000000001')
      ),
      'materiais', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7400000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'categoria_id', 'b7300000-0000-4000-8000-000000000001',
          'codigo_interno', 'NEW-001', 'nome', 'Material Novo', 'tipo_controle', 'quantidade',
          'identificador_unico', 'b7400000-0000-4000-8000-0000000000aa',
          'status_operacional', 'em_manutencao', 'justificativa_status', 'Em conserto no momento do backup'
        )
      ),
      'estoque_localizacoes', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7500000-0000-4000-8000-000000000003',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'localizacao_pai_id', 'b7500000-0000-4000-8000-000000000002',
          'codigo', 'NEW-LOC-CHILD', 'nome', 'Prateleira Nova'
        ),
        jsonb_build_object(
          'id', 'b7500000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'localizacao_pai_id', NULL,
          'codigo', 'NEW-LOC-ROOT', 'nome', 'Almoxarifado Novo'
        )
      ),
      'estoque_saldos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7550000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'localizacao_id', 'b7500000-0000-4000-8000-000000000003',
          'quantidade', 3
        )
      ),
      'estoque_movimentacoes', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7600000-0000-4000-8000-0000000000b1',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'tipo_movimentacao', 'entrada', 'quantidade', 3,
          'localizacao_destino_id', 'b7500000-0000-4000-8000-000000000003',
          'saldo_destino_anterior', 0, 'saldo_destino_posterior', 3,
          'saldo_total_anterior', 0, 'saldo_total_posterior', 3,
          'client_uuid', 'b7600000-0000-4000-8000-0000000000c1', 'payload_hash', 'hash-mov-1'
        )
      ),
      'material_custodias', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7650000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'tipo_controle', 'quantidade', 'quantidade_retirada', 1,
          'localizacao_origem_id', 'b7500000-0000-4000-8000-000000000003',
          'movimento_saida_id', 'b7600000-0000-4000-8000-0000000000b1',
          'responsavel_nome', 'Ciclano', 'responsavel_tipo', 'usuario',
          'responsavel_usuario_id', 'b7100000-0000-4000-8000-000000000001',
          'finalidade', 'uso_interno', 'condicao_saida', 'bom',
          'client_uuid', 'b7650000-0000-4000-8000-0000000000c2', 'payload_hash', 'hash-cust-1'
        )
      ),
      'material_custodia_eventos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7660000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'custodia_id', 'b7650000-0000-4000-8000-000000000001',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'tipo', 'checkout', 'quantidade', 1,
          'localizacao_origem_id', 'b7500000-0000-4000-8000-000000000003',
          'executado_por', 'b7100000-0000-4000-8000-000000000001',
          'client_uuid', 'b7660000-0000-4000-8000-0000000000c3', 'payload_hash', 'hash-custevt-1'
        )
      ),
      'material_locacoes', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7700000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'cliente_id', 'b7600000-0000-4000-8000-000000000001',
          'numero', 'LOC-2026-000002', 'responsavel_nome', 'Ciclano', 'responsavel_tipo', 'usuario',
          'responsavel_usuario_id', 'b7100000-0000-4000-8000-000000000001',
          'retirada_prevista_em', '2026-08-01', 'devolucao_prevista_em', '2026-08-05',
          'client_uuid', 'b7700000-0000-4000-8000-0000000000c4', 'payload_hash', 'hash-loc-1',
          'created_by', 'b7100000-0000-4000-8000-000000000001', 'updated_by', 'b7100000-0000-4000-8000-000000000001'
        )
      ),
      'material_locacao_itens', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7800000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'locacao_id', 'b7700000-0000-4000-8000-000000000002',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'quantidade_contratada', 1
        )
      ),
      'material_locacao_eventos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7850000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'locacao_id', 'b7700000-0000-4000-8000-000000000002',
          'tipo', 'criacao', 'descricao', 'Locacao criada',
          'executado_por', 'b7100000-0000-4000-8000-000000000001',
          'client_uuid', 'b7850000-0000-4000-8000-0000000000c5', 'payload_hash', 'hash-locevt-1'
        )
      ),
      'manutencao_ordens', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7900000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'material_id', 'b7400000-0000-4000-8000-000000000002',
          'numero', 'MAN-2026-000002', 'tipo', 'corretiva', 'status', 'aberta',
          'defeito_relatado', 'Nao liga', 'tipo_controle', 'quantidade', 'quantidade_afetada', 1,
          'client_uuid', 'b7900000-0000-4000-8000-0000000000c6', 'payload_hash', 'hash-ordem-1',
          'created_by', 'b7100000-0000-4000-8000-000000000001', 'updated_by', 'b7100000-0000-4000-8000-000000000001'
        )
      ),
      'manutencao_ordem_insumos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7950000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'ordem_id', 'b7900000-0000-4000-8000-000000000002',
          'descricao', 'Fusivel', 'created_by', 'b7100000-0000-4000-8000-000000000001'
        )
      ),
      'manutencao_ordem_eventos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7970000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'ordem_id', 'b7900000-0000-4000-8000-000000000002',
          'tipo', 'criacao', 'descricao', 'Ordem aberta',
          'executado_por', 'b7100000-0000-4000-8000-000000000001',
          'client_uuid', 'b7970000-0000-4000-8000-0000000000c7', 'payload_hash', 'hash-ordemevt-1'
        )
      ),
      'financeiro_lancamentos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7a00000-0000-4000-8000-000000000002',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'origem_tipo', 'locacao_material', 'origem_id', 'b7700000-0000-4000-8000-000000000002',
          'valor_original', 200
        )
      ),
      'financeiro_parcelas', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7a50000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'lancamento_id', 'b7a00000-0000-4000-8000-000000000002',
          'numero', 1, 'valor', 200, 'vencimento', '2026-09-01'
        )
      ),
      'financeiro_recebimentos', jsonb_build_array(
        jsonb_build_object(
          'id', 'b7a70000-0000-4000-8000-000000000001',
          'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'lancamento_id', 'b7a00000-0000-4000-8000-000000000002',
          'parcela_id', 'b7a50000-0000-4000-8000-000000000001',
          'tipo', 'recebimento', 'valor', 200,
          'client_uuid', 'b7a70000-0000-4000-8000-0000000000c8'
        )
      )
    )
  )::text,
  true
);

-- 1. The full self-consistent operational-core payload restores cleanly,
--    including the custódia + active-manutenção-for-the-same-material
--    combination that would otherwise trip block_custody_when_maintenance_active.
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b7000000-0000-4000-8000-000000000001', current_setting('test.full_payload')::jsonb
  )$test$,
  'the full operational-core payload restores without error, custodia-before-manutencao ordering holds'
);
RESET ROLE;

-- 2. categorias_materiais: existing row upserted in place, never deleted.
SELECT is((SELECT nome FROM public.categorias_materiais WHERE id = 'b7300000-0000-4000-8000-000000000001'),
  'Categoria Atualizada', 'categorias_materiais upsert updates the existing row in place');

-- 3-4. materiais: prepare_material_write bypass preserves the exact
--    identificador_unico and a non-'disponivel' status_operacional on INSERT.
SELECT is((SELECT identificador_unico FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000002'),
  'b7400000-0000-4000-8000-0000000000aa'::uuid,
  'materiais restore preserves the exact backed-up identificador_unico (bypasses prepare_material_write''s regeneration)');
SELECT is((SELECT status_operacional::text FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000002'),
  'em_manutencao',
  'materiais restore preserves a non-disponivel status_operacional (bypasses the INSERT-must-be-disponivel rule)');

-- 5. materiais: the pre-existing material absent from this payload survives.
SELECT is((SELECT count(*) FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000001'),
  1::bigint, 'materiais upsert never deletes a material absent from the payload');

-- 6. estoque_localizacoes: both rows land with the parent/child link intact,
--    even though the payload listed the child before the parent.
SELECT is((SELECT localizacao_pai_id FROM public.estoque_localizacoes WHERE id = 'b7500000-0000-4000-8000-000000000003'),
  'b7500000-0000-4000-8000-000000000002'::uuid,
  'estoque_localizacoes restores a child whose parent is inserted first despite child-first payload order');

-- 7. estoque_localizacoes: pre-existing row absent from the payload survives.
SELECT is((SELECT count(*) FROM public.estoque_localizacoes WHERE id = 'b7500000-0000-4000-8000-000000000001'),
  1::bigint, 'estoque_localizacoes upsert never deletes a location absent from the payload');

-- 8-9. estoque_saldos lands, and materiais.quantidade is re-derived by the
--    pre-existing sync_material_stock_projection AFTER trigger (not by any
--    code in this migration) once the saldo row exists.
SELECT is((SELECT quantidade FROM public.estoque_saldos WHERE id = 'b7550000-0000-4000-8000-000000000001'),
  3, 'estoque_saldos restores the exact backed-up quantidade');
SELECT is((SELECT quantidade FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000002'),
  3, 'materiais.quantidade is re-derived from the restored estoque_saldos row');

-- 10. estoque_movimentacoes: the historical row is replayed with its exact
--     audit-snapshot balances, not recomputed against current state.
SELECT is((SELECT saldo_total_posterior FROM public.estoque_movimentacoes WHERE id = 'b7600000-0000-4000-8000-0000000000b1'),
  3, 'estoque_movimentacoes preserves its exact historical saldo_total_posterior snapshot');

-- 11. material_custodias lands with its exact responsavel/condicao values.
SELECT is((SELECT status::text FROM public.material_custodias WHERE id = 'b7650000-0000-4000-8000-000000000001'),
  'aberta', 'material_custodias restores with its backed-up status');

-- 12. material_custodia_eventos (immutable history) lands.
SELECT is((SELECT tipo::text FROM public.material_custodia_eventos WHERE id = 'b7660000-0000-4000-8000-000000000001'),
  'checkout', 'material_custodia_eventos restores the checkout event');

-- 13-14. material_locacoes: new row inserted; pre-existing locação AND its
--     pre-existing item both survive untouched (upsert-not-delete, and the
--     item is never blanket-deleted out from under a live locação).
SELECT is((SELECT numero FROM public.material_locacoes WHERE id = 'b7700000-0000-4000-8000-000000000002'),
  'LOC-2026-000002', 'material_locacoes restores the new locacao');
SELECT is(
  (SELECT count(*) FROM public.material_locacoes WHERE id = 'b7700000-0000-4000-8000-000000000001'),
  1::bigint, 'material_locacoes upsert never deletes a locacao absent from the payload'
);
SELECT is(
  (SELECT count(*) FROM public.material_locacao_itens WHERE id = 'b7800000-0000-4000-8000-000000000001'),
  1::bigint, 'a pre-existing locacao''s item is not stripped out by an unrelated restore'
);

-- 15. material_locacao_itens: new item lands.
SELECT is((SELECT quantidade_contratada FROM public.material_locacao_itens WHERE id = 'b7800000-0000-4000-8000-000000000002'),
  1, 'material_locacao_itens restores the new item');

-- 16. material_locacao_eventos (immutable history) lands.
SELECT is((SELECT descricao FROM public.material_locacao_eventos WHERE id = 'b7850000-0000-4000-8000-000000000001'),
  'Locacao criada', 'material_locacao_eventos restores the creation event');

-- 17-18. manutencao_ordens: new order inserted (proving the custódia-first
--     ordering let this active order through); pre-existing order survives.
SELECT is((SELECT status::text FROM public.manutencao_ordens WHERE id = 'b7900000-0000-4000-8000-000000000002'),
  'aberta', 'manutencao_ordens restores the new (active) order');
SELECT is(
  (SELECT count(*) FROM public.manutencao_ordens WHERE id = 'b7900000-0000-4000-8000-000000000001'),
  1::bigint, 'manutencao_ordens upsert never deletes an order absent from the payload'
);

-- 19. manutencao_ordem_insumos lands.
SELECT is((SELECT descricao FROM public.manutencao_ordem_insumos WHERE id = 'b7950000-0000-4000-8000-000000000001'),
  'Fusivel', 'manutencao_ordem_insumos restores the insumo');

-- 20. manutencao_ordem_eventos (immutable history) lands.
SELECT is((SELECT tipo::text FROM public.manutencao_ordem_eventos WHERE id = 'b7970000-0000-4000-8000-000000000001'),
  'criacao', 'manutencao_ordem_eventos restores the creation event');

-- 21-22. financeiro_lancamentos: new lancamento inserted; pre-existing one
--     (not part of this payload) survives.
SELECT is((SELECT valor_original FROM public.financeiro_lancamentos WHERE id = 'b7a00000-0000-4000-8000-000000000002'),
  200, 'financeiro_lancamentos restores the new lancamento with its exact valor_original');
SELECT is(
  (SELECT count(*) FROM public.financeiro_lancamentos WHERE id = 'b7a00000-0000-4000-8000-000000000001'),
  1::bigint, 'financeiro_lancamentos upsert never deletes a lancamento absent from the payload'
);

-- 23. financeiro_parcelas lands.
SELECT is((SELECT valor FROM public.financeiro_parcelas WHERE id = 'b7a50000-0000-4000-8000-000000000001'),
  200, 'financeiro_parcelas restores the parcela');

-- 24. financeiro_recebimentos (immutable ledger) lands, valor preserved
--     exactly rather than re-derived.
SELECT is((SELECT valor FROM public.financeiro_recebimentos WHERE id = 'b7a70000-0000-4000-8000-000000000001'),
  200, 'financeiro_recebimentos restores the recebimento with its exact valor');

-- 25. Idempotent re-restore: running the identical payload again succeeds
--     and does not duplicate any of the five append-only (ON CONFLICT DO
--     NOTHING) collections.
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b7000000-0000-4000-8000-000000000001', current_setting('test.full_payload')::jsonb
  )$test$,
  're-running the identical operational-core payload is idempotent'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.estoque_movimentacoes WHERE id = 'b7600000-0000-4000-8000-0000000000b1'),
  1::bigint, 'estoque_movimentacoes is not duplicated by a second identical restore'
);
SELECT is(
  (SELECT count(*) FROM public.financeiro_recebimentos WHERE id = 'b7a70000-0000-4000-8000-000000000001'),
  1::bigint, 'financeiro_recebimentos is not duplicated by a second identical restore'
);

-- 26. Cross-tenant safety: company B's material is untouched by any of the
--     company A restores above.
SELECT is((SELECT count(*) FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000099'),
  1::bigint, 'company B materiais is untouched by company A restores');
SELECT is((SELECT nome FROM public.materiais WHERE id = 'b7400000-0000-4000-8000-000000000099'),
  'Material B', 'company B material is unmodified');

-- 27. A payload whose estoque_saldos references a material_id belonging to
--     a different company is rejected before any destructive statement runs.
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b7000000-0000-4000-8000-000000000001',
    jsonb_set(
      current_setting('test.full_payload')::jsonb,
      '{data,estoque_saldos,0,material_id}',
      to_jsonb('b7400000-0000-4000-8000-000000000099'::text)
    )
  )$test$,
  'P0001',
  'Invalid backup payload: estoque_saldos references a material or localizacao that does not exist in this company',
  'estoque_saldos cannot reference another company''s material'
);
RESET ROLE;

-- 28. A payload whose estoque_localizacoes contains a cycle (A's parent is
--     B, B's parent is A) is rejected with a clear error instead of being
--     silently dropped from the restore.
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.restore_company_backup(
    'b7000000-0000-4000-8000-000000000001',
    jsonb_set(
      current_setting('test.full_payload')::jsonb,
      '{data,estoque_localizacoes}',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'b7500000-0000-4000-8000-000000000004', 'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'localizacao_pai_id', 'b7500000-0000-4000-8000-000000000005', 'codigo', 'CYCLE-A', 'nome', 'Cycle A'
        ),
        jsonb_build_object(
          'id', 'b7500000-0000-4000-8000-000000000005', 'empresa_id', 'b7000000-0000-4000-8000-000000000001',
          'localizacao_pai_id', 'b7500000-0000-4000-8000-000000000004', 'codigo', 'CYCLE-B', 'nome', 'Cycle B'
        )
      )
    )
  )$test$,
  'P0001',
  'Invalid backup payload: estoque_localizacoes contains a cycle or an unreachable hierarchy',
  'a cyclical estoque_localizacoes hierarchy is rejected, not silently dropped'
);
RESET ROLE;

-- 29-30. Backward compatibility: a payload with none of the sixteen
--     operational-core keys (mirrors a pre-1.2 export) leaves every one of
--     them completely untouched.
SELECT set_config(
  'test.legacy_payload',
  jsonb_build_object(
    'versao', '1.1',
    'sistema', 'Backstage Pro',
    'meta', jsonb_build_object(
      'empresa_id', 'b7000000-0000-4000-8000-000000000001',
      'tipo', 'manual', 'data_backup', '2026-08-18T13:00:00Z'
    ),
    'data', jsonb_build_object(
      'eventos', '[]'::jsonb, 'event_days', '[]'::jsonb,
      'event_files', '[]'::jsonb, 'financials', '[]'::jsonb
    )
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', 'b7100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.restore_company_backup(
    'b7000000-0000-4000-8000-000000000001', current_setting('test.legacy_payload')::jsonb
  )$test$,
  'a payload with no operational-core keys at all still restores successfully'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.materiais WHERE empresa_id = 'b7000000-0000-4000-8000-000000000001'),
  2::bigint, 'a legacy-shaped restore leaves every materiais row (both pre-existing and just-restored) untouched'
);
SELECT is(
  (SELECT count(*) FROM public.financeiro_recebimentos WHERE empresa_id = 'b7000000-0000-4000-8000-000000000001'),
  1::bigint, 'a legacy-shaped restore leaves financeiro_recebimentos untouched (no accidental wipe of an absent collection)'
);

-- 31-33. prepare_material_write is a pure BEFORE INSERT OR UPDATE trigger
--    function (RETURNS trigger) with no other call site anywhere in this
--    repo. PostgreSQL refuses to invoke a RETURNS trigger function via a
--    direct call for any role, and firing an already-installed trigger is
--    authorized through the table's own INSERT/UPDATE privileges, not
--    EXECUTE on the trigger function - so the canonical ACL is nobody.
--    This mirrors every sibling trigger function in this same area
--    (prepare_stock_location_write, protect_material_stock_projection,
--    sync_material_stock_projection, validate_stock_balance,
--    protect_stock_ledger - see 20260730080000_stock_control_stage_two.sql:1309-1320).
--    Regression coverage for the P1-10B apply failure: production had
--    authenticated and service_role still holding EXECUTE (inherited from
--    this schema's default privileges, since the function's original
--    migration only revoked PUBLIC/anon and CREATE OR REPLACE FUNCTION
--    preserves an existing ACL) until 20260818120000 added the REVOKE.
SELECT ok(
  NOT has_function_privilege('anon', 'public.prepare_material_write()'::regprocedure, 'EXECUTE'),
  'anon has no EXECUTE on prepare_material_write'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.prepare_material_write()'::regprocedure, 'EXECUTE'),
  'authenticated has no EXECUTE on prepare_material_write - it is invoked only as a trigger, never called directly'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.prepare_material_write()'::regprocedure, 'EXECUTE'),
  'service_role has no EXECUTE on prepare_material_write - same reasoning, and the P1-10B apply-time regression this pins down'
);

SELECT * FROM finish();
ROLLBACK;
