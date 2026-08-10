-- ============================================================================
-- INTEGRAÇÃO MANUTENÇÃO x FINANCEIRO (categoria "Manutenções") - pgTAP
-- ============================================================================
--
-- Cobre 20260808120000_equipment_maintenance_financial_integration.sql:
-- estrutura/privilégios dos objetos novos, e um fluxo funcional completo
-- (abrir -> iniciar -> insumo -> mão de obra/outros -> concluir) provando
-- que o lançamento nasce com valor = mão de obra + peças + outros, sem
-- duplicar em retry, só na conclusão (nunca na criação/insumo), nunca para
-- ordem cancelada ou concluída sem custo, e nunca quando financeiro_avancado
-- está inativo (best-effort, sem quebrar a conclusão da manutenção).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. Estrutura, privilégios e pontos de integração.
-- ----------------------------------------------------------------------------
SELECT has_function('public','sync_equipment_maintenance_financial_entry',ARRAY['uuid','uuid'],'internal sync helper exists');
SELECT has_function('public','listar_despesas_manutencao',ARRAY['integer','integer','text','uuid'],'listing RPC exists');
SELECT has_function('public','obter_resumo_financeiro_manutencoes',ARRAY['uuid'],'summary RPC exists');
SELECT has_function('public','backfill_financeiro_manutencoes',ARRAY['uuid'],'backfill exists');

SELECT ok(NOT has_function_privilege('authenticated','public.sync_equipment_maintenance_financial_entry(uuid,uuid)','EXECUTE'),'sync helper: no EXECUTE for authenticated');
SELECT ok(NOT has_function_privilege('anon','public.sync_equipment_maintenance_financial_entry(uuid,uuid)','EXECUTE'),'sync helper: no EXECUTE for anon');
SELECT ok(NOT has_function_privilege('service_role','public.sync_equipment_maintenance_financial_entry(uuid,uuid)','EXECUTE'),'sync helper: no EXECUTE for service_role');
SELECT ok(NOT has_function_privilege('authenticated','public.backfill_financeiro_manutencoes(uuid)','EXECUTE'),'backfill: no EXECUTE for authenticated (admin-only channel)');

SELECT ok(has_function_privilege('authenticated','public.listar_despesas_manutencao(integer,integer,text,uuid)','EXECUTE'),'listing RPC callable by authenticated');
SELECT ok(has_function_privilege('authenticated','public.obter_resumo_financeiro_manutencoes(uuid)','EXECUTE'),'summary RPC callable by authenticated');
SELECT ok(NOT has_function_privilege('anon','public.listar_despesas_manutencao(integer,integer,text,uuid)','EXECUTE'),'listing RPC blocked for anon');
SELECT ok(NOT has_function_privilege('service_role','public.obter_resumo_financeiro_manutencoes(uuid)','EXECUTE'),'summary RPC blocked for service_role');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financeiro_lancamentos'::regclass
      AND conname = 'financeiro_lancamentos_origem_unica' AND contype = 'u'
  ),
  'reuses the existing structural idempotency constraint from 20260806090000 - no new table/column for "categoria"'
);

SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'transicionar_ordem_manutencao' AND pronamespace = 'public'::regnamespace)
  ILIKE '%sync_equipment_maintenance_financial_entry%',
  'conclusion transition is the single sync point'
);
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'criar_ordem_manutencao' AND pronamespace = 'public'::regnamespace)
  NOT ILIKE '%sync_equipment_maintenance_financial_entry%',
  'opening an order never touches the financial ledger'
);
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'salvar_insumo_ordem_manutencao' AND pronamespace = 'public'::regnamespace)
  NOT ILIKE '%sync_equipment_maintenance_financial_entry%',
  'logging a supply never touches the financial ledger directly'
);
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'atualizar_ordem_manutencao' AND pronamespace = 'public'::regnamespace)
  NOT ILIKE '%sync_equipment_maintenance_financial_entry%',
  'editing costs mid-flight never touches the financial ledger - only the finished total at conclusion does'
);

-- ----------------------------------------------------------------------------
-- 1. Fixtures - company A (financeiro_avancado ON), company B (OFF).
-- ----------------------------------------------------------------------------
INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('b1000000-0000-4000-8000-000000000001','__maint_fin_plan__',100,20,100,true,'mensal','plano_base');

INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento) VALUES
 ('b2000000-0000-4000-8000-000000000001','__maint_fin_a__','ativo','b1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('b2000000-0000-4000-8000-000000000002','__maint_fin_b__','ativo','b1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days');

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000','b3000000-0000-4000-8000-000000000001','authenticated','authenticated','maint-fin-admin-a@example.test','',now(),'{}','{"full_name":"Maint Fin Admin A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','b3000000-0000-4000-8000-000000000002','authenticated','authenticated','maint-fin-admin-b@example.test','',now(),'{}','{"full_name":"Maint Fin Admin B"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN ('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002');
UPDATE public.profiles SET empresa_id=CASE user_id
  WHEN 'b3000000-0000-4000-8000-000000000001'::uuid THEN 'b2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'b3000000-0000-4000-8000-000000000002'::uuid THEN 'b2000000-0000-4000-8000-000000000002'::uuid END
WHERE user_id IN ('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002');

-- Company A: maintenance + materials + Financeiro all active.
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'b2000000-0000-4000-8000-000000000001',id,'active',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key IN ('gestao_materiais','manutencao_equipamentos','financeiro_avancado');
-- Company B: maintenance + materials active, Financeiro deliberately OFF.
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'b2000000-0000-4000-8000-000000000002',id,'active',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key IN ('gestao_materiais','manutencao_equipamentos');

INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Maint Fin A'),
 ('b4000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','Maint Fin B');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,nome,tipo_controle,status_operacional,ativo) VALUES
 ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','MFIN-A1','Console A1','individual','disponivel',true),
 ('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','MFIN-A2','Console A2','individual','disponivel',true),
 ('b5000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','MFIN-A3','Console A3','individual','disponivel',true),
 ('b5000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000002','MFIN-B1','Console B1','individual','disponivel',true);

CREATE TEMP TABLE fin_maint_ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT ALL ON fin_maint_ids TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Company A, order A1: full flow, labor(100) + parts(2x25=50) + other(10).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;

INSERT INTO fin_maint_ids SELECT 'order_a1',id FROM public.criar_ordem_manutencao(
  'b5000000-0000-4000-8000-000000000001','corretiva','alta','manual','Não liga',
  'b6000000-0000-4000-8000-000000000001',1,NULL,NULL,NULL,'avariado',NULL,'interna',NULL,NULL,NULL,
  'b2000000-0000-4000-8000-000000000001');

SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,%L,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a1'),'em_manutencao',
  'b6000000-0000-4000-8000-000000000002',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),
  '2026-08-08 12:00Z','b2000000-0000-4000-8000-000000000001'
), 'order A1 starts');

SELECT lives_ok(format(
  'SELECT public.salvar_insumo_ordem_manutencao(%L,%L,2,%L,25,%L,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a1'),'Fusível','un',
  'b6000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001'
), 'part logged: 2 x 25.00 = 50.00');

SELECT lives_ok(format(
  'SELECT public.atualizar_ordem_manutencao(%L,%L,%L,%L,%L,%L,NULL,NULL,NULL,%L,%L,%L,NULL,NULL,100,50,10,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a1'),
  'b6000000-0000-4000-8000-000000000004',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),
  'alta','Fonte queimada','Fonte substituída','Operacional','Finalizado','interna',
  'b2000000-0000-4000-8000-000000000001'
), 'diagnosis/service/exit condition and labor(100)+other(10) saved');
SELECT is((SELECT custo_total FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),160::numeric,'custo_total = mao de obra(100) + pecas(50) + outros(10)');

SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),0::bigint,'no financial entry before conclusion');

SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,%L,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a1'),'concluida',
  'b6000000-0000-4000-8000-000000000005',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),
  '2026-08-08 15:00Z','b2000000-0000-4000-8000-000000000001'
), 'order A1 concludes');

-- Read directly through RLS as the same admin (table has SELECT policy +
-- GRANT SELECT to authenticated from 20260806090000) - proves the read path
-- works end-to-end for this new origem_tipo, not just via RPC.
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),1::bigint,'exactly one financial entry after conclusion');
SELECT is((SELECT tipo FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),'despesa','entry is booked as an expense, not a receivable');
SELECT is((SELECT valor_original FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),160::numeric,'lancamento value matches labor+parts+other');
SELECT is((SELECT valor_recebido FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),160::numeric,'internal cost is booked already settled');
SELECT is((SELECT status FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),'recebido','status reuses the existing enum (recebido = accounted for)');
SELECT ok((SELECT cliente_id IS NULL FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),'no client attached - internal cost, not a receivable');
SELECT is((SELECT empresa_id FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),'b2000000-0000-4000-8000-000000000001'::uuid,'lancamento is linked to the company');

-- Read side: listar_despesas_manutencao / obter_resumo_financeiro_manutencoes.
SELECT is((SELECT (item->>'valor_original')::numeric FROM public.listar_despesas_manutencao(1,20,NULL,'b2000000-0000-4000-8000-000000000001') LIMIT 1),160::numeric,'listing RPC exposes the correct value');
SELECT is((SELECT item->>'ordem_numero' FROM public.listar_despesas_manutencao(1,20,NULL,'b2000000-0000-4000-8000-000000000001') LIMIT 1),(SELECT numero FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),'listing RPC links back to the order number');
SELECT is((SELECT item->>'material_nome' FROM public.listar_despesas_manutencao(1,20,NULL,'b2000000-0000-4000-8000-000000000001') LIMIT 1),'Console A1','listing RPC surfaces the material');
SELECT is((SELECT valor_total FROM public.obter_resumo_financeiro_manutencoes('b2000000-0000-4000-8000-000000000001')),160::numeric,'summary total matches the single order so far');
SELECT is((SELECT quantidade_ordens FROM public.obter_resumo_financeiro_manutencoes('b2000000-0000-4000-8000-000000000001')),1::bigint,'summary count matches the single order so far');

-- ----------------------------------------------------------------------------
-- 3. Company A, order A2: concluded with zero cost - no financial noise.
-- ----------------------------------------------------------------------------
INSERT INTO fin_maint_ids SELECT 'order_a2',id FROM public.criar_ordem_manutencao(
  'b5000000-0000-4000-8000-000000000002','inspecao','normal','inspecao','Inspeção de rotina',
  'b6000000-0000-4000-8000-000000000006',1,NULL,NULL,NULL,'bom',NULL,'interna',NULL,NULL,NULL,
  'b2000000-0000-4000-8000-000000000001');
SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a2'),'em_manutencao',
  'b6000000-0000-4000-8000-000000000007',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a2')),
  'b2000000-0000-4000-8000-000000000001'
), 'order A2 starts');
SELECT lives_ok(format(
  'SELECT public.atualizar_ordem_manutencao(%L,%L,%L,%L,%L,%L,NULL,NULL,NULL,%L,NULL,%L,NULL,NULL,0,0,0,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a2'),
  'b6000000-0000-4000-8000-000000000008',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a2')),
  'normal','Nada encontrado','Inspeção visual','Bom','interna',
  'b2000000-0000-4000-8000-000000000001'
), 'order A2 saved with zero cost');
SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a2'),'concluida',
  'b6000000-0000-4000-8000-000000000009',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a2')),
  'b2000000-0000-4000-8000-000000000001'
), 'order A2 concludes');
SELECT is((SELECT custo_total FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a2')),0::numeric,'order A2 really has zero cost');
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a2')),0::bigint,'zero-cost conclusion never creates a lancamento');
SELECT is((SELECT quantidade_ordens FROM public.obter_resumo_financeiro_manutencoes('b2000000-0000-4000-8000-000000000001')),1::bigint,'summary count is unchanged by the zero-cost order');

-- ----------------------------------------------------------------------------
-- 4. Company A, order A3: cancelled - never reaches 'concluida', no lancamento.
-- ----------------------------------------------------------------------------
INSERT INTO fin_maint_ids SELECT 'order_a3',id FROM public.criar_ordem_manutencao(
  'b5000000-0000-4000-8000-000000000003','preventiva','baixa','preventiva','Revisão futura',
  'b6000000-0000-4000-8000-00000000000a',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,90,NULL,
  'b2000000-0000-4000-8000-000000000001');
SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,%L,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_a3'),'cancelada',
  'b6000000-0000-4000-8000-00000000000b',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_a3')),
  'Aberta por engano','b2000000-0000-4000-8000-000000000001'
), 'order A3 is cancelled');
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a3')),0::bigint,'cancelled order never generates a lancamento');

-- ----------------------------------------------------------------------------
-- 5. Idempotency: direct retry of the sync helper, and the structural
--    backstop (raw duplicate INSERT rejected by the UNIQUE constraint).
-- ----------------------------------------------------------------------------
RESET ROLE;
SELECT lives_ok(format(
  'SELECT public.sync_equipment_maintenance_financial_entry(%L,%L)',
  'b2000000-0000-4000-8000-000000000001',(SELECT id FROM fin_maint_ids WHERE name='order_a1')
), 'direct retry of the sync helper is a safe no-op');
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_a1')),1::bigint,'retry never duplicates the lancamento');
SELECT throws_ok(format(
  $sql$INSERT INTO public.financeiro_lancamentos (empresa_id,origem_tipo,origem_id,tipo,valor_original,valor_recebido,status,forma_cobranca) VALUES (%L,'manutencao_equipamento',%L,'despesa',999,999,'recebido','avista')$sql$,
  'b2000000-0000-4000-8000-000000000001',(SELECT id FROM fin_maint_ids WHERE name='order_a1')
), '23505', 'duplicate key value violates unique constraint "financeiro_lancamentos_origem_unica"', 'a second lancamento for the same order is structurally impossible - SEM duplicidade');

-- Backfill: order A1 already has a lancamento (detected, not recreated);
-- zero-cost/cancelled orders are outside its scope by design.
SELECT is((SELECT count(*) FROM public.backfill_financeiro_manutencoes('b2000000-0000-4000-8000-000000000001')),1::bigint,'backfill only iterates concluded orders with real cost - just order A1 here');
SELECT is((SELECT resultado FROM public.backfill_financeiro_manutencoes('b2000000-0000-4000-8000-000000000001') LIMIT 1),'ja_existia','backfill recognizes the already-synced order and does not duplicate it');

-- ----------------------------------------------------------------------------
-- 6. Company B: financeiro_avancado OFF - conclusion still succeeds
--    (best-effort), but no lancamento is ever created; Financeiro RPCs stay
--    gated exactly like the rest of the module.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;

INSERT INTO fin_maint_ids SELECT 'order_b1',id FROM public.criar_ordem_manutencao(
  'b5000000-0000-4000-8000-000000000004','corretiva','alta','manual','Não liga',
  'b6000000-0000-4000-8000-00000000000c',1,NULL,NULL,NULL,'avariado',NULL,'interna',NULL,NULL,NULL,
  'b2000000-0000-4000-8000-000000000002');
SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_b1'),'em_manutencao',
  'b6000000-0000-4000-8000-00000000000d',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_b1')),
  'b2000000-0000-4000-8000-000000000002'
), 'order B1 starts');
SELECT lives_ok(format(
  'SELECT public.atualizar_ordem_manutencao(%L,%L,%L,%L,%L,%L,NULL,NULL,NULL,%L,NULL,%L,NULL,NULL,200,0,0,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_b1'),
  'b6000000-0000-4000-8000-00000000000e',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_b1')),
  'alta','Fonte queimada','Fonte substituída','Operacional','interna',
  'b2000000-0000-4000-8000-000000000002'
), 'order B1 saved with real cost (200)');
SELECT lives_ok(format(
  'SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',
  (SELECT id FROM fin_maint_ids WHERE name='order_b1'),'concluida',
  'b6000000-0000-4000-8000-00000000000f',
  (SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_b1')),
  'b2000000-0000-4000-8000-000000000002'
), 'order B1 concludes even though Financeiro is inactive for company B - maintenance never fails because of Financeiro');
SELECT is((SELECT status::text FROM public.manutencao_ordens WHERE id=(SELECT id FROM fin_maint_ids WHERE name='order_b1')),'concluida','order B1 really reached concluida');

SELECT throws_ok(
  $test$SELECT public.obter_resumo_financeiro_manutencoes('b2000000-0000-4000-8000-000000000002')$test$,
  'FN003','O módulo Financeiro não está ativo para esta empresa.','summary RPC stays gated by financeiro_avancado like the rest of the module'
);
SELECT throws_ok(
  $test$SELECT count(*) FROM public.listar_despesas_manutencao(1,20,NULL,'b2000000-0000-4000-8000-000000000002')$test$,
  'FN003','O módulo Financeiro não está ativo para esta empresa.','listing RPC stays gated by financeiro_avancado too'
);

RESET ROLE;
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos WHERE origem_tipo='manutencao_equipamento' AND origem_id=(SELECT id FROM fin_maint_ids WHERE name='order_b1')),0::bigint,'no lancamento was ever created for company B - best-effort, module inactive');

SELECT * FROM finish();
ROLLBACK;
