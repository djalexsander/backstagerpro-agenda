-- Event files are private PDFs. Company users may read registered files from
-- their active tenant; only company/master administrators may mutate objects.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id = 'event-files';

-- Remove every policy that mentions event-files, including policies that may
-- exist remotely but are not represented by the known local policy names.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND (
        COALESCE(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
          ''
        ) ILIKE '%event-files%'
        OR COALESCE(
          pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
          ''
        ) ILIKE '%event-files%'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_policy.polname
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_event_storage_path(_file_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    _file_path IS NOT NULL
    AND _file_path ~*
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/]+\.pdf$'
    AND _file_path NOT LIKE '%..%'
$$;

DROP FUNCTION IF EXISTS public.can_read_event_storage_object(text, uuid);
DROP FUNCTION IF EXISTS public.can_manage_event_storage_object(text, uuid);

CREATE OR REPLACE FUNCTION public.can_read_event_storage_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_event_storage_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.event_files AS event_file
      JOIN public.events AS event
        ON event.id = event_file.event_id
      WHERE event_file.file_path = _file_path
        AND event.id::text = split_part(_file_path, '/', 1)
        AND (
          public.is_master_admin(auth.uid())
          OR event.empresa_id = public.get_user_empresa_id(auth.uid())
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_storage_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_event_storage_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.events AS event
      WHERE event.id::text = split_part(_file_path, '/', 1)
        AND (
          public.is_master_admin(auth.uid())
          OR (
            public.has_role(
              auth.uid(),
              'admin_empresa'::public.app_role
            )
            AND event.empresa_id = public.get_user_empresa_id(auth.uid())
          )
        )
    )
$$;

DROP FUNCTION IF EXISTS public.user_owns_event_file(text);

CREATE POLICY "Tenant users read registered event files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.can_read_event_storage_object(name)
);

CREATE POLICY "Tenant administrators upload event files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-files'
  AND public.can_manage_event_storage_object(name)
);

CREATE POLICY "Tenant administrators replace event files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.can_manage_event_storage_object(name)
)
WITH CHECK (
  bucket_id = 'event-files'
  AND public.can_manage_event_storage_object(name)
);

CREATE POLICY "Tenant administrators delete event files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.can_manage_event_storage_object(name)
);

REVOKE ALL ON FUNCTION public.is_valid_event_storage_path(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_event_storage_object(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_event_storage_object(text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_valid_event_storage_path(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_event_storage_object(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_event_storage_object(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_read_event_storage_object(text) IS
  'Allows tenant reads only when a matching event_files metadata row exists.';
COMMENT ON FUNCTION public.can_manage_event_storage_object(text) IS
  'Allows event Storage writes only to a master or the active tenant administrator.';
