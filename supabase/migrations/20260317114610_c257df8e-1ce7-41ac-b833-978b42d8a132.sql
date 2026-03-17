
-- Replace the overly permissive insert policy with a more specific one
DROP POLICY "Authenticated insert logs" ON public.system_logs;

-- Only allow inserts where user_id matches the authenticated user (self-logging)
CREATE POLICY "Authenticated self insert logs" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
