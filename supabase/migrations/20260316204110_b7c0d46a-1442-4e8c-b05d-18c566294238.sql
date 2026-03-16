
CREATE TABLE public.planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  valor numeric NOT NULL DEFAULT 0,
  descricao text,
  max_usuarios integer DEFAULT 5,
  max_eventos integer DEFAULT 50,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master admin full access planos"
ON public.planos FOR ALL
TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

CREATE POLICY "Authenticated users can view active planos"
ON public.planos FOR SELECT
TO authenticated
USING (ativo = true);

CREATE TRIGGER update_planos_updated_at
  BEFORE UPDATE ON public.planos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed default plans
INSERT INTO public.planos (nome, valor, descricao, max_usuarios, max_eventos) VALUES
  ('basico', 99.90, 'Plano Básico - Ideal para pequenas empresas', 5, 30),
  ('profissional', 199.90, 'Plano Profissional - Para empresas em crescimento', 15, 100),
  ('enterprise', 499.90, 'Plano Enterprise - Recursos ilimitados', 999, 9999);
