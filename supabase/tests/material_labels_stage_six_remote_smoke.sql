BEGIN;

INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('c1000000-0000-4000-8000-000000000001','__stage6_remote_smoke__',1,20,20,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento) VALUES
 ('c2000000-0000-4000-8000-000000000001','__stage6_a__','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '1 day'),
 ('c2000000-0000-4000-8000-000000000002','__stage6_b__','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '1 day'),
 ('c2000000-0000-4000-8000-000000000003','__stage6_disabled__','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '1 day'),
 ('c2000000-0000-4000-8000-000000000004','__stage6_readonly__','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pendente',now()+interval '1 day'),
 ('c2000000-0000-4000-8000-000000000005','__stage6_inactive__','inativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '1 day'),
 ('c2000000-0000-4000-8000-000000000006','__stage6_no_entitlement__','ativo','c1000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '1 day');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
SELECT 'c2000000-0000-4000-8000-000000000007','__stage6_lifetime__','ativo',id,false,false,'isento',NULL
FROM public.planos WHERE periodicidade='vitalicio' AND ativo ORDER BY created_at LIMIT 1;

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000001','authenticated','authenticated','stage6-admin-a@example.test','',now(),'{}','{"full_name":"Stage6 Admin A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000002','authenticated','authenticated','stage6-user-a@example.test','',now(),'{}','{"full_name":"Stage6 User A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000003','authenticated','authenticated','stage6-admin-b@example.test','',now(),'{}','{"full_name":"Stage6 Admin B"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000004','authenticated','authenticated','stage6-disabled@example.test','',now(),'{}','{"full_name":"Stage6 Disabled"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000005','authenticated','authenticated','stage6-readonly@example.test','',now(),'{}','{"full_name":"Stage6 Readonly"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000006','authenticated','authenticated','stage6-inactive@example.test','',now(),'{}','{"full_name":"Stage6 Inactive"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000007','authenticated','authenticated','stage6-no-entitlement@example.test','',now(),'{}','{"full_name":"Stage6 No Entitlement"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000008','authenticated','authenticated','stage6-lifetime@example.test','',now(),'{}','{"full_name":"Stage6 Lifetime"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3000000-0000-4000-8000-000000000009','authenticated','authenticated','stage6-master@example.test','',now(),'{}','{"full_name":"Stage6 Master"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN (
 'c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000003',
 'c3000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000005',
 'c3000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000007',
 'c3000000-0000-4000-8000-000000000008');
UPDATE public.user_roles SET role='master_admin' WHERE user_id='c3000000-0000-4000-8000-000000000009';
UPDATE public.profiles SET empresa_id=CASE user_id
 WHEN 'c3000000-0000-4000-8000-000000000001'::uuid THEN 'c2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000002'::uuid THEN 'c2000000-0000-4000-8000-000000000001'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000003'::uuid THEN 'c2000000-0000-4000-8000-000000000002'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000004'::uuid THEN 'c2000000-0000-4000-8000-000000000003'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000005'::uuid THEN 'c2000000-0000-4000-8000-000000000004'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000006'::uuid THEN 'c2000000-0000-4000-8000-000000000005'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000007'::uuid THEN 'c2000000-0000-4000-8000-000000000006'::uuid
 WHEN 'c3000000-0000-4000-8000-000000000008'::uuid THEN 'c2000000-0000-4000-8000-000000000007'::uuid END
WHERE user_id BETWEEN 'c3000000-0000-4000-8000-000000000001' AND 'c3000000-0000-4000-8000-000000000008';

INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('c2000000-0000-4000-8000-000000000001'::uuid),('c2000000-0000-4000-8000-000000000002'::uuid),
 ('c2000000-0000-4000-8000-000000000003'::uuid),('c2000000-0000-4000-8000-000000000004'::uuid),
 ('c2000000-0000-4000-8000-000000000005'::uuid),('c2000000-0000-4000-8000-000000000006'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='gestao_materiais';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('c2000000-0000-4000-8000-000000000001'::uuid),('c2000000-0000-4000-8000-000000000002'::uuid),
 ('c2000000-0000-4000-8000-000000000004'::uuid),('c2000000-0000-4000-8000-000000000005'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='etiquetas_materiais';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT 'c2000000-0000-4000-8000-000000000003',id,'inactive',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key='etiquetas_materiais';

INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Stage6 A'),
 ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Stage6 B');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,identificador_unico,codigo_barras,tipo_identificacao,conteudo_qr_code,identificacao_gerada_em,status_identificacao,nome,tipo_controle,status_operacional,ativo) VALUES
 ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','STAGE6-A','c6000000-0000-4000-8000-000000000001','BSP-STAGE6-A','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000001',now(),'ativa','Stage6 Material A','individual','disponivel',true),
 ('c5000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002','STAGE6-B','c6000000-0000-4000-8000-000000000002','BSP-STAGE6-B','ambos','BACKSTAGE-PRO:MATERIAL:c6000000-0000-4000-8000-000000000002',now(),'ativa','Stage6 Material B','individual','disponivel',true);

CREATE TEMP TABLE stage6_smoke_ids(name text PRIMARY KEY,id uuid NOT NULL);
GRANT ALL ON stage6_smoke_ids TO authenticated;

SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO stage6_smoke_ids SELECT 'model_a',(public.salvar_modelo_etiqueta('Remote Smoke A',60,40,'ambos','["nome","codigo_interno"]',10,false,NULL,true,NULL,NULL,'c2000000-0000-4000-8000-000000000001')->>'id')::uuid;
INSERT INTO stage6_smoke_ids SELECT 'print_a',(public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_smoke_ids WHERE name='model_a'),'c5000000-0000-4000-8000-000000000001',2,'c7000000-0000-4000-8000-000000000001',NULL,'c2000000-0000-4000-8000-000000000001')->>'id')::uuid;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000001')) <> 1 THEN RAISE EXCEPTION 'admin A list failed'; END IF;
  IF (SELECT count(*) FROM public.listar_historico_impressoes_etiqueta(1,20,NULL,'c2000000-0000-4000-8000-000000000001')) <> 1 THEN RAISE EXCEPTION 'history failed'; END IF;
  IF (SELECT material_snapshot->>'nome' FROM public.etiqueta_impressoes WHERE id=(SELECT id FROM stage6_smoke_ids WHERE name='print_a')) <> 'Stage6 Material A' THEN RAISE EXCEPTION 'snapshot failed'; END IF;
  BEGIN
    PERFORM public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM stage6_smoke_ids WHERE name='model_a'),'c5000000-0000-4000-8000-000000000002',1,'c7000000-0000-4000-8000-000000000002',NULL,'c2000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'cross-company material was accepted';
  EXCEPTION WHEN SQLSTATE 'LB005' THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
INSERT INTO stage6_smoke_ids SELECT 'model_b',(public.salvar_modelo_etiqueta('Remote Smoke B',50,30,'qr_code','["nome"]',9,false,NULL,true,NULL,NULL,'c2000000-0000-4000-8000-000000000002')->>'id')::uuid;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000002')) <> 1 THEN RAISE EXCEPTION 'admin B list failed'; END IF;
  BEGIN
    PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'company B accessed company A';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000001')) <> 1 THEN RAISE EXCEPTION 'ordinary user read failed'; END IF;
  BEGIN
    PERFORM public.salvar_modelo_etiqueta('Forbidden',50,30,'qr_code','["nome"]',9,false,NULL,false,NULL,NULL,'c2000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'ordinary user write accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000004',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'inactive module accepted'; EXCEPTION WHEN SQLSTATE 'LB009' THEN NULL; END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000005',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000004'); BEGIN PERFORM public.salvar_modelo_etiqueta('Readonly',50,30,'qr_code','["nome"]',9,false,NULL,false,NULL,NULL,'c2000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'readonly write accepted'; EXCEPTION WHEN SQLSTATE 'LB010' THEN NULL; END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000006',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000005'); BEGIN PERFORM public.salvar_modelo_etiqueta('Inactive',50,30,'qr_code','["nome"]',9,false,NULL,false,NULL,NULL,'c2000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'inactive company write accepted'; EXCEPTION WHEN SQLSTATE 'LB010' THEN NULL; END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000007',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000006'); RAISE EXCEPTION 'no entitlement accepted'; EXCEPTION WHEN SQLSTATE 'LB009' THEN NULL; END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000008',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000007'); END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000009',true); SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.listar_modelos_etiqueta(NULL); RAISE EXCEPTION 'master without company accepted'; EXCEPTION WHEN SQLSTATE 'LB011' THEN NULL; END; PERFORM public.listar_modelos_etiqueta('c2000000-0000-4000-8000-000000000001'); END $$;
RESET ROLE;

UPDATE public.materiais SET nome='Stage6 Material A changed' WHERE id='c5000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT material_snapshot->>'nome' FROM public.etiqueta_impressoes WHERE id=(SELECT id FROM stage6_smoke_ids WHERE name='print_a')) <> 'Stage6 Material A' THEN RAISE EXCEPTION 'snapshot changed with material'; END IF;
  BEGIN UPDATE public.etiqueta_impressoes SET quantidade=99 WHERE id=(SELECT id FROM stage6_smoke_ids WHERE name='print_a'); RAISE EXCEPTION 'history update accepted'; EXCEPTION WHEN SQLSTATE 'LB014' THEN NULL; END;
END $$;

ROLLBACK;
SELECT 'stage6 remote transactional smoke PASS' AS result;
