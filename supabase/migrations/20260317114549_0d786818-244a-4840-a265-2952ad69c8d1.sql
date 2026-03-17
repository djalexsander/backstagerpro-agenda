
-- Create system_logs table
CREATE TABLE public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'info',
  acao text NOT NULL,
  descricao text NOT NULL,
  user_id uuid,
  user_name text,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  empresa_nome text,
  dados jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- Only master admin can view logs
CREATE POLICY "Master admin view logs" ON public.system_logs
  FOR SELECT TO authenticated
  USING (is_master_admin(auth.uid()));

-- Allow insert from service role (triggers/edge functions) and master admin
CREATE POLICY "Master admin manage logs" ON public.system_logs
  FOR ALL TO authenticated
  USING (is_master_admin(auth.uid()))
  WITH CHECK (is_master_admin(auth.uid()));

-- Allow insert for any authenticated user (for self-logging actions)
CREATE POLICY "Authenticated insert logs" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Create trigger function to log empresa creation
CREATE OR REPLACE FUNCTION public.log_empresa_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id, empresa_nome)
  VALUES ('empresa', 'empresa_criada', 'Nova empresa criada: ' || NEW.nome_empresa, NEW.id, NEW.nome_empresa);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_empresa_created
  AFTER INSERT ON public.empresas
  FOR EACH ROW
  EXECUTE FUNCTION public.log_empresa_created();

-- Create trigger function to log plan changes
CREATE OR REPLACE FUNCTION public.log_plano_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.plano IS DISTINCT FROM NEW.plano OR OLD.plano_id IS DISTINCT FROM NEW.plano_id THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id, empresa_nome, dados)
    VALUES ('plano', 'plano_alterado', 'Plano alterado para empresa: ' || NEW.nome_empresa, NEW.id, NEW.nome_empresa,
      jsonb_build_object('plano_anterior', OLD.plano, 'plano_novo', NEW.plano));
  END IF;
  IF OLD.plano_bloqueado IS DISTINCT FROM NEW.plano_bloqueado THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id, empresa_nome, dados)
    VALUES ('plano', CASE WHEN NEW.plano_bloqueado THEN 'empresa_bloqueada' ELSE 'empresa_desbloqueada' END,
      CASE WHEN NEW.plano_bloqueado THEN 'Empresa bloqueada: ' ELSE 'Empresa desbloqueada: ' END || NEW.nome_empresa,
      NEW.id, NEW.nome_empresa, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_plano_changed
  AFTER UPDATE ON public.empresas
  FOR EACH ROW
  EXECUTE FUNCTION public.log_plano_changed();

-- Create trigger for user creation
CREATE OR REPLACE FUNCTION public.log_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, user_name, empresa_id)
  VALUES ('usuario', 'usuario_criado', 'Novo usuário criado: ' || NEW.full_name, NEW.user_id, NEW.full_name, NEW.empresa_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_user_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_user_created();

-- Create trigger for payment status changes
CREATE OR REPLACE FUNCTION public.log_pagamento_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_empresa_nome text;
BEGIN
  SELECT nome_empresa INTO v_empresa_nome FROM public.empresas WHERE id = NEW.empresa_id;
  
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id, empresa_nome, dados)
    VALUES ('pagamento', 'pagamento_criado', 'Novo pagamento registrado - R$ ' || NEW.valor, NEW.empresa_id, v_empresa_nome,
      jsonb_build_object('valor', NEW.valor, 'status', NEW.status, 'metodo', NEW.metodo));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id, empresa_nome, dados)
    VALUES ('pagamento', 'pagamento_atualizado', 'Status do pagamento alterado para: ' || NEW.status, NEW.empresa_id, v_empresa_nome,
      jsonb_build_object('valor', NEW.valor, 'status_anterior', OLD.status, 'status_novo', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_pagamento_changed
  AFTER INSERT OR UPDATE ON public.pagamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.log_pagamento_changed();
