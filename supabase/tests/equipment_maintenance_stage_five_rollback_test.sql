\set ON_ERROR_STOP on
BEGIN;
\ir ../migrations/20260802230000_equipment_maintenance_stage_five.sql
DO $$
BEGIN
  IF to_regclass('public.manutencao_ordens') IS NULL
     OR to_regprocedure('public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamptz,text,text,text,text,integer,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 5 objects were not created inside rollback transaction';
  END IF;
END;
$$;
ROLLBACK;
DO $$
BEGIN
  IF to_regclass('public.manutencao_ordens') IS NOT NULL
     OR to_regtype('public.equipment_maintenance_status') IS NOT NULL
     OR to_regprocedure('public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamptz,text,text,text,text,integer,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 5 objects survived transactional rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.module_catalog WHERE feature_key='manutencao_equipamentos' AND metadata @> '{"operational":true}'::jsonb) THEN
    RAISE EXCEPTION 'Stage 5 module activation survived rollback';
  END IF;
END;
$$;
SELECT 'stage5 rollback PASS' AS result;
