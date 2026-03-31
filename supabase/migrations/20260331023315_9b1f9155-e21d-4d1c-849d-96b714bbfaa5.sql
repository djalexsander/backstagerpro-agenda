
-- Remove client-side INSERT policy since profiles are created by the handle_new_user trigger (SECURITY DEFINER)
DROP POLICY IF EXISTS "Insert own profile" ON public.profiles;
