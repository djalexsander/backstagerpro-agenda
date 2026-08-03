\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
SELECT id FROM public.criar_ordem_manutencao('a1000000-0000-4000-8000-000000000001','preventiva','normal','preventiva','Sessão B','a3000000-0000-4000-8000-000000000002',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,90,NULL,'72000000-0000-4000-8000-000000000001');
