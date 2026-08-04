BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(38);

SELECT has_table('public','etiqueta_modelos','label models exist');
SELECT has_table('public','etiqueta_impressoes','immutable print requests exist');
SELECT has_function('public','salvar_modelo_etiqueta',ARRAY['text','numeric','numeric','text','jsonb','integer','boolean','text','boolean','uuid','timestamp with time zone','uuid'],'model facade exists');
SELECT has_function('public','registrar_solicitacao_impressao_etiqueta',ARRAY['uuid','uuid','integer','uuid','uuid','uuid'],'print facade exists');
SELECT ok((SELECT ativo FROM public.module_catalog WHERE feature_key='etiquetas_materiais'),'labels module is released');
SELECT ok(NOT (SELECT metadata ? 'planned' FROM public.module_catalog WHERE feature_key='etiquetas_materiais'),'labels module is no longer planned');
SELECT is((SELECT count(*) FROM public.module_dependencies d JOIN public.module_catalog c ON c.id=d.module_id JOIN public.module_catalog p ON p.id=d.required_module_id WHERE c.feature_key='etiquetas_materiais' AND p.feature_key='gestao_materiais'),1::bigint,'materials remains the canonical dependency');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.etiqueta_modelos'::regclass),'models have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.etiqueta_impressoes'::regclass),'history has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.etiqueta_modelos','INSERT') AND NOT has_table_privilege('authenticated','public.etiqueta_modelos','UPDATE') AND NOT has_table_privilege('authenticated','public.etiqueta_modelos','DELETE'),'authenticated cannot mutate models directly');
SELECT ok(NOT has_table_privilege('authenticated','public.etiqueta_impressoes','INSERT') AND NOT has_table_privilege('authenticated','public.etiqueta_impressoes','UPDATE') AND NOT has_table_privilege('authenticated','public.etiqueta_impressoes','DELETE'),'authenticated cannot mutate history directly');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('resolve_material_labels_company','validate_material_label_fields','protect_material_label_projection','protect_material_label_history') AND has_function_privilege('authenticated',p.oid,'EXECUTE')),0::bigint,'internal helpers are protected');
SELECT is((SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='etiqueta_impressoes' AND column_name IN ('impressa','sucesso_fisico','confirmada_fisicamente')),0::bigint,'history does not claim unverifiable physical output');

INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('a1000000-0000-4000-8000-000000000001','__labels_plan__',100,20,100,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento) VALUES
 ('a2000000-0000-4000-8000-000000000001','Labels A','ativo','a1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('a2000000-0000-4000-8000-000000000002','Labels B','ativo','a1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('a2000000-0000-4000-8000-000000000003','Labels Disabled','ativo','a1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('a2000000-0000-4000-8000-000000000004','Labels Readonly','ativo','a1000000-0000-4000-8000-000000000001',false,false,'pendente',now()+interval '30 days');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000001','authenticated','authenticated','labels-admin-a@example.test','',now(),'{}','{"full_name":"Labels Admin A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000002','authenticated','authenticated','labels-user-a@example.test','',now(),'{}','{"full_name":"Labels User A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000003','authenticated','authenticated','labels-admin-b@example.test','',now(),'{}','{"full_name":"Labels Admin B"}',now(),now()),
 ('00000000-0000-0000-8000-000000000000','a3000000-0000-4000-8000-000000000004','authenticated','authenticated','labels-disabled@example.test','',now(),'{}','{"full_name":"Labels Disabled"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000005','authenticated','authenticated','labels-readonly@example.test','',now(),'{}','{"full_name":"Labels Readonly"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000006','authenticated','authenticated','labels-master@example.test','',now(),'{}','{"full_name":"Labels Master"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN ('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000005');
UPDATE public.user_roles SET role='master_admin' WHERE user_id='a3000000-0000-4000-8000-000000000006';
UPDATE public.profiles SET empresa_id=CASE user_id
 WHEN 'a3000000-0000-4000-8000-000000000001'::uuid THEN 'a2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'a3000000-0000-4000-8000-000000000002'::uuid THEN 'a2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'a3000000-0000-4000-8000-000000000003'::uuid THEN 'a2000000-0000-4000-8000-000000000002'::uuid
 WHEN 'a3000000-0000-4000-8000-000000000004'::uuid THEN 'a2000000-0000-4000-8000-000000000003'::uuid
 WHEN 'a3000000-0000-4000-8000-000000000005'::uuid THEN 'a2000000-0000-4000-8000-000000000004'::uuid END
WHERE user_id BETWEEN 'a3000000-0000-4000-8000-000000000001' AND 'a3000000-0000-4000-8000-000000000005';

INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('a2000000-0000-4000-8000-000000000001'::uuid),('a2000000-0000-4000-8000-000000000002'::uuid),
 ('a2000000-0000-4000-8000-000000000003'::uuid),('a2000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='gestao_materiais';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('a2000000-0000-4000-8000-000000000001'::uuid),('a2000000-0000-4000-8000-000000000002'::uuid),('a2000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='etiquetas_materiais';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'a2000000-0000-4000-8000-000000000003',id,'inactive',now(),true,'manual_admin' FROM public.module_catalog WHERE feature_key='etiquetas_materiais';

INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Luz A'),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','Luz B'),
 ('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000004','Luz R');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,identificador_unico,codigo_barras,tipo_identificacao,conteudo_qr_code,identificacao_gerada_em,status_identificacao,nome,tipo_controle,status_operacional,ativo) VALUES
 ('a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','LBL-A1','a6000000-0000-4000-8000-000000000001','BSP-LABEL-A1','ambos','BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000001',now(),'ativa','Moving Head A','individual','disponivel',true),
 ('a5000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','LBL-A2','a6000000-0000-4000-8000-000000000002',NULL,'qr_code',NULL,NULL,'nao_gerada','Cabo A','quantidade','disponivel',true),
 ('a5000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000002','LBL-B1','a6000000-0000-4000-8000-000000000003','BSP-LABEL-B1','ambos','BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000003',now(),'ativa','Moving Head B','individual','disponivel',true),
 ('a5000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000004','a4000000-0000-4000-8000-000000000003','LBL-R1','a6000000-0000-4000-8000-000000000004','BSP-LABEL-R1','ambos','BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000004',now(),'ativa','Moving Head R','individual','disponivel',true);

CREATE TEMP TABLE stage6_ids (name text PRIMARY KEY,id uuid NOT NULL); GRANT ALL ON stage6_ids TO authenticated;
SELECT set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;

INSERT INTO stage6_ids SELECT 'model_a',(public.salvar_modelo_etiqueta('Patrimonio 60x40',60,40,'ambos','["nome","codigo_interno","numero_patrimonio"]',10,true,NULL,true,NULL,NULL,'a2000000-0000-4000-8000-000000000001')->>'id')::uuid;
SELECT is((SELECT count(*) FROM public.listar_modelos_etiqueta('a2000000-0000-4000-8000-000000000001')),1::bigint,'admin creates and lists own model');
SELECT is((SELECT padrao FROM public.etiqueta_modelos WHERE id=(SELECT id FROM stage6_ids WHERE name='model_a')),true,'created model is default');
SELECT is((SELECT campos FROM public.etiqueta_modelos WHERE id=(SELECT id FROM stage6_ids WHERE name='model_a')),'["nome", "codigo_interno", "numero_patrimonio"]'::jsonb,'field order is persisted');
SELECT throws_ok($test$SELECT public.salvar_modelo_etiqueta('Invalid',10,40,'qr_code','["nome"]',10,false,NULL,false,NULL,NULL,'a2000000-0000-4000-8000-000000000001')$test$,'23514',NULL,'database rejects invalid physical dimensions');
SELECT throws_ok($test$SELECT public.salvar_modelo_etiqueta('Invalid field',60,40,'qr_code','["senha"]',10,false,NULL,false,NULL,NULL,'a2000000-0000-4000-8000-000000000001')$test$,'LB004','Campo de etiqueta nao permitido.','unknown fields are rejected');
SELECT throws_ok($test$SELECT public.salvar_modelo_etiqueta('Cross tenant',60,40,'qr_code','["nome"]',10,false,NULL,false,NULL,NULL,'a2000000-0000-4000-8000-000000000002')$test$,'42501','Empresa invalida.','company user cannot target another tenant');
INSERT INTO stage6_ids SELECT 'print_a',(public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_ids WHERE name='model_a'),'a5000000-0000-4000-8000-000000000001',3,'a7000000-0000-4000-8000-000000000001',NULL,'a2000000-0000-4000-8000-000000000001')->>'id')::uuid;
SELECT is((SELECT quantidade FROM public.etiqueta_impressoes WHERE id=(SELECT id FROM stage6_ids WHERE name='print_a')),3,'print quantity is recorded');
SELECT is((SELECT modelo_snapshot->>'versao' FROM public.etiqueta_impressoes WHERE id=(SELECT id FROM stage6_ids WHERE name='print_a')),'1','model version is snapshotted');
SELECT is((SELECT material_snapshot->>'codigo_barras' FROM public.etiqueta_impressoes WHERE id=(SELECT id FROM stage6_ids WHERE name='print_a')),'BSP-LABEL-A1','canonical barcode is snapshotted');
SELECT lives_ok($test$SELECT public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_ids WHERE name='model_a'),'a5000000-0000-4000-8000-000000000001',3,'a7000000-0000-4000-8000-000000000001',NULL,'a2000000-0000-4000-8000-000000000001')$test$,'equivalent print retry is idempotent');
SELECT is((SELECT count(*) FROM public.etiqueta_impressoes WHERE client_uuid='a7000000-0000-4000-8000-000000000001'),1::bigint,'idempotent retry creates one history row');
SELECT throws_ok($test$SELECT public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_ids WHERE name='model_a'),'a5000000-0000-4000-8000-000000000001',4,'a7000000-0000-4000-8000-000000000001',NULL,'a2000000-0000-4000-8000-000000000001')$test$,'LB016','A operacao foi repetida com dados diferentes.','idempotency key rejects a different payload');
SELECT throws_ok($test$SELECT public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_ids WHERE name='model_a'),'a5000000-0000-4000-8000-000000000002',1,'a7000000-0000-4000-8000-000000000002',NULL,'a2000000-0000-4000-8000-000000000001')$test$,'LB012','Gere o QR Code do material antes de imprimir.','missing QR is rejected');
SELECT is((SELECT count(*) FROM public.listar_historico_impressoes_etiqueta(1,20,NULL,'a2000000-0000-4000-8000-000000000001')),1::bigint,'history lists only the company request');
SELECT is((public.obter_indicadores_etiquetas('a2000000-0000-4000-8000-000000000001')->>'etiquetas_hoje')::integer,3,'indicator sums requested labels');
SELECT is((SELECT codigo_barras FROM public.materiais WHERE id='a5000000-0000-4000-8000-000000000001'),'BSP-LABEL-A1','printing never changes canonical material identification');
SELECT throws_ok($test$INSERT INTO public.etiqueta_impressoes (empresa_id,material_id,quantidade,modelo_snapshot,material_snapshot,solicitada_por,solicitante_nome,client_uuid,payload_hash) VALUES ('a2000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',1,'{}','{}','a3000000-0000-4000-8000-000000000001','x','a7000000-0000-4000-8000-000000000099',repeat('0',64))$test$,'42501',NULL,'direct history insertion is denied');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000002',true); SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.listar_modelos_etiqueta('a2000000-0000-4000-8000-000000000001')),1::bigint,'ordinary user can read labels module');
SELECT throws_ok($test$SELECT public.salvar_modelo_etiqueta('User write',60,40,'qr_code','["nome"]',10,false,NULL,false,NULL,NULL,'a2000000-0000-4000-8000-000000000001')$test$,'42501','Voce nao tem permissao para esta operacao.','ordinary user cannot manage models');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000004',true); SET LOCAL ROLE authenticated;
SELECT throws_ok($test$SELECT public.listar_modelos_etiqueta('a2000000-0000-4000-8000-000000000003')$test$,'LB009','Etiquetas e Gestao de Materiais precisam estar ativas.','inactive labels module fails closed');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000005',true); SET LOCAL ROLE authenticated;
SELECT lives_ok($test$SELECT public.listar_modelos_etiqueta('a2000000-0000-4000-8000-000000000004')$test$,'readonly company can consult labels');
SELECT throws_ok($test$SELECT public.salvar_modelo_etiqueta('Readonly',60,40,'qr_code','["nome"]',10,false,NULL,false,NULL,NULL,'a2000000-0000-4000-8000-000000000004')$test$,'LB010','A empresa esta em modo somente leitura.','readonly company cannot write');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000006',true); SET LOCAL ROLE authenticated;
SELECT throws_ok($test$SELECT public.listar_modelos_etiqueta(NULL)$test$,'LB011','Selecione a empresa para operar etiquetas.','Master requires explicit company');
SELECT is((SELECT count(*) FROM public.listar_modelos_etiqueta('a2000000-0000-4000-8000-000000000001')),1::bigint,'Master reads an explicitly selected company');

RESET ROLE;
SELECT throws_ok(format('UPDATE public.etiqueta_impressoes SET quantidade=9 WHERE id=%L',(SELECT id FROM stage6_ids WHERE name='print_a')),'LB014','O historico de impressoes e imutavel.','print history cannot be updated even by owner');
SELECT * FROM finish();
ROLLBACK;
