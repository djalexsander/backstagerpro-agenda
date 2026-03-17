
CREATE TABLE public.notificacoes_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'upgrade_plano',
  mensagem text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notificacoes_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master admin full access notificacoes" ON public.notificacoes_master
  FOR ALL TO authenticated
  USING (is_master_admin(auth.uid()))
  WITH CHECK (is_master_admin(auth.uid()));

CREATE POLICY "Empresa insert notificacoes" ON public.notificacoes_master
  FOR INSERT TO authenticated
  WITH CHECK (empresa_id = get_user_empresa_id(auth.uid()));
