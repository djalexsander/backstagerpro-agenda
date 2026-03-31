
-- Fix: prevent users from changing their own empresa_id
DROP POLICY IF EXISTS "Update own profile" ON public.profiles;

CREATE POLICY "Update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND empresa_id IS NOT DISTINCT FROM (SELECT p.empresa_id FROM public.profiles p WHERE p.user_id = auth.uid())
);
