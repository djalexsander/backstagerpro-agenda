
-- Junction table: event team assignments (does NOT affect financials)
CREATE TABLE public.event_funcionarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  funcionario_id UUID NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, funcionario_id)
);

ALTER TABLE public.event_funcionarios ENABLE ROW LEVEL SECURITY;

-- All authenticated company users can view (visible to usuarios too)
CREATE POLICY "View company event team"
ON public.event_funcionarios FOR SELECT TO authenticated
USING (is_master_admin(auth.uid()) OR empresa_id = get_user_empresa_id(auth.uid()));

-- Only admins can manage
CREATE POLICY "Admin insert event team"
ON public.event_funcionarios FOR INSERT TO authenticated
WITH CHECK (is_master_admin(auth.uid()) OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin delete event team"
ON public.event_funcionarios FOR DELETE TO authenticated
USING (is_master_admin(auth.uid()) OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid())));
