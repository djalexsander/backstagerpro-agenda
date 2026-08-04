\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
SELECT public.registrar_solicitacao_impressao_etiqueta(
 (SELECT id FROM public.stage6_test_ids WHERE name='model'),
 'b5000000-0000-4000-8000-000000000001',3,
 'b7000000-0000-4000-8000-000000000061',NULL,
 'b2000000-0000-4000-8000-000000000001');
RESET ROLE;
