
-- Batch module requests
CREATE TABLE public.module_batch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  valor_total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  observacao text,
  comprovante_url text,
  payment_method text DEFAULT 'pix',
  approved_at timestamptz,
  rejected_at timestamptz,
  observacao_admin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Batch items
CREATE TABLE public.module_batch_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_request_id uuid NOT NULL REFERENCES public.module_batch_requests(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.module_catalog(id),
  valor numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.module_batch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_batch_request_items ENABLE ROW LEVEL SECURITY;

-- RLS for module_batch_requests
CREATE POLICY "Admin empresa manage own batch requests"
ON public.module_batch_requests FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
);

CREATE POLICY "Master admin full access batch requests"
ON public.module_batch_requests FOR ALL TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

CREATE POLICY "Users view own batch requests"
ON public.module_batch_requests FOR SELECT TO authenticated
USING (empresa_id = get_user_empresa_id(auth.uid()));

-- RLS for module_batch_request_items
CREATE POLICY "Admin empresa manage own batch items"
ON public.module_batch_request_items FOR ALL TO authenticated
USING (
  batch_request_id IN (
    SELECT id FROM public.module_batch_requests
    WHERE empresa_id = get_user_empresa_id(auth.uid())
  )
)
WITH CHECK (
  batch_request_id IN (
    SELECT id FROM public.module_batch_requests
    WHERE empresa_id = get_user_empresa_id(auth.uid())
  )
);

CREATE POLICY "Master admin full access batch items"
ON public.module_batch_request_items FOR ALL TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

-- Triggers for updated_at
CREATE TRIGGER update_batch_requests_updated_at
BEFORE UPDATE ON public.module_batch_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
