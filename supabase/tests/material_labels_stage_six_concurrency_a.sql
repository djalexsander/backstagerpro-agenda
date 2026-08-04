\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated; SET LOCAL search_path=public,extensions;
SELECT public.registrar_solicitacao_impressao_etiqueta((SELECT id FROM public.stage6_test_ids WHERE name='model'),'b5000000-0000-4000-8000-000000000001',5,'b7000000-0000-4000-8000-000000000002',NULL,'b2000000-0000-4000-8000-000000000001');
SELECT pg_sleep(2);
COMMIT;
