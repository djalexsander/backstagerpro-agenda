BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Structure, modular contract and least privilege.
SELECT has_table('public', 'clientes', 'canonical customer table exists');
SELECT has_table('public', 'material_locacoes', 'rental header exists');
SELECT has_table('public', 'material_locacao_itens', 'rental item table exists');
SELECT has_table('public', 'material_locacao_eventos', 'append-only rental history exists');
SELECT has_type('public', 'customer_person_type', 'PF/PJ customer enum exists');
SELECT has_type('public', 'material_rental_status', 'rental state enum exists');
SELECT has_type('public', 'material_rental_billing_mode', 'billing mode enum exists');
-- Signature grew in 20260806090000 (payment condition parameters, defined
-- in the same flow that confirms the reservation) - the 3-arg overload was
-- explicitly DROPped there, so this now asserts the canonical 6-arg facade.
SELECT has_function('public', 'confirmar_reserva_locacao_material', ARRAY['uuid','uuid','uuid','text','date','jsonb'], 'transactional reservation facade exists');
SELECT has_function('public', 'registrar_retirada_locacao_material', ARRAY['uuid','uuid','integer','uuid','text','uuid','text','uuid','timestamp with time zone','text','uuid'], 'rental checkout facade exists');
SELECT has_function('public', 'registrar_devolucao_locacao_material', ARRAY['uuid','uuid','integer','uuid','text','uuid','text','text','timestamp with time zone','uuid'], 'rental checkin facade exists');
SELECT ok((SELECT ativo FROM public.module_catalog WHERE feature_key = 'locacao_materiais'), 'rental module is released');
SELECT ok(NOT (SELECT metadata ? 'planned' FROM public.module_catalog WHERE feature_key = 'locacao_materiais'), 'rental module is no longer planned');
SELECT is((SELECT count(*) FROM public.module_dependencies d JOIN public.module_catalog child ON child.id=d.module_id JOIN public.module_catalog parent ON parent.id=d.required_module_id WHERE child.feature_key='locacao_materiais' AND parent.feature_key IN ('gestao_materiais','controle_estoque','checkin_checkout')), 3::bigint, 'rental declares all three canonical dependencies');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.clientes'::regclass), 'customers have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.material_locacoes'::regclass), 'rentals have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.material_locacao_itens'::regclass), 'rental items have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.material_locacao_eventos'::regclass), 'rental history has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.material_locacoes','INSERT') AND NOT has_table_privilege('authenticated','public.material_locacoes','UPDATE') AND NOT has_table_privilege('authenticated','public.material_locacoes','DELETE'), 'authenticated cannot mutate rentals directly');
SELECT ok(NOT has_table_privilege('authenticated','public.material_locacao_eventos','INSERT') AND NOT has_table_privilege('authenticated','public.material_locacao_eventos','UPDATE') AND NOT has_table_privilege('authenticated','public.material_locacao_eventos','DELETE'), 'authenticated cannot mutate rental history directly');
SELECT is((SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('material_locacoes','material_locacao_itens') AND column_name IN ('saldo','quantidade_disponivel','quantidade_em_estoque')), 0::bigint, 'rentals do not persist a parallel stock balance');
SELECT ok(pg_get_functiondef('public.material_rental_availability(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure) ILIKE '%estoque_saldos%' AND pg_get_functiondef('public.material_rental_availability(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure) ILIKE '%tstzrange%' AND pg_get_functiondef('public.material_rental_availability(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure) ILIKE '%[)%', 'availability derives physical balance and half-open overlapping reservations');
SELECT ok(pg_get_functiondef('public.confirmar_reserva_locacao_material(uuid,uuid,uuid,text,date,jsonb)'::regprocedure) ILIKE '%pg_advisory_xact_lock%' AND pg_get_functiondef('public.confirmar_reserva_locacao_material(uuid,uuid,uuid,text,date,jsonb)'::regprocedure) ILIKE '%ORDER BY material_id%', 'confirmation serializes materials in stable order');
SELECT ok(pg_get_functiondef('public.registrar_retirada_locacao_material(uuid,uuid,integer,uuid,text,uuid,text,uuid,timestamp with time zone,text,uuid)'::regprocedure) ILIKE '%registrar_checkout_material%' AND pg_get_functiondef('public.registrar_devolucao_locacao_material(uuid,uuid,integer,uuid,text,uuid,text,text,timestamp with time zone,uuid)'::regprocedure) ILIKE '%registrar_checkin_material%', 'physical operations delegate to Stage 3 custody facades');
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('resolve_material_rental_company','protect_material_rental_history','next_material_rental_number','material_rental_item_operational_totals','material_rental_availability','recalculate_material_rental_totals') AND has_function_privilege('authenticated',p.oid,'EXECUTE')), 0::bigint, 'internal rental helpers are not executable by authenticated');
SELECT ok(has_function_privilege('authenticated','public.confirmar_reserva_locacao_material(uuid,uuid,uuid,text,date,jsonb)','EXECUTE') AND has_function_privilege('authenticated','public.obter_locacao_material(uuid,uuid)','EXECUTE'), 'authenticated executes only the public rental facade');

-- Multi-company fixtures, entirely rolled back.
INSERT INTO public.planos (id,nome,valor,max_usuarios,max_eventos,ativo,periodicidade,categoria)
VALUES ('81000000-0000-4000-8000-000000000001','__rental_plan__',100,20,100,true,'mensal','plano_base');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
VALUES
 ('82000000-0000-4000-8000-000000000001','__rental_a__','ativo','81000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('82000000-0000-4000-8000-000000000002','__rental_b__','ativo','81000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('82000000-0000-4000-8000-000000000003','__rental_disabled__','ativo','81000000-0000-4000-8000-000000000001',false,false,'pago',now()+interval '30 days'),
 ('82000000-0000-4000-8000-000000000004','__rental_readonly__','ativo','81000000-0000-4000-8000-000000000001',false,false,'pendente',now()+interval '30 days');
INSERT INTO public.empresas (id,nome_empresa,status,plano_id,plano_bloqueado,precisa_escolher_plano,status_pagamento,vencimento)
SELECT '82000000-0000-4000-8000-000000000005','__rental_lifetime__','ativo',id,false,false,'isento',NULL FROM public.planos WHERE nome='Vitalícia' AND periodicidade='vitalicio';

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000001','authenticated','authenticated','rental-admin-a@example.test','',now(),'{}','{"full_name":"Rental Admin A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000002','authenticated','authenticated','rental-user-a@example.test','',now(),'{}','{"full_name":"Rental User A"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000003','authenticated','authenticated','rental-admin-b@example.test','',now(),'{}','{"full_name":"Rental Admin B"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000004','authenticated','authenticated','rental-disabled@example.test','',now(),'{}','{"full_name":"Rental Disabled"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000005','authenticated','authenticated','rental-readonly@example.test','',now(),'{}','{"full_name":"Rental Readonly"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000006','authenticated','authenticated','rental-lifetime@example.test','',now(),'{}','{"full_name":"Rental Lifetime"}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000007','authenticated','authenticated','rental-master@example.test','',now(),'{}','{"full_name":"Rental Master"}',now(),now());
UPDATE public.user_roles SET role='admin_empresa' WHERE user_id IN ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000006');
UPDATE public.user_roles SET role='master_admin' WHERE user_id='83000000-0000-4000-8000-000000000007';
UPDATE public.profiles SET empresa_id=CASE user_id
 WHEN '83000000-0000-4000-8000-000000000001'::uuid THEN '82000000-0000-4000-8000-000000000001'::uuid
 WHEN '83000000-0000-4000-8000-000000000002'::uuid THEN '82000000-0000-4000-8000-000000000001'::uuid
 WHEN '83000000-0000-4000-8000-000000000003'::uuid THEN '82000000-0000-4000-8000-000000000002'::uuid
 WHEN '83000000-0000-4000-8000-000000000004'::uuid THEN '82000000-0000-4000-8000-000000000003'::uuid
 WHEN '83000000-0000-4000-8000-000000000005'::uuid THEN '82000000-0000-4000-8000-000000000004'::uuid
 WHEN '83000000-0000-4000-8000-000000000006'::uuid THEN '82000000-0000-4000-8000-000000000005'::uuid END
WHERE user_id BETWEEN '83000000-0000-4000-8000-000000000001'::uuid AND '83000000-0000-4000-8000-000000000006'::uuid;

-- Dependencies must be activated in canonical order. Disabled omits rentals.
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('82000000-0000-4000-8000-000000000001'::uuid),('82000000-0000-4000-8000-000000000002'::uuid),
 ('82000000-0000-4000-8000-000000000003'::uuid),('82000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='gestao_materiais';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('82000000-0000-4000-8000-000000000001'::uuid),('82000000-0000-4000-8000-000000000002'::uuid),
 ('82000000-0000-4000-8000-000000000003'::uuid),('82000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='controle_estoque';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('82000000-0000-4000-8000-000000000001'::uuid),('82000000-0000-4000-8000-000000000002'::uuid),
 ('82000000-0000-4000-8000-000000000003'::uuid),('82000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='checkin_checkout';
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT company.id,catalog.id,'active',now(),true,'manual_admin' FROM (VALUES
 ('82000000-0000-4000-8000-000000000001'::uuid),('82000000-0000-4000-8000-000000000002'::uuid),
 ('82000000-0000-4000-8000-000000000004'::uuid)
) company(id) CROSS JOIN public.module_catalog catalog WHERE catalog.feature_key='locacao_materiais';

SELECT ok(public.company_has_active_module('82000000-0000-4000-8000-000000000005','locacao_materiais'), 'Lifetime receives rentals through canonical entitlement');

INSERT INTO public.categorias_materiais (id,empresa_id,nome) VALUES
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Rental A'),
 ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','Rental B'),
 ('84000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','Rental Disabled'),
 ('84000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','Rental Readonly'),
 ('84000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','Rental Lifetime');
INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,nome,tipo_controle,status_operacional,ativo,valor_locacao_padrao) VALUES
 ('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','RENT-QTY-A','Cadeira','quantidade','disponivel',true,10),
 ('85000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','RENT-IND-A','Console individual','individual','disponivel',true,100),
 ('85000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','RENT-QTY-B','Cadeira B','quantidade','disponivel',true,10),
 ('85000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','RENT-DISABLED','Disabled','quantidade','disponivel',true,10),
 ('85000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000004','84000000-0000-4000-8000-000000000004','RENT-READONLY','Readonly','quantidade','disponivel',true,10),
 ('85000000-0000-4000-8000-000000000006','82000000-0000-4000-8000-000000000005','84000000-0000-4000-8000-000000000005','RENT-LIFETIME','Lifetime','quantidade','disponivel',true,10);
INSERT INTO public.estoque_localizacoes (id,empresa_id,codigo,nome,ativa) VALUES
 ('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','A','Depósito A',true),
 ('86000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','B','Depósito B',true),
 ('86000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','D','Depósito D',true),
 ('86000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','R','Depósito R',true),
 ('86000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','L','Depósito L',true);
INSERT INTO public.estoque_saldos (empresa_id,material_id,localizacao_id,quantidade) VALUES
 ('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',20),
 ('82000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000002','86000000-0000-4000-8000-000000000001',1),
 ('82000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000003','86000000-0000-4000-8000-000000000002',10),
 ('82000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000004','86000000-0000-4000-8000-000000000003',10),
 ('82000000-0000-4000-8000-000000000004','85000000-0000-4000-8000-000000000005','86000000-0000-4000-8000-000000000004',10),
 ('82000000-0000-4000-8000-000000000005','85000000-0000-4000-8000-000000000006','86000000-0000-4000-8000-000000000005',10);
INSERT INTO public.funcionarios (id,empresa_id,nome,funcao) VALUES
 ('87000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Operador A','Técnico'),
 ('87000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','Operador B','Técnico'),
 ('87000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','Operador D','Técnico'),
 ('87000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','Operador R','Técnico'),
 ('87000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','Operador L','Técnico');
INSERT INTO public.clientes (id,empresa_id,tipo_pessoa,nome,ativo,created_by,updated_by) VALUES
 ('88000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','pessoa_fisica','Cliente A',true,'83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','pessoa_juridica','Cliente B',true,'83000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003'),
 ('88000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','pessoa_fisica','Cliente D',true,'83000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000004'),
 ('88000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','pessoa_fisica','Cliente R',true,'83000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000005'),
 ('88000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','pessoa_fisica','Cliente L',true,'83000000-0000-4000-8000-000000000006','83000000-0000-4000-8000-000000000006');

CREATE TEMP TABLE stage4_ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT ALL ON stage4_ids TO authenticated;

-- Administrator A: reservation, overlap and half-open boundary.
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SET LOCAL search_path = public, extensions;
INSERT INTO stage4_ids SELECT 'rental_a',id FROM public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-08-10 10:00Z','2026-08-12 10:00Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000001',NULL,'principal','82000000-0000-4000-8000-000000000001');
SELECT ok((SELECT numero FROM public.material_locacoes WHERE id=(SELECT id FROM stage4_ids WHERE name='rental_a')) LIKE 'LOC-2026-%','friendly numbering is scoped by company/year');
SELECT lives_ok(format('SELECT public.salvar_item_locacao_material(%L,%L,15,%L,1,10,5,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),'85000000-0000-4000-8000-000000000001','unidade','89000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001'),'quantitative rental item can be drafted');
SELECT is((SELECT valor_total FROM public.material_locacoes WHERE id=(SELECT id FROM stage4_ids WHERE name='rental_a')),145::numeric,'commercial total is recalculated from items');
SELECT lives_ok(format('SELECT public.confirmar_reserva_locacao_material(%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),'89000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001'),'simple reservation confirms');
SELECT is((SELECT (item->>'reservado')::bigint FROM public.buscar_materiais_disponiveis_locacao('RENT-QTY-A','2026-08-11Z','2026-08-11 12:00Z',NULL,10,'82000000-0000-4000-8000-000000000001')),15::bigint,'overlapping reservation is subtracted commercially');
SELECT is((SELECT (item->>'disponivel')::bigint FROM public.buscar_materiais_disponiveis_locacao('RENT-QTY-A','2026-08-12 10:00Z','2026-08-13 10:00Z',NULL,10,'82000000-0000-4000-8000-000000000001')),20::bigint,'same-time return/withdrawal boundary does not overlap');

INSERT INTO stage4_ids SELECT 'conflict',id FROM public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-08-11 10:00Z','2026-08-13 10:00Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000004',NULL,NULL,'82000000-0000-4000-8000-000000000001');
SELECT throws_ok(format('SELECT public.salvar_item_locacao_material(%L,%L,10,%L,1,10,0,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='conflict'),'85000000-0000-4000-8000-000000000001','unidade','89000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000001'),'LR012','Disponibilidade insuficiente no período. Disponível: 5.','overlapping quantity overbooking is blocked');

INSERT INTO stage4_ids SELECT 'individual_a',id FROM public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-08-10 10:00Z','2026-08-12 10:00Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000006',NULL,NULL,'82000000-0000-4000-8000-000000000001');
SELECT lives_ok(format('SELECT public.salvar_item_locacao_material(%L,%L,1,%L,1,100,0,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='individual_a'),'85000000-0000-4000-8000-000000000002','fixo','89000000-0000-4000-8000-000000000007','82000000-0000-4000-8000-000000000001'),'individual item accepts exactly one');
SELECT throws_ok(format('SELECT public.salvar_item_locacao_material(%L,%L,2,%L,1,100,0,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='individual_a'),'85000000-0000-4000-8000-000000000002','fixo','89000000-0000-4000-8000-000000000008','82000000-0000-4000-8000-000000000001'),'LR002','Material individual deve ter quantidade um.','individual material rejects quantity above one');
SELECT lives_ok(format('SELECT public.confirmar_reserva_locacao_material(%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='individual_a'),'89000000-0000-4000-8000-000000000009','82000000-0000-4000-8000-000000000001'),'individual reservation confirms');

-- Idempotent retry does not duplicate rental or confirmation history.
SELECT lives_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-08-10 10:00Z','2026-08-12 10:00Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000001',NULL,'principal','82000000-0000-4000-8000-000000000001')$test$,'creation retry returns original rental');
SELECT is((SELECT count(*) FROM public.material_locacoes WHERE empresa_id='82000000-0000-4000-8000-000000000001' AND client_uuid='89000000-0000-4000-8000-000000000001'),1::bigint,'creation idempotency prevents duplicates');
SELECT lives_ok(format('SELECT public.confirmar_reserva_locacao_material(%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),'89000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001'),'confirmation retry returns safely');
SELECT is((SELECT count(*) FROM public.material_locacao_eventos WHERE empresa_id='82000000-0000-4000-8000-000000000001' AND client_uuid='89000000-0000-4000-8000-000000000003'),1::bigint,'confirmation history remains singular');

-- Partial checkout and return are delegated atomically to Stage 3.
SELECT lives_ok(format('SELECT public.registrar_retirada_locacao_material(%L,%L,12,%L,%L,%L,%L,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),(SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM stage4_ids WHERE name='rental_a')),'86000000-0000-4000-8000-000000000001','funcionario','87000000-0000-4000-8000-000000000001','bom','89000000-0000-4000-8000-000000000010','82000000-0000-4000-8000-000000000001'),'partial rental checkout succeeds');
SELECT is((SELECT quantidade FROM public.estoque_saldos WHERE material_id='85000000-0000-4000-8000-000000000001'),8,'checkout debits official estoque_saldos');
SELECT is((SELECT quantidade FROM public.materiais WHERE id='85000000-0000-4000-8000-000000000001'),8,'material quantity remains only the stock projection');
SELECT is((SELECT sum(quantidade_retirada)::bigint FROM public.material_custodias WHERE referencia_tipo='locacao_item' AND referencia_id=(SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM stage4_ids WHERE name='rental_a'))),12::bigint,'rental derives withdrawn quantity from custody');
SELECT lives_ok(format('SELECT public.registrar_retirada_locacao_material(%L,%L,3,%L,%L,%L,%L,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),(SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM stage4_ids WHERE name='rental_a')),'86000000-0000-4000-8000-000000000001','funcionario','87000000-0000-4000-8000-000000000001','bom','89000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000001'),'remaining checkout completes contracted quantity');
SELECT throws_ok(format('SELECT public.cancelar_locacao_material(%L,%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),'invalid after checkout','89000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000001'),'LR014','A locação não pode ser cancelada neste estado.','rental with material outside cannot be administratively cancelled');
INSERT INTO stage4_ids SELECT 'custody_a',id FROM public.material_custodias WHERE referencia_tipo='locacao_item' AND referencia_id=(SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM stage4_ids WHERE name='rental_a')) ORDER BY retirada_em,id LIMIT 1;
SELECT lives_ok(format('SELECT public.registrar_devolucao_locacao_material(%L,%L,8,%L,%L,%L,NULL,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),(SELECT id FROM stage4_ids WHERE name='custody_a'),'86000000-0000-4000-8000-000000000001','bom','89000000-0000-4000-8000-000000000013','82000000-0000-4000-8000-000000000001'),'partial return succeeds');
SELECT is((SELECT quantidade_retirada-quantidade_devolvida FROM public.material_custodias WHERE id=(SELECT id FROM stage4_ids WHERE name='custody_a')),4,'partial return leaves the correct custody projection');
SELECT lives_ok(format('SELECT public.registrar_devolucao_locacao_material(%L,%L,4,%L,%L,%L,NULL,%L,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='rental_a'),(SELECT id FROM stage4_ids WHERE name='custody_a'),'86000000-0000-4000-8000-000000000001','com_avaria','89000000-0000-4000-8000-000000000014','Avaria registrada','82000000-0000-4000-8000-000000000001'),'total return preserves occurrence in custody history');
SELECT is((SELECT quantidade FROM public.estoque_saldos WHERE material_id='85000000-0000-4000-8000-000000000001'),17,'returns credit only the official stock ledger');
SELECT ok(EXISTS(SELECT 1 FROM public.material_custodia_eventos WHERE custodia_id=(SELECT id FROM stage4_ids WHERE name='custody_a') AND ocorrencia='Avaria registrada'),'damage information remains in Stage 3 custody');

-- Cancellation releases a future reservation without deleting history.
INSERT INTO stage4_ids SELECT 'cancel_a',id FROM public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-09-01Z','2026-09-03Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000015',NULL,NULL,'82000000-0000-4000-8000-000000000001');
SELECT lives_ok(format('SELECT public.salvar_item_locacao_material(%L,%L,10,%L,1,10,0,%L,NULL,NULL,%L)',(SELECT id FROM stage4_ids WHERE name='cancel_a'),'85000000-0000-4000-8000-000000000001','unidade','89000000-0000-4000-8000-000000000016','82000000-0000-4000-8000-000000000001'),'future cancellable item succeeds');
SELECT lives_ok(format('SELECT public.confirmar_reserva_locacao_material(%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='cancel_a'),'89000000-0000-4000-8000-000000000017','82000000-0000-4000-8000-000000000001'),'future reservation confirms');
SELECT lives_ok(format('SELECT public.cancelar_locacao_material(%L,%L,%L,%L)',(SELECT id FROM stage4_ids WHERE name='cancel_a'),'Cliente desistiu','89000000-0000-4000-8000-000000000018','82000000-0000-4000-8000-000000000001'),'clean reservation cancels');
SELECT is((SELECT status::text FROM public.material_locacoes WHERE id=(SELECT id FROM stage4_ids WHERE name='cancel_a')),'cancelada','cancellation preserves header with cancelled state');
SELECT is((SELECT (item->>'reservado')::bigint FROM public.buscar_materiais_disponiveis_locacao('RENT-QTY-A','2026-09-01Z','2026-09-02Z',NULL,10,'82000000-0000-4000-8000-000000000001')),0::bigint,'cancelled rental releases future reservation');
RESET ROLE;
SELECT throws_ok(format('UPDATE public.material_locacao_eventos SET descricao=%L WHERE locacao_id=%L','tamper',(SELECT id FROM stage4_ids WHERE name='cancel_a')),'LR019','O histórico da locação é imutável.','rental history is append-only');
SELECT throws_ok($test$UPDATE public.estoque_movimentacoes SET motivo='tamper' WHERE origem_modulo='checkin_checkout'$test$,'ST019','O histórico de estoque é imutável.','canonical stock movement history remains immutable');

-- Cross-tenant references and RLS.
RESET ROLE;
SELECT throws_ok($test$INSERT INTO public.material_locacoes (empresa_id,cliente_id,numero,retirada_prevista_em,devolucao_prevista_em,responsavel_tipo,responsavel_funcionario_id,responsavel_nome,client_uuid,payload_hash,created_by,updated_by) VALUES ('82000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000002','CROSS','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000001','Operador','89000000-0000-4000-8000-000000000019','hash','83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')$test$,'23503',NULL,'cross-company customer reference is blocked');
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SET LOCAL search_path = public, extensions;
SELECT is((SELECT count(*) FROM public.material_locacoes WHERE empresa_id='82000000-0000-4000-8000-000000000002'),0::bigint,'company A cannot read company B rentals');
SELECT throws_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000002','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000020',NULL,NULL,'82000000-0000-4000-8000-000000000001')$test$,'LR005','Cliente ativo não encontrado na empresa.','cross-company customer is rejected by facade');

-- Common user reads but cannot execute write facades through backend permission.
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000002',true);
SELECT ok((SELECT count(*) FROM public.material_locacoes)>0,'common user can read own company rentals');
SELECT throws_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000021',NULL,NULL,'82000000-0000-4000-8000-000000000001')$test$,'42501','Você não tem permissão para esta operação.','common user has no rental write authorization');

-- Disabled, read-only and Lifetime personas.
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000004',true);
SELECT throws_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000003','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000003','89000000-0000-4000-8000-000000000022',NULL,NULL,'82000000-0000-4000-8000-000000000003')$test$,'LR009','Locação e suas dependências precisam estar ativas.','disabled rental module fails closed');
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000005',true);
SELECT throws_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000004','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000004','89000000-0000-4000-8000-000000000023',NULL,NULL,'82000000-0000-4000-8000-000000000004')$test$,'LR010','A empresa está em modo somente leitura.','read-only company cannot create rentals');
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000006',true);
SELECT lives_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000005','2026-10-01Z','2026-10-02Z','funcionario','87000000-0000-4000-8000-000000000005','89000000-0000-4000-8000-000000000024',NULL,NULL,'82000000-0000-4000-8000-000000000005')$test$,'Lifetime company uses rentals without parallel activation rows');

RESET ROLE;

-- Master without a linked company has zero operational rental access,
-- whether or not it names another tenant explicitly (tenant isolation is
-- mandatory for master_admin too - see 20260808100000).
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000007',true);
SET LOCAL ROLE authenticated;
SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT count(*) FROM public.listar_locacoes_materiais(1,20,NULL,NULL,NULL,NULL,NULL,false,NULL,'82000000-0000-4000-8000-000000000001')$test$,'42501','Empresa inválida.','Master cannot read another company by naming it explicitly');
SELECT throws_ok($test$SELECT count(*) FROM public.listar_locacoes_materiais()$test$,'42501','Empresa inválida.','Master without a linked company cannot infer a rental tenant');
RESET ROLE;

-- Removing entitlement and deactivating a company both fail closed.
DELETE FROM public.empresa_modules WHERE empresa_id='82000000-0000-4000-8000-000000000002' AND module_id=(SELECT id FROM public.module_catalog WHERE feature_key='locacao_materiais');
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT count(*) FROM public.listar_locacoes_materiais(1,20,NULL,NULL,NULL,NULL,NULL,false,NULL,'82000000-0000-4000-8000-000000000002')$test$,'LR009','Locação e suas dependências precisam estar ativas.','company without rental entitlement fails closed');
RESET ROLE;
UPDATE public.empresas SET status='inativo' WHERE id='82000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SET LOCAL search_path=public,extensions;
SELECT throws_ok($test$SELECT public.criar_locacao_material('88000000-0000-4000-8000-000000000001','2026-11-01Z','2026-11-02Z','funcionario','87000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000025',NULL,NULL,'82000000-0000-4000-8000-000000000001')$test$,'LR010','A empresa está em modo somente leitura.','inactive company cannot mutate rentals');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
