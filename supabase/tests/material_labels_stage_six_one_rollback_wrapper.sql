\set ON_ERROR_STOP on
BEGIN;
\ir ../migrations/20260804120000_material_labels_stage_six_multi_material_fix.sql
ROLLBACK;
