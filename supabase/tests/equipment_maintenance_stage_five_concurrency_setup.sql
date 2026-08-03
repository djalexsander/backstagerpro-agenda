\set ON_ERROR_STOP on
INSERT INTO public.empresa_modules (empresa_id,module_id,status,activated_at,granted_by_admin,origem)
SELECT '72000000-0000-4000-8000-000000000001',id,'active',now(),true,'manual_admin'
FROM public.module_catalog WHERE feature_key='manutencao_equipamentos'
;

INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,nome,tipo_controle,status_operacional,ativo) VALUES
 ('a1000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','M-CONC-OPEN','Concorrência abertura','individual','disponivel',true),
 ('a1000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','M-CONC-RENT','Concorrência reserva','individual','disponivel',true),
 ('a1000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','M-CONC-OUT','Concorrência checkout','individual','disponivel',true),
 ('a1000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','M-CONC-CLOSE','Concorrência encerramento','individual','disponivel',true);
INSERT INTO public.estoque_saldos (empresa_id,material_id,localizacao_id,quantidade) VALUES
 ('72000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',1),
 ('72000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000001',1),
 ('72000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','76000000-0000-4000-8000-000000000001',1),
 ('72000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000004','76000000-0000-4000-8000-000000000001',1);

CREATE TABLE public.stage5_concurrency_ids (name text PRIMARY KEY,id uuid NOT NULL,version timestamptz);
REVOKE ALL ON public.stage5_concurrency_ids FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE ON public.stage5_concurrency_ids TO authenticated;
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
INSERT INTO public.stage5_concurrency_ids(name,id)
SELECT 'rental',id FROM public.criar_locacao_material('90000000-0000-4000-8000-000000000001','2031-01-10Z','2031-01-12Z','funcionario','77000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',NULL,NULL,'72000000-0000-4000-8000-000000000001');
SELECT public.salvar_item_locacao_material((SELECT id FROM public.stage5_concurrency_ids WHERE name='rental'),'a1000000-0000-4000-8000-000000000002',1,'fixo',1,100,0,'a2000000-0000-4000-8000-000000000002',NULL,NULL,'72000000-0000-4000-8000-000000000001');
INSERT INTO public.stage5_concurrency_ids(name,id,version)
SELECT 'closing',id,updated_at FROM public.criar_ordem_manutencao('a1000000-0000-4000-8000-000000000004','corretiva','alta','manual','Falha','a2000000-0000-4000-8000-000000000003',1,'funcionario','77000000-0000-4000-8000-000000000001',NULL,NULL,NULL,'interna',NULL,NULL,NULL,'72000000-0000-4000-8000-000000000001');
UPDATE public.stage5_concurrency_ids SET version=(SELECT updated_at FROM public.atualizar_ordem_manutencao(id,'a2000000-0000-4000-8000-000000000004',version,'alta','Falha confirmada','Componente substituído','funcionario','77000000-0000-4000-8000-000000000001',NULL,'operacional',NULL,'interna',NULL,NULL,10,0,0,'72000000-0000-4000-8000-000000000001')) WHERE name='closing';
UPDATE public.stage5_concurrency_ids SET version=(SELECT updated_at FROM public.transicionar_ordem_manutencao(id,'em_manutencao','a2000000-0000-4000-8000-000000000005',version,NULL,NULL,'72000000-0000-4000-8000-000000000001')) WHERE name='closing';
RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
