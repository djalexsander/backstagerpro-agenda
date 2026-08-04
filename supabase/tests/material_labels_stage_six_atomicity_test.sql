\set ON_ERROR_STOP on
INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('b1000000-0000-4000-8000-000000000001','__labels_atomic_plan__',100,10,10,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
VALUES ('b2000000-0000-4000-8000-000000000001','Labels Atomic','ativo','b1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','b3000000-0000-4000-8000-000000000001','authenticated','authenticated','labels-atomic@example.test','',now(),'{}','{"full_name":"Labels Atomic"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id='b3000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id='b2000000-0000-4000-8000-000000000001' WHERE user_id='b3000000-0000-4000-8000-000000000001';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'b2000000-0000-4000-8000-000000000001',id,'active',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key IN ('gestao_materiais','etiquetas_materiais') ORDER BY feature_key DESC;
INSERT INTO public.categorias_materiais (id,empresa_id,nome)
VALUES ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Atomic');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,identificador_unico,codigo_barras,tipo_identificacao,conteudo_qr_code,identificacao_gerada_em,status_identificacao,nome,tipo_controle,status_operacional,ativo)
VALUES ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','LBL-ATOMIC','b6000000-0000-4000-8000-000000000001','BSP-ATOMIC','ambos','BACKSTAGE-PRO:MATERIAL:b6000000-0000-4000-8000-000000000001',now(),'ativa','Etiqueta atomica','individual','disponivel',true);
CREATE TABLE public.stage6_test_ids (name text PRIMARY KEY,id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage6_test_ids TO authenticated;

SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
INSERT INTO public.stage6_test_ids SELECT 'model',(public.salvar_modelo_etiqueta('Atomic 60x40',60,40,'ambos','["nome","codigo_interno"]',10,false,NULL,true,NULL,NULL,'b2000000-0000-4000-8000-000000000001')->>'id')::uuid;
RESET ROLE;

CREATE OR REPLACE FUNCTION public.stage6_force_log_failure()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.tipo='etiquetas' AND current_setting('stage6.force_failure',true)='on' THEN
    RAISE EXCEPTION USING ERRCODE='ZX601',MESSAGE='forced stage6 atomicity failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage6_force_log_failure BEFORE INSERT ON public.system_logs
FOR EACH ROW EXECUTE FUNCTION public.stage6_force_log_failure();

SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
SELECT set_config('stage6.force_failure','on',false);
DO $$ BEGIN
  PERFORM public.salvar_modelo_etiqueta('Must rollback',50,30,'qr_code','["nome"]',9,false,NULL,false,NULL,NULL,'b2000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'model save should have failed';
EXCEPTION WHEN SQLSTATE 'ZX601' THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM public.stage6_test_ids WHERE name='model'),'b5000000-0000-4000-8000-000000000001',2,'b7000000-0000-4000-8000-000000000001',NULL,'b2000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'print request should have failed';
EXCEPTION WHEN SQLSTATE 'ZX601' THEN NULL; END $$;
RESET ROLE;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.etiqueta_modelos WHERE empresa_id='b2000000-0000-4000-8000-000000000001' AND nome='Must rollback') THEN
    RAISE EXCEPTION 'model survived failed audit log';
  END IF;
  IF EXISTS(SELECT 1 FROM public.etiqueta_impressoes WHERE empresa_id='b2000000-0000-4000-8000-000000000001' AND client_uuid='b7000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'print history survived failed audit log';
  END IF;
END $$;
DROP TRIGGER stage6_force_log_failure ON public.system_logs;
DROP FUNCTION public.stage6_force_log_failure();
SELECT 'stage6 atomicity PASS' AS result;
