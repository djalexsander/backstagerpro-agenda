
-- Storage policies for event-files bucket
CREATE POLICY "Authenticated users can upload event files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'event-files');

CREATE POLICY "Authenticated users can read event files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'event-files');

CREATE POLICY "Authenticated users can update event files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'event-files');

CREATE POLICY "Authenticated users can delete event files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'event-files');

-- Fix events INSERT policy to allow master_admin with null empresa_id
DROP POLICY IF EXISTS "Admin insert events" ON public.events;
CREATE POLICY "Admin insert events"
ON public.events FOR INSERT
TO authenticated
WITH CHECK (
  is_master_admin(auth.uid())
  OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND (empresa_id = get_user_empresa_id(auth.uid())))
);
