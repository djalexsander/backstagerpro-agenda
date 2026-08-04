\set ON_ERROR_STOP on
INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('d1000000-0000-4000-8000-000000000001','__labels_61_concurrency__',100,20,100,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
VALUES ('d2000000-0000-4000-8000-000000000001','Labels 61 Concurrency','ativo','d1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','d3000000-0000-4000-8000-000000000001','authenticated','authenticated','labels-61-concurrency@example.test','',now(),'{}','{"full_name":"Labels 61 Concurrency"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id='d3000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id='d2000000-0000-4000-8000-000000000001' WHERE user_id='d3000000-0000-4000-8000-000000000001';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'd2000000-0000-4000-8000-000000000001',id,'active',now(),true,'manual_admin' FROM public.module_catalog WHERE feature_key IN ('gestao_materiais','etiquetas_materiais');
INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Concurrency');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,identificador_unico,codigo_barras,tipo_identificacao,conteudo_qr_code,identificacao_gerada_em,status_identificacao,nome,tipo_controle,status_operacional,ativo) VALUES
 ('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','D-1','d6000000-0000-4000-8000-000000000001','BSP-D1','ambos','BACKSTAGE-PRO:MATERIAL:d6000000-0000-4000-8000-000000000001',now(),'ativa','D1','individual','disponivel',true),
 ('d5000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','D-2','d6000000-0000-4000-8000-000000000002','BSP-D2','ambos','BACKSTAGE-PRO:MATERIAL:d6000000-0000-4000-8000-000000000002',now(),'ativa','D2','individual','disponivel',true),
 ('d5000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','D-3','d6000000-0000-4000-8000-000000000003','BSP-D3','ambos','BACKSTAGE-PRO:MATERIAL:d6000000-0000-4000-8000-000000000003',now(),'ativa','D3','individual','disponivel',true);
CREATE TABLE public.stage61_concurrency_ids(name text PRIMARY KEY,id uuid NOT NULL);
GRANT SELECT,INSERT ON public.stage61_concurrency_ids TO authenticated;
SELECT set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
INSERT INTO public.stage61_concurrency_ids SELECT 'model',(public.salvar_modelo_etiqueta_v2('Concurrency',60,40,'ambos','["nome"]',10,false,1.5,1.5,NULL,true,NULL,NULL,'d2000000-0000-4000-8000-000000000001')->>'id')::uuid;
RESET ROLE;
CREATE OR REPLACE FUNCTION public.stage61_overlap_delay() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
CREATE TRIGGER stage61_overlap_delay BEFORE INSERT ON public.etiqueta_solicitacoes FOR EACH ROW EXECUTE FUNCTION public.stage61_overlap_delay();
