
-- Make event-files bucket private
UPDATE storage.buckets SET public = false WHERE id = 'event-files';

-- Drop all overly-broad event-files storage policies
DROP POLICY IF EXISTS "Authenticated users can delete event files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update event files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload event files" ON storage.objects;
DROP POLICY IF EXISTS "Everyone can view event files storage" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read event files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete event files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload event files" ON storage.objects;

-- Helper function: check if an event belongs to user's empresa
CREATE OR REPLACE FUNCTION public.user_owns_event_file(file_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = split_part(file_path, '/', 1)
      AND (
        e.empresa_id = get_user_empresa_id(auth.uid())
        OR is_master_admin(auth.uid())
      )
  )
$$;

-- SELECT: company users and master admins can view their own event files
CREATE POLICY "Company scoped read event files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.user_owns_event_file(name)
);

-- INSERT: admin_empresa and master_admin can upload
CREATE POLICY "Company scoped upload event files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-files'
  AND public.user_owns_event_file(name)
);

-- UPDATE: admin_empresa and master_admin can update
CREATE POLICY "Company scoped update event files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.user_owns_event_file(name)
);

-- DELETE: admin_empresa and master_admin can delete
CREATE POLICY "Company scoped delete event files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND public.user_owns_event_file(name)
);
