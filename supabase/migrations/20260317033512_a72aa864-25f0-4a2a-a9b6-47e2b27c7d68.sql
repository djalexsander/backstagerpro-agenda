
CREATE POLICY "Admin empresa update payments" ON public.pagamentos
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()));
