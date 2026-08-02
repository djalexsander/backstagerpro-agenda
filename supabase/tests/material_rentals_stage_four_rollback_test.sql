\set ON_ERROR_STOP on
BEGIN;
\ir ../migrations/20260802200000_material_rentals_stage_four.sql
DO $$
BEGIN
  IF to_regclass('public.material_locacoes') IS NULL THEN
    RAISE EXCEPTION 'Stage 4 table was not created inside transaction';
  END IF;
END;
$$;
ROLLBACK;
DO $$
BEGIN
  IF to_regclass('public.material_locacoes') IS NOT NULL
     OR to_regprocedure('public.confirmar_reserva_locacao_material(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 4 objects survived transaction rollback';
  END IF;
END;
$$;
SELECT 'stage4 migration transaction rollback: PASS' AS result;
