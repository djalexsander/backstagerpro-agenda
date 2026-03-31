CREATE POLICY "Authenticated read update_mode"
ON public.system_settings
FOR SELECT
TO authenticated
USING (key = 'update_mode');