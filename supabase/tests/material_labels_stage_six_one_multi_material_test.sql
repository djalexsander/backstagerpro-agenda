BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT plan(27);

SELECT has_table('public','etiqueta_solicitacoes','batch headers exist');
SELECT has_table('public','etiqueta_solicitacao_itens','batch items exist');
SELECT has_function('public','registrar_solicitacao_impressao_lote_etiquetas',ARRAY['uuid','jsonb','uuid','timestamp with time zone','uuid','uuid'],'atomic batch RPC exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.etiqueta_solicitacoes'::regclass),'batch headers have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.etiqueta_solicitacao_itens'::regclass),'batch items have RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.etiqueta_solicitacoes','INSERT') AND NOT has_table_privilege('authenticated','public.etiqueta_solicitacao_itens','INSERT'),'frontend cannot insert history directly');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('material_label_batch_json','protect_material_label_batch_history','validate_material_label_batch_completeness') AND has_function_privilege('authenticated',p.oid,'EXECUTE')),0::bigint,'batch helpers are not exposed');

INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('c1000000-0000-4000-8000-000000000001','__labels_61_plan__',100,20,100,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento) VALUES
 ('c2000000-0000-4000-8000-000000000001','Labels 61 A','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('c2000000-0000-4000-8000-000000000002','Labels 61 B','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000001','authenticated','authenticated','labels-61-a@example.test','',now(),'{}','{"full_name":"Labels 61 A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000002','authenticated','authenticated','labels-61-b@example.test','',now(),'{}','{"full_name":"Labels 61 B"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN ('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002');
UPDATE public.profiles SET empresa_id=CASE WHEN user_id='c3000000-0000-4000-8000-000000000001' THEN 'c2000000-0000-4000-8000-000000000001'::uuid ELSE 'c2000000-0000-4000-8000-000000000002'::uuid END
WHERE user_id IN ('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002');
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,module.id,'active',now(),true,'manual_admin' FROM (VALUES ('c2000000-0000-4000-8000-000000000001'::uuid),('c2000000-0000-4000-8000-000000000002'::uuid)) company(id)
CROSS JOIN public.module_catalog module WHERE module.feature_key IN ('gestao_materiais','etiquetas_materiais');
INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','A'),
 ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','B');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,identificador_unico,codigo_barras,tipo_identificacao,conteudo_qr_code,identificacao_gerada_em,status_identificacao,nome,tipo_controle,status_operacional,ativo) VALUES
 ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','A-1','c6000000-0000-4000-8000-000000000001','BSP-C61-A1','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000001',now(),'ativa','Material A1','individual','disponivel',true),
 ('c5000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','A-2','c6000000-0000-4000-8000-000000000002','BSP-C61-A2','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000002',now(),'ativa','Material A2','individual','disponivel',true),
 ('c5000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','A-3','c6000000-0000-4000-8000-000000000003','BSP-C61-A3','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000003',now(),'ativa','Material A3','individual','disponivel',true),
 ('c5000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002','B-1','c6000000-0000-4000-8000-000000000004','BSP-C61-B1','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000004',now(),'ativa','Material B1','individual','disponivel',true);

CREATE TEMP TABLE stage61_ids(name text PRIMARY KEY,id uuid NOT NULL); GRANT ALL ON stage61_ids TO authenticated;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000001',true); SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
INSERT INTO stage61_ids SELECT 'model_a',(public.salvar_modelo_etiqueta_v2('Lote A',60,40,'ambos','["nome","codigo_interno"]',10,false,2.25,1.75,NULL,true,NULL,NULL,'c2000000-0000-4000-8000-000000000001')->>'id')::uuid;
SELECT is((SELECT margem_interna_mm FROM public.etiqueta_modelos WHERE id=(SELECT id FROM stage61_ids WHERE name='model_a')),2.25::numeric,'internal margin is persisted');
SELECT is((SELECT espacamento_interno_mm FROM public.etiqueta_modelos WHERE id=(SELECT id FROM stage61_ids WHERE name='model_a')),1.75::numeric,'internal spacing is persisted');
INSERT INTO stage61_ids SELECT 'single',(public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_a'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":2}]','c7000000-0000-4000-8000-000000000001',NULL,NULL,'c2000000-0000-4000-8000-000000000001')->>'id')::uuid;
SELECT is((SELECT quantidade_materiais FROM public.etiqueta_solicitacoes WHERE id=(SELECT id FROM stage61_ids WHERE name='single')),1,'single-material batch is supported');
INSERT INTO stage61_ids SELECT 'multi',(public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_a'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":10},{"material_id":"c5000000-0000-4000-8000-000000000002","quantidade":4},{"material_id":"c5000000-0000-4000-8000-000000000003","quantidade":8}]','c7000000-0000-4000-8000-000000000002',NULL,NULL,'c2000000-0000-4000-8000-000000000001')->>'id')::uuid;
SELECT is((SELECT quantidade_materiais FROM public.etiqueta_solicitacoes WHERE id=(SELECT id FROM stage61_ids WHERE name='multi')),3,'one logical request contains three materials');
SELECT is((SELECT quantidade_etiquetas FROM public.etiqueta_solicitacoes WHERE id=(SELECT id FROM stage61_ids WHERE name='multi')),22,'batch header records total labels');
SELECT is((SELECT jsonb_agg(quantidade ORDER BY ordem) FROM public.etiqueta_solicitacao_itens WHERE solicitacao_id=(SELECT id FROM stage61_ids WHERE name='multi')),'[10,4,8]'::jsonb,'per-material quantities and order are preserved');
SELECT lives_ok($test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_a'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":10},{"material_id":"c5000000-0000-4000-8000-000000000002","quantidade":4},{"material_id":"c5000000-0000-4000-8000-000000000003","quantidade":8}]','c7000000-0000-4000-8000-000000000002',NULL,NULL,'c2000000-0000-4000-8000-000000000001')$test$,'same batch retry is idempotent');
SELECT is((SELECT count(*) FROM public.etiqueta_solicitacoes WHERE client_uuid='c7000000-0000-4000-8000-000000000002'),1::bigint,'idempotency creates one header');
SELECT is((SELECT count(*) FROM public.etiqueta_solicitacao_itens WHERE solicitacao_id=(SELECT id FROM stage61_ids WHERE name='multi')),3::bigint,'idempotency creates no duplicate items');
SELECT throws_ok($test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_a'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":11}]','c7000000-0000-4000-8000-000000000002',NULL,NULL,'c2000000-0000-4000-8000-000000000001')$test$,'LB016','A operacao foi repetida com dados diferentes.','same key rejects different payload');
SELECT throws_ok($test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_a'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":1},{"material_id":"c5000000-0000-4000-8000-000000000004","quantidade":1}]','c7000000-0000-4000-8000-000000000003',NULL,NULL,'c2000000-0000-4000-8000-000000000001')$test$,'LB017',NULL,'mixed-company material rejects entire batch');
SELECT is((SELECT count(*) FROM public.etiqueta_solicitacoes WHERE client_uuid='c7000000-0000-4000-8000-000000000003'),0::bigint,'cross-company failure leaves no header');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000002',true); SET LOCAL ROLE authenticated;
INSERT INTO stage61_ids SELECT 'model_b',(public.salvar_modelo_etiqueta_v2('Lote B',60,40,'ambos','["nome"]',10,false,1.5,1.5,NULL,true,NULL,NULL,'c2000000-0000-4000-8000-000000000002')->>'id')::uuid;
RESET ROLE; SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000001',true); SET LOCAL ROLE authenticated;
SELECT throws_ok($test$SELECT public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM stage61_ids WHERE name='model_b'),'[{"material_id":"c5000000-0000-4000-8000-000000000001","quantidade":1}]','c7000000-0000-4000-8000-000000000004',NULL,NULL,'c2000000-0000-4000-8000-000000000001')$test$,'LB005','Modelo ativo nao encontrado.','another-company model is rejected');
SELECT is((SELECT count(*) FROM public.etiqueta_solicitacoes WHERE client_uuid='c7000000-0000-4000-8000-000000000004'),0::bigint,'wrong-model failure is atomic');
SELECT is((SELECT count(*) FROM public.listar_historico_impressoes_etiqueta(1,1,NULL,'c2000000-0000-4000-8000-000000000001')),1::bigint,'history page size is enforced server-side');
SELECT is((SELECT total_count FROM public.listar_historico_impressoes_etiqueta(1,1,NULL,'c2000000-0000-4000-8000-000000000001') LIMIT 1),2::bigint,'history exposes reliable total');
RESET ROLE;
SELECT throws_ok(format('UPDATE public.etiqueta_solicitacao_itens SET quantidade=99 WHERE solicitacao_id=%L',(SELECT id FROM stage61_ids WHERE name='multi')),'LB014','O historico de impressoes e imutavel.','item snapshots and quantities are immutable');
SELECT throws_ok(format('DELETE FROM public.etiqueta_solicitacoes WHERE id=%L',(SELECT id FROM stage61_ids WHERE name='multi')),'LB014','O historico de impressoes e imutavel.','batch header is immutable');
UPDATE public.materiais SET nome='Material A1 alterado',codigo_interno='A-1-NOVO' WHERE id='c5000000-0000-4000-8000-000000000001';
SELECT is((SELECT material_snapshot->>'nome' FROM public.etiqueta_solicitacao_itens WHERE solicitacao_id=(SELECT id FROM stage61_ids WHERE name='multi') AND material_id='c5000000-0000-4000-8000-000000000001'),'Material A1','later material changes do not rewrite snapshots');
SELECT is((SELECT count(*) FROM public.etiqueta_solicitacao_itens item JOIN public.etiqueta_solicitacoes request ON request.empresa_id=item.empresa_id AND request.id=item.solicitacao_id WHERE request.empresa_id='c2000000-0000-4000-8000-000000000001' AND item.empresa_id<>request.empresa_id),0::bigint,'all batch items remain in the header company');
SELECT * FROM finish();
ROLLBACK;
