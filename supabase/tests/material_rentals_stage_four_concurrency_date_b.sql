\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.confirmar_reserva_locacao_material((SELECT id FROM public.stage4_concurrency_ids WHERE name='date_b'),'90000000-0000-4000-8000-000000000035','72000000-0000-4000-8000-000000000001');
COMMIT;
