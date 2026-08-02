\set ON_ERROR_STOP on

BEGIN;
\ir ../migrations/20260802160000_material_checkin_checkout_stage_three.sql

SELECT
  to_regclass('public.material_custodias') IS NOT NULL
    AS exists_inside_transaction;

ROLLBACK;

SELECT
  to_regclass('public.material_custodias') IS NULL
    AS absent_after_rollback,
  to_regprocedure(
    'public.registrar_checkout_material(uuid,integer,uuid,text,uuid,text,text,uuid,timestamp with time zone,text,text,uuid,timestamp with time zone,uuid)'
  ) IS NULL AS function_absent_after_rollback;
