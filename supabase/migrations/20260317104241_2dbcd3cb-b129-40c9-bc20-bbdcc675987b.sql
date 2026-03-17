
CREATE TABLE public.backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'manual',
  periodo_inicio timestamp with time zone,
  periodo_fim timestamp with time zone,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users view own backups"
  ON public.backups FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa_id(auth.uid()));

CREATE POLICY "Company admins insert backups"
  ON public.backups FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  );

CREATE POLICY "Company admins delete backups"
  ON public.backups FOR DELETE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  );

CREATE POLICY "Master admin full access backups"
  ON public.backups FOR ALL TO authenticated
  USING (is_master_admin(auth.uid()))
  WITH CHECK (is_master_admin(auth.uid()));
