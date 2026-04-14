
-- Tabela para registrar cobranças do Asaas com separação por app
CREATE TABLE public.asaas_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_app TEXT NOT NULL DEFAULT 'backstage_pro',
  payment_type TEXT NOT NULL CHECK (payment_type IN ('base_plan', 'modules')),
  asaas_payment_id TEXT UNIQUE,
  asaas_customer_id TEXT,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'received', 'overdue', 'refunded', 'cancelled')),
  payment_method TEXT DEFAULT 'pix',
  pix_qr_code TEXT,
  pix_copy_paste TEXT,
  invoice_url TEXT,
  payment_confirmed_at TIMESTAMP WITH TIME ZONE,
  due_date DATE,
  related_batch_request_id UUID REFERENCES public.module_batch_requests(id),
  related_plano_id UUID REFERENCES public.planos(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_asaas_payments_empresa ON public.asaas_payments(empresa_id);
CREATE INDEX idx_asaas_payments_source ON public.asaas_payments(source_app);
CREATE INDEX idx_asaas_payments_status ON public.asaas_payments(status);
CREATE INDEX idx_asaas_payments_asaas_id ON public.asaas_payments(asaas_payment_id);

-- RLS
ALTER TABLE public.asaas_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin empresa manage own asaas payments"
ON public.asaas_payments FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
);

CREATE POLICY "Master admin full access asaas payments"
ON public.asaas_payments FOR ALL
TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

CREATE POLICY "Users view own asaas payments"
ON public.asaas_payments FOR SELECT
TO authenticated
USING (empresa_id = get_user_empresa_id(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER update_asaas_payments_updated_at
BEFORE UPDATE ON public.asaas_payments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
