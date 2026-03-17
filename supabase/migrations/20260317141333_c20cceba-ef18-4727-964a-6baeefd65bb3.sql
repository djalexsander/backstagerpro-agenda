
CREATE TABLE public.funcionarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE NOT NULL,
  nome TEXT NOT NULL,
  funcao TEXT NOT NULL DEFAULT '',
  cache_padrao NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view employees of their company"
  ON public.funcionarios FOR SELECT
  TO authenticated
  USING (empresa_id = (SELECT public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin can insert employees"
  ON public.funcionarios FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = (SELECT public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin can update employees"
  ON public.funcionarios FOR UPDATE
  TO authenticated
  USING (empresa_id = (SELECT public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin can delete employees"
  ON public.funcionarios FOR DELETE
  TO authenticated
  USING (empresa_id = (SELECT public.get_user_empresa_id(auth.uid())));
