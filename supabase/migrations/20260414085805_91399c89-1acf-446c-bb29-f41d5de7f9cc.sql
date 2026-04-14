
-- ============================================================================
-- ETAPA 2: Estrutura de banco para plano base + módulos adicionais
-- Não destrutiva — não altera tabelas existentes
-- ============================================================================

-- 1. CATÁLOGO DE MÓDULOS
CREATE TABLE public.module_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  valor numeric NOT NULL DEFAULT 0,
  periodicidade text NOT NULL DEFAULT 'mensal',
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  tipo_modulo text NOT NULL DEFAULT 'addon',
  feature_key text NOT NULL UNIQUE,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_capacity_module boolean NOT NULL DEFAULT false,
  capacidade_extra_usuarios integer NOT NULL DEFAULT 0,
  capacidade_extra_eventos integer NOT NULL DEFAULT 0,
  capacidade_extra_storage bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_module_catalog_ativo ON public.module_catalog (ativo);
CREATE INDEX idx_module_catalog_ordem ON public.module_catalog (ordem);

ALTER TABLE public.module_catalog ENABLE ROW LEVEL SECURITY;

-- Master admin: acesso total
CREATE POLICY "Master admin full access module_catalog"
  ON public.module_catalog FOR ALL TO authenticated
  USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));

-- Usuários autenticados: leitura de módulos ativos
CREATE POLICY "Authenticated view active modules"
  ON public.module_catalog FOR SELECT TO authenticated
  USING (ativo = true);

-- Trigger updated_at
CREATE TRIGGER update_module_catalog_updated_at
  BEFORE UPDATE ON public.module_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2. MÓDULOS POR EMPRESA
CREATE TABLE public.empresa_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  activated_at timestamptz,
  expires_at timestamptz,
  granted_by_admin boolean NOT NULL DEFAULT false,
  valor_cobrado numeric NOT NULL DEFAULT 0,
  origem text NOT NULL DEFAULT 'solicitacao',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Evitar módulo duplicado ativo na mesma empresa
  CONSTRAINT empresa_modules_status_check
    CHECK (status IN ('active','inactive','pending','cancelled','rejected'))
);

-- Índices
CREATE INDEX idx_empresa_modules_empresa ON public.empresa_modules (empresa_id);
CREATE INDEX idx_empresa_modules_module ON public.empresa_modules (module_id);
CREATE INDEX idx_empresa_modules_status ON public.empresa_modules (empresa_id, status);
-- Unicidade: apenas 1 registro ativo por empresa+módulo
CREATE UNIQUE INDEX idx_empresa_modules_unique_active
  ON public.empresa_modules (empresa_id, module_id)
  WHERE status = 'active';

ALTER TABLE public.empresa_modules ENABLE ROW LEVEL SECURITY;

-- Master admin: acesso total
CREATE POLICY "Master admin full access empresa_modules"
  ON public.empresa_modules FOR ALL TO authenticated
  USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));

-- Admin empresa: visualizar e gerenciar seus módulos
CREATE POLICY "Admin empresa manage own modules"
  ON public.empresa_modules FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_empresa') 
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_empresa') 
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  );

-- Usuários: leitura dos módulos da própria empresa
CREATE POLICY "Users view own empresa modules"
  ON public.empresa_modules FOR SELECT TO authenticated
  USING (empresa_id = public.get_user_empresa_id(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER update_empresa_modules_updated_at
  BEFORE UPDATE ON public.empresa_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 3. SOLICITAÇÕES DE MÓDULO
CREATE TABLE public.module_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_requests_status_check
    CHECK (status IN ('pending','approved','rejected','cancelled'))
);

CREATE INDEX idx_module_requests_empresa ON public.module_requests (empresa_id);
CREATE INDEX idx_module_requests_status ON public.module_requests (empresa_id, status);

ALTER TABLE public.module_requests ENABLE ROW LEVEL SECURITY;

-- Master admin: acesso total
CREATE POLICY "Master admin full access module_requests"
  ON public.module_requests FOR ALL TO authenticated
  USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));

-- Admin empresa: criar e visualizar solicitações
CREATE POLICY "Admin empresa manage own requests"
  ON public.module_requests FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_empresa')
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_empresa')
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  );

-- Usuários: leitura
CREATE POLICY "Users view own module requests"
  ON public.module_requests FOR SELECT TO authenticated
  USING (empresa_id = public.get_user_empresa_id(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER update_module_requests_updated_at
  BEFORE UPDATE ON public.module_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 4. PAGAMENTOS DE MÓDULO
CREATE TABLE public.module_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  comprovante_url text,
  payment_method text DEFAULT 'pix',
  paid_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  observacao_admin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_payments_status_check
    CHECK (status IN ('pending','paid','approved','rejected','cancelled'))
);

CREATE INDEX idx_module_payments_empresa ON public.module_payments (empresa_id);
CREATE INDEX idx_module_payments_module ON public.module_payments (module_id);
CREATE INDEX idx_module_payments_status ON public.module_payments (empresa_id, status);

ALTER TABLE public.module_payments ENABLE ROW LEVEL SECURITY;

-- Master admin: acesso total
CREATE POLICY "Master admin full access module_payments"
  ON public.module_payments FOR ALL TO authenticated
  USING (public.is_master_admin(auth.uid()))
  WITH CHECK (public.is_master_admin(auth.uid()));

-- Admin empresa: criar e visualizar pagamentos
CREATE POLICY "Admin empresa manage own module payments"
  ON public.module_payments FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_empresa')
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_empresa')
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  );

-- Usuários: leitura
CREATE POLICY "Users view own module payments"
  ON public.module_payments FOR SELECT TO authenticated
  USING (empresa_id = public.get_user_empresa_id(auth.uid()));

-- Trigger updated_at
CREATE TRIGGER update_module_payments_updated_at
  BEFORE UPDATE ON public.module_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
