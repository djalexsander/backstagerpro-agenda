\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
SELECT public.registrar_solicitacao_impressao_lote_etiquetas(
 (SELECT id FROM public.stage61_concurrency_ids WHERE name='model'),
 '[{"material_id":"d5000000-0000-4000-8000-000000000001","quantidade":10},{"material_id":"d5000000-0000-4000-8000-000000000002","quantidade":4},{"material_id":"d5000000-0000-4000-8000-000000000003","quantidade":8}]',
 'd7000000-0000-4000-8000-000000000001',NULL,NULL,'d2000000-0000-4000-8000-000000000001');
