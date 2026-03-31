
-- Fix: scope "View own role" so admin_empresa only sees roles for users in their own company
DROP POLICY IF EXISTS "View own role" ON public.user_roles;

CREATE POLICY "View own role"
ON public.user_roles FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR is_master_admin(auth.uid())
  OR (
    has_role(auth.uid(), 'admin_empresa'::app_role)
    AND user_id IN (
      SELECT p.user_id FROM public.profiles p
      WHERE p.empresa_id = get_user_empresa_id(auth.uid())
    )
  )
);
