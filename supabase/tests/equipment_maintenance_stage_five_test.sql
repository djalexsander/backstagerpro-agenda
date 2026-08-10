BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Structure, modular architecture and least privilege.
SELECT has_table('public','manutencao_ordens','canonical maintenance order exists');
SELECT has_table('public','manutencao_ordem_eventos','append-only maintenance history exists');
SELECT has_table('public','manutencao_ordem_insumos','maintenance supplies exist');
SELECT has_type('public','equipment_maintenance_status','maintenance status domain exists');
SELECT has_type('public','equipment_maintenance_priority','maintenance priority domain exists');
SELECT has_function('public','criar_ordem_manutencao',ARRAY['uuid','text','text','text','text','uuid','integer','text','uuid','timestamp with time zone','text','text','text','text','integer','uuid','uuid'],'create facade exists');
SELECT ok((SELECT ativo FROM public.module_catalog WHERE feature_key='manutencao_equipamentos'),'maintenance module is released');
SELECT ok(NOT (SELECT metadata ? 'planned' FROM public.module_catalog WHERE feature_key='manutencao_equipamentos'),'maintenance is no longer planned');
SELECT is((SELECT count(*) FROM public.module_dependencies d JOIN public.module_catalog c ON c.id=d.module_id JOIN public.module_catalog p ON p.id=d.required_module_id WHERE c.feature_key='manutencao_equipamentos'),1::bigint,'maintenance has exactly one required dependency');
SELECT ok(EXISTS(SELECT 1 FROM public.module_dependencies d JOIN public.module_catalog c ON c.id=d.module_id JOIN public.module_catalog p ON p.id=d.required_module_id WHERE c.feature_key='manutencao_equipamentos' AND p.feature_key='gestao_materiais'),'materials is the required dependency');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.manutencao_ordens'::regclass),'orders have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.manutencao_ordem_eventos'::regclass),'history has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.manutencao_ordens','INSERT') AND NOT has_table_privilege('authenticated','public.manutencao_ordens','UPDATE') AND NOT has_table_privilege('authenticated','public.manutencao_ordens','DELETE'),'authenticated cannot mutate order projection directly');
SELECT ok(NOT has_table_privilege('authenticated','public.manutencao_ordem_eventos','INSERT') AND NOT has_table_privilege('authenticated','public.manutencao_ordem_eventos','UPDATE') AND NOT has_table_privilege('authenticated','public.manutencao_ordem_eventos','DELETE'),'authenticated cannot mutate history directly');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('resolve_equipment_maintenance_company','next_equipment_maintenance_number','resolve_equipment_maintenance_responsible','equipment_maintenance_transition_allowed','protect_equipment_maintenance_projection','protect_equipment_maintenance_history','equipment_active_maintenance_quantity','material_is_operationally_available','block_custody_when_maintenance_active') AND has_function_privilege('authenticated',p.oid,'EXECUTE')),0::bigint,'internal helpers are protected');
SELECT ok(pg_get_functiondef('public.material_rental_availability(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure) ILIKE '%equipment_active_maintenance_quantity%','rental canonical availability includes maintenance');
SELECT ok(pg_get_functiondef('public.block_custody_when_maintenance_active()'::regprocedure) ILIKE '%operational-material%','checkout guard uses shared operational lock');
SELECT ok(pg_get_functiondef('public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamp with time zone,text,text,text,text,integer,uuid,uuid)'::regprocedure) ILIKE '%rental-material%' AND pg_get_functiondef('public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamp with time zone,text,text,text,text,integer,uuid,uuid)'::regprocedure) ILIKE '%operational-material%','opening serializes against reservation and checkout');
SELECT is((SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='manutencao_ordens' AND column_name IN ('saldo','estoque_saldo','quantidade_fisica')),0::bigint,'maintenance persists no physical balance');

-- Personas and companies.
INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('91000000-0000-4000-8000-000000000001','__maintenance_plan__',100,20,100,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento) VALUES
 ('92000000-0000-4000-8000-000000000001','__maintenance_a__','ativo','91000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('92000000-0000-4000-8000-000000000002','__maintenance_b__','ativo','91000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('92000000-0000-4000-8000-000000000003','__maintenance_disabled__','ativo','91000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('92000000-0000-4000-8000-000000000004','__maintenance_readonly__','ativo','91000000-0000-4000-8000-000000000001',false,false,'pendente',now()+interval '30 days');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
SELECT '92000000-0000-4000-8000-000000000005','__maintenance_lifetime__','ativo',id,false,false,'isento',NULL FROM public.planos WHERE periodicidade='vitalicio' LIMIT 1;
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000001','authenticated','authenticated','maint-admin-a@example.test','',now(),'{}','{"full_name":"Maint Admin A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000002','authenticated','authenticated','maint-user-a@example.test','',now(),'{}','{"full_name":"Maint User A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000003','authenticated','authenticated','maint-admin-b@example.test','',now(),'{}','{"full_name":"Maint Admin B"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000004','authenticated','authenticated','maint-disabled@example.test','',now(),'{}','{"full_name":"Maint Disabled"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000005','authenticated','authenticated','maint-readonly@example.test','',now(),'{}','{"full_name":"Maint Readonly"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000006','authenticated','authenticated','maint-lifetime@example.test','',now(),'{}','{"full_name":"Maint Lifetime"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000007','authenticated','authenticated','maint-master@example.test','',now(),'{}','{"full_name":"Maint Master"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN ('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000006');
UPDATE public.user_roles SET role='master_admin' WHERE user_id='93000000-0000-4000-8000-000000000007';
UPDATE public.profiles SET empresa_id=CASE user_id
 WHEN '93000000-0000-4000-8000-000000000001'::uuid THEN '92000000-0000-4000-8000-000000000001'::uuid WHEN '93000000-0000-4000-8000-000000000002'::uuid THEN '92000000-0000-4000-8000-000000000001'::uuid
 WHEN '93000000-0000-4000-8000-000000000003'::uuid THEN '92000000-0000-4000-8000-000000000002'::uuid WHEN '93000000-0000-4000-8000-000000000004'::uuid THEN '92000000-0000-4000-8000-000000000003'::uuid
 WHEN '93000000-0000-4000-8000-000000000005'::uuid THEN '92000000-0000-4000-8000-000000000004'::uuid WHEN '93000000-0000-4000-8000-000000000006'::uuid THEN '92000000-0000-4000-8000-000000000005'::uuid END
WHERE user_id BETWEEN '93000000-0000-4000-8000-000000000001' AND '93000000-0000-4000-8000-000000000006';

INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('92000000-0000-4000-8000-000000000001'::uuid),('92000000-0000-4000-8000-000000000002'::uuid),('92000000-0000-4000-8000-000000000003'::uuid),('92000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key IN ('gestao_materiais','controle_estoque','checkin_checkout','locacao_materiais');
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('92000000-0000-4000-8000-000000000001'::uuid),('92000000-0000-4000-8000-000000000002'::uuid),('92000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='manutencao_equipamentos';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT '92000000-0000-4000-8000-000000000003',id,'inactive',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key='manutencao_equipamentos';
SELECT ok(public.company_has_active_module('92000000-0000-4000-8000-000000000005','manutencao_equipamentos'),'Lifetime receives maintenance through canonical entitlement');

INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Maintenance A'),('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','Maintenance B'),
 ('94000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003','Maintenance Disabled'),('94000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000004','Maintenance Readonly'),
 ('94000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000005','Maintenance Lifetime');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,nome,tipo_controle,status_operacional,ativo) VALUES
 ('95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','MAINT-IND-A','Console individual','individual','disponivel',true),
 ('95000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','MAINT-QTY-A','Cabo quantidade','quantidade','disponivel',true),
 ('95000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','MAINT-CHECKIN','Case avariado','individual','disponivel',true),
 ('95000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002','MAINT-B','Material B','individual','disponivel',true),
 ('95000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000003','MAINT-D','Disabled','individual','disponivel',true),
 ('95000000-0000-4000-8000-000000000006','92000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000004','MAINT-R','Readonly','individual','disponivel',true),
 ('95000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000005','MAINT-L','Lifetime','individual','disponivel',true);
INSERT INTO public.estoque_localizacoes (id,empresa_id,codigo,nome,ativa) VALUES
 ('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','A','Depósito A',true),('96000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','B','Depósito B',true),
 ('96000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003','D','Depósito D',true),('96000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000004','R','Depósito R',true),
 ('96000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000005','L','Depósito L',true);
INSERT INTO public.estoque_saldos (empresa_id,material_id,localizacao_id,quantidade) VALUES
 ('92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',1),('92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001',5),
 ('92000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000003','96000000-0000-4000-8000-000000000001',1),('92000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000004','96000000-0000-4000-8000-000000000002',1),
 ('92000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000005','96000000-0000-4000-8000-000000000003',1),('92000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000006','96000000-0000-4000-8000-000000000004',1),
 ('92000000-0000-4000-8000-000000000005','95000000-0000-4000-8000-000000000007','96000000-0000-4000-8000-000000000005',1);
INSERT INTO public.funcionarios (id,empresa_id,nome,funcao) VALUES
 ('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Técnico A','Técnico'),('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002','Técnico B','Técnico'),
 ('97000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003','Técnico D','Técnico'),('97000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000004','Técnico R','Técnico'),
 ('97000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000005','Técnico L','Técnico');

CREATE TEMP TABLE stage5_ids (name text PRIMARY KEY,id uuid NOT NULL); GRANT ALL ON stage5_ids TO authenticated;
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;

-- Creation, priority, quantity availability and idempotency.
INSERT INTO stage5_ids SELECT 'individual',id FROM public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','corretiva','critica','manual','Não liga','98000000-0000-4000-8000-000000000001',1,'funcionario','97000000-0000-4000-8000-000000000001',now()+interval '2 days','avariado','Urgente','interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001');
SELECT ok((SELECT numero LIKE 'MAN-%' FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'friendly maintenance number is generated');
SELECT is((SELECT prioridade::text FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'critica','priority is explicit');
SELECT is((SELECT count(*) FROM public.manutencao_ordens WHERE material_id='95000000-0000-4000-8000-000000000001' AND status IN ('aberta','aguardando_analise','em_manutencao','aguardando_peca')),1::bigint,'individual becomes unavailable while active');
SELECT lives_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','corretiva','critica','manual','Não liga','98000000-0000-4000-8000-000000000001',1,'funcionario','97000000-0000-4000-8000-000000000001',now()+interval '2 days','avariado','Urgente','interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'equivalent create retry is idempotent');
SELECT is((SELECT count(*) FROM public.manutencao_ordens WHERE client_uuid='98000000-0000-4000-8000-000000000001'),1::bigint,'retry creates one order');
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','preventiva','normal','preventiva','Teste','98000000-0000-4000-8000-000000000002',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,90,NULL,'92000000-0000-4000-8000-000000000001')$test$,'MT012','Já existe manutenção ativa para este equipamento.','two active individual orders are rejected');

INSERT INTO stage5_ids SELECT 'quantity',id FROM public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000002','inspecao','normal','inspecao','Inspeção de lote','98000000-0000-4000-8000-000000000003',2,NULL,NULL,NULL,'bom',NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001');
SELECT is((SELECT (item->>'disponivel')::bigint FROM public.buscar_materiais_disponiveis_locacao('MAINT-QTY-A',now(),now()+interval '1 day',NULL,10,'92000000-0000-4000-8000-000000000001')),3::bigint,'quantity maintenance reduces rental availability without changing stock');
SELECT is((SELECT quantidade FROM public.estoque_saldos WHERE material_id='95000000-0000-4000-8000-000000000002'),5,'maintenance does not change physical balance');
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000002','corretiva','alta','manual','Excesso','98000000-0000-4000-8000-000000000004',4,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'MT012','A quantidade em manutenção supera o saldo físico disponível.','quantity orders cannot exceed physical capacity');
SELECT is((SELECT count(*) FROM public.buscar_materiais_disponiveis_locacao('MAINT-IND-A',now(),now()+interval '1 day',NULL,10,'92000000-0000-4000-8000-000000000001')),0::bigint,'individual in maintenance is absent from rental availability picker');
SELECT throws_ok($test$SELECT public.registrar_checkout_material('95000000-0000-4000-8000-000000000001',1,'96000000-0000-4000-8000-000000000001','funcionario','97000000-0000-4000-8000-000000000001','uso_interno','bom','98000000-0000-4000-8000-000000000005',NULL,NULL,NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'MT012','Material em manutenção não pode realizar check-out.','active maintenance blocks checkout');
SELECT is((SELECT quantidade FROM public.estoque_saldos WHERE material_id='95000000-0000-4000-8000-000000000001'),1,'failed checkout rolls back stock atomically');

-- State machine, optimistic concurrency, costs, supplies and preventive date.
SELECT throws_ok(format('SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'concluida','98000000-0000-4000-8000-000000000006',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'92000000-0000-4000-8000-000000000001'),'MT014','Transição de status não permitida.','arbitrary transition is rejected');
SELECT lives_ok(format('SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'em_manutencao','98000000-0000-4000-8000-000000000007',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'92000000-0000-4000-8000-000000000001'),'valid start transition succeeds');
SELECT throws_ok(format('SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,NULL,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'concluida','98000000-0000-4000-8000-000000000008',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'92000000-0000-4000-8000-000000000001'),'MT016','Diagnóstico, serviço executado e condição de saída são obrigatórios para concluir.','completion requires technical fields');
SELECT lives_ok(format('SELECT public.salvar_insumo_ordem_manutencao(%L,%L,2,%L,25,%L,NULL,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'Fusível','un','98000000-0000-4000-8000-000000000009','92000000-0000-4000-8000-000000000001'),'supply can be documented without stock movement');
SELECT is((SELECT custo_pecas FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),50::numeric,'parts cost follows documented supplies');
SELECT lives_ok(format('SELECT public.atualizar_ordem_manutencao(%L,%L,%L,%L,%L,%L,%L,%L,NULL,%L,%L,%L,NULL,90,100,50,10,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'98000000-0000-4000-8000-000000000010',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'alta','Fonte queimada','Fonte e fusível substituídos','funcionario','97000000-0000-4000-8000-000000000001','operacional','Finalizado','interna','92000000-0000-4000-8000-000000000001'),'diagnosis, service and costs update succeeds');
SELECT is((SELECT custo_total FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),160::numeric,'total cost is generated from labor, parts and other');
SELECT lives_ok(format('SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,NULL,%L,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'concluida','98000000-0000-4000-8000-000000000011',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),'2026-08-02 12:00Z','92000000-0000-4000-8000-000000000001'),'valid completion succeeds');
SELECT is((SELECT proxima_preventiva_em FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual')),DATE '2026-10-31','preventive date is calculated by day interval');
SELECT is((SELECT count(*) FROM public.manutencao_ordens WHERE material_id='95000000-0000-4000-8000-000000000001' AND status IN ('aberta','aguardando_analise','em_manutencao','aguardando_peca')),0::bigint,'completion releases operational availability');
SELECT is((SELECT count(*) FROM public.buscar_materiais_disponiveis_locacao('MAINT-IND-A',now(),now()+interval '1 day',NULL,10,'92000000-0000-4000-8000-000000000001')),1::bigint,'completed maintenance returns individual to rental picker');
SELECT throws_ok(format('SELECT public.atualizar_ordem_manutencao(%L,%L,%L)',(SELECT id FROM stage5_ids WHERE name='individual'),'98000000-0000-4000-8000-000000000012',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='individual'))),'MT014','Ordem encerrada não pode ser editada.','completed order is immutable through facade');

INSERT INTO stage5_ids SELECT 'cancel',id FROM public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','preventiva','baixa','preventiva','Revisão futura','98000000-0000-4000-8000-000000000013',1,NULL,NULL,NULL,'bom',NULL,'interna',NULL,30,NULL,'92000000-0000-4000-8000-000000000001');
SELECT lives_ok(format('SELECT public.transicionar_ordem_manutencao(%L,%L,%L,%L,%L,NULL,%L)',(SELECT id FROM stage5_ids WHERE name='cancel'),'cancelada','98000000-0000-4000-8000-000000000014',(SELECT updated_at FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='cancel')),'Aberta por engano','92000000-0000-4000-8000-000000000001'),'cancellation succeeds with justification');
SELECT is((SELECT status::text FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='cancel')),'cancelada','cancellation preserves order header');
SELECT ok(EXISTS(SELECT 1 FROM public.manutencao_ordem_eventos WHERE ordem_id=(SELECT id FROM stage5_ids WHERE name='cancel') AND tipo='cancelamento'),'cancellation preserves history');

RESET ROLE;
SELECT throws_ok(format('UPDATE public.manutencao_ordem_eventos SET descricao=%L WHERE ordem_id=%L','tamper',(SELECT id FROM stage5_ids WHERE name='cancel')),'42501','O histórico de manutenção é imutável.','history cannot be altered');
SELECT throws_ok(format('DELETE FROM public.manutencao_ordem_eventos WHERE ordem_id=%L',(SELECT id FROM stage5_ids WHERE name='cancel')),'42501','O histórico de manutenção é imutável.','history cannot be deleted');

-- Check-in damage is an explicit, linked origin; no automatic order is created.
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true); SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
SELECT lives_ok($test$SELECT public.registrar_checkout_material('95000000-0000-4000-8000-000000000003',1,'96000000-0000-4000-8000-000000000001','funcionario','97000000-0000-4000-8000-000000000001','uso_interno','bom','98000000-0000-4000-8000-000000000015',NULL,NULL,NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'checkout prepares damaged return');
SELECT lives_ok((SELECT format('SELECT public.registrar_checkin_material(%L,1,%L,%L,%L,NULL,%L,NULL,%L)',id,'96000000-0000-4000-8000-000000000001','danificado','98000000-0000-4000-8000-000000000016','Case quebrado','92000000-0000-4000-8000-000000000001') FROM public.material_custodias WHERE material_id='95000000-0000-4000-8000-000000000003'),'damaged checkin is recorded canonically');
SELECT is((SELECT count(*) FROM public.manutencao_ordens WHERE material_id='95000000-0000-4000-8000-000000000003'),0::bigint,'damaged checkin does not create maintenance automatically');
SELECT ok((SELECT public.obter_sugestao_manutencao_checkin(id,'92000000-0000-4000-8000-000000000001') IS NOT NULL FROM public.material_custodias WHERE material_id='95000000-0000-4000-8000-000000000003'),'damaged checkin exposes an explicit suggestion');
INSERT INTO stage5_ids SELECT 'checkin',o.id FROM public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000003','corretiva','alta','checkin','Case quebrado','98000000-0000-4000-8000-000000000017',1,NULL,NULL,NULL,'danificado',NULL,'interna',NULL,NULL,(SELECT e.id FROM public.material_custodia_eventos e WHERE e.material_id='95000000-0000-4000-8000-000000000003' AND e.tipo='checkin'),'92000000-0000-4000-8000-000000000001') o;
SELECT ok((SELECT custodia_evento_origem_id IS NOT NULL FROM public.manutencao_ordens WHERE id=(SELECT id FROM stage5_ids WHERE name='checkin')),'maintenance links the exact checkin event');

-- Multi-company, common user, disabled, read-only, Lifetime and Master.
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
SELECT ok((SELECT count(*) FROM public.manutencao_ordens)>0,'common user reads own maintenance');
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','corretiva','normal','manual','Teste','98000000-0000-4000-8000-000000000018',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'42501','Você não tem permissão para esta operação.','common user cannot write');
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
SELECT is((SELECT count(*) FROM public.manutencao_ordens WHERE empresa_id='92000000-0000-4000-8000-000000000002'),0::bigint,'company A cannot read company B orders');
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000004','corretiva','normal','manual','Cross','98000000-0000-4000-8000-000000000019',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'MT005','Material ativo não encontrado na empresa.','cross-company material is rejected');
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000004',true);
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000005','corretiva','normal','manual','Disabled','98000000-0000-4000-8000-000000000020',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000003')$test$,'MT009','Manutenção e Gestão de Materiais precisam estar ativas.','disabled module fails closed');
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000005',true);
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000006','corretiva','normal','manual','Readonly','98000000-0000-4000-8000-000000000021',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000004')$test$,'MT010','A empresa está em modo somente leitura.','read-only company cannot write');
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000006',true);
SELECT lives_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000007','preventiva','normal','preventiva','Lifetime','98000000-0000-4000-8000-000000000022',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,180,NULL,'92000000-0000-4000-8000-000000000005')$test$,'Lifetime company writes without parallel entitlement');
RESET ROLE;
-- Master without a linked company has zero operational maintenance access,
-- whether or not it names another tenant explicitly (tenant isolation is
-- mandatory for master_admin too - see 20260808100000).
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000007',true); SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT count(*) FROM public.listar_ordens_manutencao(1,20,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'42501','Empresa inválida.','Master cannot read another company by naming it explicitly');
SELECT throws_ok($test$SELECT count(*) FROM public.listar_ordens_manutencao()$test$,'42501','Empresa inválida.','Master without a linked company cannot infer a maintenance tenant');

RESET ROLE;
DELETE FROM public.empresa_modules WHERE empresa_id='92000000-0000-4000-8000-000000000002'
  AND module_id=(SELECT id FROM public.module_catalog WHERE feature_key='manutencao_equipamentos');
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true); SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT count(*) FROM public.listar_ordens_manutencao(1,20,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'92000000-0000-4000-8000-000000000002')$test$,'MT009','Manutenção e Gestão de Materiais precisam estar ativas.','company without maintenance entitlement fails closed');
RESET ROLE;
UPDATE public.empresas SET status='inativo' WHERE id='92000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true); SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT public.criar_ordem_manutencao('95000000-0000-4000-8000-000000000001','corretiva','normal','manual','Empresa inativa','98000000-0000-4000-8000-000000000023',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'92000000-0000-4000-8000-000000000001')$test$,'MT010','A empresa está em modo somente leitura.','inactive company cannot mutate maintenance');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
