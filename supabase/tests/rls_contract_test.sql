BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(15);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_class AS table_definition
    JOIN pg_catalog.pg_namespace AS table_schema
      ON table_schema.oid = table_definition.relnamespace
    WHERE table_schema.nspname = 'public'
      AND table_definition.relname = ANY (ARRAY[
        'events',
        'event_days',
        'event_files',
        'financials',
        'funcionarios',
        'event_funcionarios',
        'event_checklist_items',
        'document_templates',
        'generated_documents',
        'backups',
        'empresa_modules',
        'empresa_usuarios'
      ])
      AND table_definition.relrowsecurity
  ),
  12::bigint,
  'RLS is enabled on every tenant-sensitive operational table'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'events',
        'event_days',
        'event_files',
        'financials',
        'funcionarios',
        'event_funcionarios',
        'event_checklist_items',
        'document_templates',
        'generated_documents',
        'backups',
        'empresa_modules',
        'empresa_usuarios'
      ])
      AND (
        'anon' = ANY (roles)
        OR 'public' = ANY (roles)
      )
  ),
  0::bigint,
  'sensitive tenant policies are never granted to anon or public'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND cmd = 'SELECT'
      AND qual ILIKE '%can_read_company_data%empresa_id%'
  ),
  'event reads are tenant-scoped'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_data%empresa_id%'
  ),
  'event creation requires an active writable tenant'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_days'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_data%'
      AND with_check ILIKE '%event_belongs_to_company%'
  ),
  'event-day creation validates the event parent tenant'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_files'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%event_belongs_to_company%'
      AND with_check ILIKE '%event_day_belongs_to_event%'
  ),
  'event-file metadata validates both tenant parent relationships'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financials'
      AND cmd = 'SELECT'
      AND qual ILIKE '%admin_empresa%'
      AND qual ILIKE '%financeiro_avancado%'
  ),
  'financial reads require a tenant administrator and the finance module'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financials'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_module%'
      AND with_check ILIKE '%financeiro_avancado%'
      AND with_check ILIKE '%event_belongs_to_company%'
  ),
  'financial writes require the module and an event from the same tenant'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'event_checklist_items'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%checklist_tecnico%'
      AND with_check ILIKE '%event_belongs_to_company%'
  ),
  'checklist writes require the checklist module and same-tenant event'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'generated_documents'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%documentos_avancados%'
      AND with_check ILIKE '%template_belongs_to_company%'
      AND with_check ILIKE '%event_belongs_to_company%'
  ),
  'generated documents validate module, template, and optional event tenant'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'backups'
      AND cmd = 'SELECT'
      AND qual ILIKE '%admin_empresa%'
      AND qual ILIKE '%relatorios%'
  ),
  'backup reads require a tenant administrator and reports module'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'backups'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%can_write_company_module%'
      AND with_check ILIKE '%relatorios%'
  ),
  'backup creation requires an active reports entitlement'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'empresa_usuarios'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'company membership has no direct tenant write policy'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'empresa_modules'
      AND cmd IN ('UPDATE', 'DELETE')
  ),
  0::bigint,
  'company clients cannot directly activate, update, or remove entitlements'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'empresa_modules'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%status = ''pending''%'
      AND with_check ILIKE '%origem = ''onboarding''%'
      AND with_check ILIKE '%trial_granted = false%'
  ),
  'the onboarding exception can create pending entitlements only'
);

SELECT * FROM finish();

ROLLBACK;
