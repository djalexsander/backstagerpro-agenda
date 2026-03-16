
-- System settings table (key-value store for global config)
CREATE TABLE public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Only master_admin can read/write
CREATE POLICY "Master admin full access system_settings"
  ON public.system_settings FOR ALL TO authenticated
  USING (is_master_admin(auth.uid()))
  WITH CHECK (is_master_admin(auth.uid()));

-- Seed defaults
INSERT INTO public.system_settings (key, value) VALUES
  ('platform_name', 'Backstage Pro'),
  ('platform_logo_url', null),
  ('default_trial_days', '7'),
  ('max_empresas', '100'),
  ('maintenance_mode', 'false');

-- Updated_at trigger
CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
