-- Company branding is public, but object mutation is tenant-administrative.
UPDATE storage.buckets
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY[
      'image/png',
      'image/jpeg',
      'image/webp'
    ]::text[]
WHERE id = 'logos';

-- Remove all local or remote policies that mention this bucket, then rebuild
-- read and write rules explicitly.
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
        ) ILIKE '%logos%'
        OR COALESCE(
          pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
          ''
        ) ILIKE '%logos%'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_policy.polname
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_company_logo_path(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    _path IS NOT NULL
    AND _path ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/logo\.(png|jpe?g|webp|svg)$'
    AND EXISTS (
      SELECT 1
      FROM public.empresas
      WHERE id::text = split_part(_path, '/', 1)
    )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_logo_storage_object(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      (
        public.is_master_admin(auth.uid())
        AND (
          public.is_valid_company_logo_path(_path)
          OR _path ~* '^platform-logo-[0-9]+\.(png|jpe?g|webp|svg)$'
        )
      )
      OR (
        public.has_role(
          auth.uid(),
          'admin_empresa'::public.app_role
        )
        AND public.is_valid_company_logo_path(_path)
        AND split_part(_path, '/', 1) =
          public.get_user_empresa_id(auth.uid())::text
      )
    )
$$;

CREATE POLICY "Public read branding logos"
ON storage.objects
FOR SELECT
TO PUBLIC
USING (bucket_id = 'logos');

CREATE POLICY "Tenant administrators upload company logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logos'
  AND public.can_manage_logo_storage_object(name)
);

CREATE POLICY "Tenant administrators replace company logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'logos'
  AND public.can_manage_logo_storage_object(name)
)
WITH CHECK (
  bucket_id = 'logos'
  AND public.can_manage_logo_storage_object(name)
);

CREATE POLICY "Tenant administrators delete company logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'logos'
  AND public.can_manage_logo_storage_object(name)
);

REVOKE ALL ON FUNCTION public.is_valid_company_logo_path(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_logo_storage_object(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_company_logo_path(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_logo_storage_object(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_manage_logo_storage_object(text) IS
  'Allows company admins to mutate only their active company logo and reserves platform branding for master admins.';
