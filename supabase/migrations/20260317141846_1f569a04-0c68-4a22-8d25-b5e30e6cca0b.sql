
DROP POLICY "Users can view employees of their company" ON public.funcionarios;
DROP POLICY "Admin can insert employees" ON public.funcionarios;
DROP POLICY "Admin can update employees" ON public.funcionarios;
DROP POLICY "Admin can delete employees" ON public.funcionarios;

CREATE POLICY "View company employees"
  ON public.funcionarios FOR SELECT
  TO authenticated
  USING (is_master_admin(auth.uid()) OR empresa_id = get_user_empresa_id(auth.uid()));

CREATE POLICY "Insert company employees"
  ON public.funcionarios FOR INSERT
  TO authenticated
  WITH CHECK (
    is_master_admin(auth.uid()) OR 
    (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
  );

CREATE POLICY "Update company employees"
  ON public.funcionarios FOR UPDATE
  TO authenticated
  USING (
    is_master_admin(auth.uid()) OR 
    (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
  );

CREATE POLICY "Delete company employees"
  ON public.funcionarios FOR DELETE
  TO authenticated
  USING (
    is_master_admin(auth.uid()) OR 
    (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
  );
