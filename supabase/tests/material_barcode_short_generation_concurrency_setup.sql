\set ON_ERROR_STOP on

INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('67100000-0000-4000-8000-000000000001','__short_barcode_concurrency__',100,20,100,true,'mensal','plano_base');

INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
VALUES ('67200000-0000-4000-8000-000000000001','Short Barcode Concurrency','ativo','67100000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days');

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','67300000-0000-4000-8000-000000000001','authenticated','authenticated','short-barcode-concurrency@example.test','',now(),'{}','{"full_name":"Short Barcode Concurrency"}',now(),now());

UPDATE public.user_roles SET role='admin_empresa' WHERE user_id='67300000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id='67200000-0000-4000-8000-000000000001' WHERE user_id='67300000-0000-4000-8000-000000000001';

INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT '67200000-0000-4000-8000-000000000001',id,'active',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key='gestao_materiais';

INSERT INTO public.categorias_materiais (id,empresa_id,nome)
VALUES ('67400000-0000-4000-8000-000000000001','67200000-0000-4000-8000-000000000001','Concurrency');

INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,tipo_identificacao,nome,tipo_controle,quantidade)
VALUES
  ('67500000-0000-4000-8000-000000000001','67200000-0000-4000-8000-000000000001','67400000-0000-4000-8000-000000000001','CONCURRENT-1','qr_code','Concurrent 1','individual',1),
  ('67500000-0000-4000-8000-000000000002','67200000-0000-4000-8000-000000000001','67400000-0000-4000-8000-000000000001','CONCURRENT-2','qr_code','Concurrent 2','individual',1);
