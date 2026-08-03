\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
BEGIN;
SELECT id FROM public.criar_ordem_manutencao('a1000000-0000-4000-8000-000000000001','corretiva','alta','manual','Sessão A','a3000000-0000-4000-8000-000000000001',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'72000000-0000-4000-8000-000000000001');
SELECT pg_sleep(2);
COMMIT;
