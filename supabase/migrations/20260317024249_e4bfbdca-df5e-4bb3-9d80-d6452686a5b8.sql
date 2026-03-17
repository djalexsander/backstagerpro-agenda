CREATE POLICY "Admin empresa delete payments"
ON public.pagamentos
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role) 
  AND empresa_id = get_user_empresa_id(auth.uid())
);