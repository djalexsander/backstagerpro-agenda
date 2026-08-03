\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
BEGIN;
SELECT id FROM public.transicionar_ordem_manutencao((SELECT id FROM public.stage5_concurrency_ids WHERE name='closing'),'concluida','a3000000-0000-4000-8000-000000000007',(SELECT version FROM public.stage5_concurrency_ids WHERE name='closing'),NULL,NULL,'72000000-0000-4000-8000-000000000001');
SELECT pg_sleep(2);
COMMIT;
