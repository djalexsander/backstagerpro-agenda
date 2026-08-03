\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
SELECT public.confirmar_reserva_locacao_material((SELECT id FROM public.stage5_concurrency_ids WHERE name='rental'),'a3000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001');
