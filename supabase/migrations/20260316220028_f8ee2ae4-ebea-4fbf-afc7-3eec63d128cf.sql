
-- Add storage_limit to planos
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS storage_limit integer DEFAULT 5;

-- Add plano_id, status_pagamento, vencimento to empresas
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS plano_id uuid REFERENCES public.planos(id);
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS status_pagamento text DEFAULT 'pendente';
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS vencimento timestamp with time zone;

-- Create pagamentos table
CREATE TABLE public.pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE NOT NULL,
  plano_id uuid REFERENCES public.planos(id),
  valor numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  metodo text DEFAULT 'pix',
  descricao text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

-- RLS: admin_empresa can view own company payments
CREATE POLICY "View company payments" ON public.pagamentos
FOR SELECT TO authenticated
USING (
  is_master_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
);

-- RLS: admin_empresa can insert payments for own company
CREATE POLICY "Insert company payments" ON public.pagamentos
FOR INSERT TO authenticated
WITH CHECK (
  is_master_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid()))
);

-- Master admin full access
CREATE POLICY "Master admin full access pagamentos" ON public.pagamentos
FOR ALL TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));
