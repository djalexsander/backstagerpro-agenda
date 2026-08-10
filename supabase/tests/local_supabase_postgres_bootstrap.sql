-- Minimal Supabase-owned objects needed to replay this repository's migrations
-- on a disposable, plain PostgreSQL instance. This is test infrastructure only;
-- it is not a production migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE TABLE auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud varchar(255),
  role varchar(255),
  email text,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    current_user
  )
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN strpos(_name, '/') = 0 THEN ARRAY[]::text[]
    ELSE string_to_array(regexp_replace(_name, '/[^/]*$', ''), '/')
  END
$$;

GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions
  TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth, storage TO service_role;
-- auth.* stays service_role-only above (auth.users must never be broadly
-- readable) - but storage.objects/storage.buckets are a real exception: on
-- an actual Supabase project the Storage extension grants these to
-- anon/authenticated as its own platform default, with RLS (see the
-- "TO authenticated" policies this repo defines on storage.objects, e.g.
-- 20260730023000_secure_event_file_storage.sql) as the real gate - exactly
-- the same shape as the public-schema default below. Without this, every
-- storage.objects query as authenticated/anon fails with "permission denied
-- for table objects" before RLS is even evaluated, regardless of policy.
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated;

-- Real Supabase projects grant these to anon/authenticated/service_role as a
-- platform default whenever a table is created in the public schema - it is
-- not something any migration in this repository sets explicitly (see
-- 20260807090000's own comment: no ALTER DEFAULT PRIVILEGES anywhere in the
-- repo). Tables from the original schema (events, financials, funcionarios,
-- event_days, event_funcionarios, event_checklist_items, document_templates,
-- generated_documents, backups...) rely entirely on this platform default
-- and never REVOKE/GRANT themselves at the table level. Later-stage tables
-- (clientes, material_custodias, estoque_localizacoes...) additionally issue
-- their own explicit REVOKE/GRANT on top of this baseline. Replaying
-- migrations on a disposable, plain PostgreSQL instance needs this baseline
-- reproduced by hand, or every original-schema table raises "permission
-- denied for table X" for anon/authenticated regardless of RLS or of any
-- app-level fix - this is test-harness fidelity, not an app privilege
-- change, and mirrors exactly what Supabase already does automatically on a
-- real project. Functions are deliberately not included here: Postgres
-- already grants EXECUTE to PUBLIC by default on CREATE FUNCTION with no
-- help needed - that default is the actual bug class fixed by
-- 20260808110000_harden_insecure_security_definer_functions.sql, and this
-- bootstrap must not paper over it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
