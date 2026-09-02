\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','67300000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.generate_material_barcode('67500000-0000-4000-8000-000000000002');
COMMIT;
