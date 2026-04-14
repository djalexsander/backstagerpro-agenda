
CREATE TABLE public.event_checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL DEFAULT 'observacoes_gerais',
  descricao TEXT NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.event_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View company checklist items"
ON public.event_checklist_items
FOR SELECT
TO authenticated
USING (
  is_master_admin(auth.uid()) OR empresa_id = get_user_empresa_id(auth.uid())
);

CREATE POLICY "Admin insert checklist items"
ON public.event_checklist_items
FOR INSERT
TO authenticated
WITH CHECK (
  is_master_admin(auth.uid()) OR (
    has_role(auth.uid(), 'admin_empresa'::app_role)
    AND empresa_id = get_user_empresa_id(auth.uid())
  )
);

CREATE POLICY "Admin update checklist items"
ON public.event_checklist_items
FOR UPDATE
TO authenticated
USING (
  is_master_admin(auth.uid()) OR (
    has_role(auth.uid(), 'admin_empresa'::app_role)
    AND empresa_id = get_user_empresa_id(auth.uid())
  )
);

CREATE POLICY "Admin delete checklist items"
ON public.event_checklist_items
FOR DELETE
TO authenticated
USING (
  is_master_admin(auth.uid()) OR (
    has_role(auth.uid(), 'admin_empresa'::app_role)
    AND empresa_id = get_user_empresa_id(auth.uid())
  )
);

CREATE TRIGGER update_event_checklist_items_updated_at
BEFORE UPDATE ON public.event_checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_event_checklist_items_event ON public.event_checklist_items(event_id);
CREATE INDEX idx_event_checklist_items_empresa ON public.event_checklist_items(empresa_id);
