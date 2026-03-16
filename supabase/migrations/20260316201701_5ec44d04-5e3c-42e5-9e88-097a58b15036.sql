
-- Create empresas table
CREATE TABLE IF NOT EXISTS public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa text NOT NULL,
  email text,
  telefone text,
  plano text DEFAULT 'basico',
  status text DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- Add empresa_id to existing tables
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE;
ALTER TABLE public.financials ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE;
ALTER TABLE public.event_files ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE;

-- Function to get user empresa_id
CREATE OR REPLACE FUNCTION public.get_user_empresa_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- Function to check master_admin
CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'master_admin'
  )
$$;

-- Update handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (NEW.raw_user_meta_data->>'empresa_id')::uuid
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'role', 'usuario')::app_role);

  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
