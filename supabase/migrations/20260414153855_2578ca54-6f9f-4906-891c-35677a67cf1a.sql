CREATE POLICY "Admin empresa update own empresa"
ON public.empresas
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND id = get_user_empresa_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND id = get_user_empresa_id(auth.uid())
);