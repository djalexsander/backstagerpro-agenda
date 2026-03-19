-- Add DELETE policy for profiles so admin can clean up
CREATE POLICY "Admin delete profiles" ON public.profiles
FOR DELETE TO authenticated
USING (
  is_master_admin(auth.uid()) 
  OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
);