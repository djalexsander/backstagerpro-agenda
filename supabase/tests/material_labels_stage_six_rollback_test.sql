\set ON_ERROR_STOP on
BEGIN;
\ir ../migrations/20260804090000_material_labels_printing_stage_six.sql
DO $$
BEGIN
  IF to_regclass('public.etiqueta_modelos') IS NULL
     OR to_regprocedure('public.registrar_solicitacao_impressao_etiqueta(uuid,uuid,integer,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6 objects were not created inside rollback transaction';
  END IF;
END;
$$;
ROLLBACK;
DO $$
BEGIN
  IF to_regclass('public.etiqueta_modelos') IS NOT NULL
     OR to_regclass('public.etiqueta_impressoes') IS NOT NULL
     OR to_regprocedure('public.registrar_solicitacao_impressao_etiqueta(uuid,uuid,integer,uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 6 objects survived transactional rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.module_catalog WHERE feature_key='etiquetas_materiais' AND ativo) THEN
    RAISE EXCEPTION 'Stage 6 module activation survived rollback';
  END IF;
END;
$$;
SELECT 'stage6 rollback PASS' AS result;
