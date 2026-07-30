-- BLOCKED DESTRUCTIVE MIGRATION
--
-- The original migration deleted all operational and tenant data. It has been
-- preserved verbatim outside the executable migration directory at:
--   supabase/quarantined-migrations/
--     20260320160649_78bfca57-3082-4c13-a43b-cee62f8783e5.sql
--
-- Keep this timestamp in place. Supabase identifies migration history by the
-- version prefix, so this safe no-op works in both cases:
--   1. remote already applied it: the version remains aligned;
--   2. remote has not applied it: db push records the version without DELETEs.
--
-- Never restore the destructive statements here. Any exceptional data reset
-- must be reviewed and executed as a separately approved operational procedure.
DO $$
BEGIN
  RAISE NOTICE
    'Migration 20260320160649 is quarantined; destructive data reset skipped';
END;
$$;
