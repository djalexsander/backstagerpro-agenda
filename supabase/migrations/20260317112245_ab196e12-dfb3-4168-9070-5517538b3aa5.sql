
-- Document templates table
CREATE TABLE public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'contrato',
  conteudo text NOT NULL DEFAULT '',
  variaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users view own templates" ON public.document_templates
  FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa_id(auth.uid()) OR is_master_admin(auth.uid()));

CREATE POLICY "Admin manage templates" ON public.document_templates
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  );

-- Generated documents table
CREATE TABLE public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.document_templates(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'contrato',
  conteudo_final text NOT NULL DEFAULT '',
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users view own documents" ON public.generated_documents
  FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa_id(auth.uid()) OR is_master_admin(auth.uid()));

CREATE POLICY "Admin manage documents" ON public.generated_documents
  FOR ALL TO authenticated
  USING (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin_empresa') AND empresa_id = get_user_empresa_id(auth.uid()))
    OR is_master_admin(auth.uid())
  );

-- Trigger for updated_at on templates
CREATE TRIGGER update_document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
