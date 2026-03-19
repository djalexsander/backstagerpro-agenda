
-- Create empresa_usuarios table for multi-company user relationships
CREATE TABLE public.empresa_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  perfil text NOT NULL DEFAULT 'usuario',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, user_id)
);

-- Enable RLS
ALTER TABLE public.empresa_usuarios ENABLE ROW LEVEL SECURITY;

-- Master admin full access
CREATE POLICY "Master admin full access empresa_usuarios"
ON public.empresa_usuarios FOR ALL TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

-- Admin empresa can manage users in their company
CREATE POLICY "Admin empresa manage empresa_usuarios"
ON public.empresa_usuarios FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND empresa_id = get_user_empresa_id(auth.uid())
);

-- Users can view their own memberships
CREATE POLICY "Users view own empresa_usuarios"
ON public.empresa_usuarios FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Migrate existing data from profiles to empresa_usuarios
INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
SELECT p.empresa_id, p.user_id, COALESCE(ur.role::text, 'usuario')
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
WHERE p.empresa_id IS NOT NULL
ON CONFLICT (empresa_id, user_id) DO NOTHING;
