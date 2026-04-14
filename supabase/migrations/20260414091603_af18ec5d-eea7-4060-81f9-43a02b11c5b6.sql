
-- Add trial_granted flag to empresa_modules
ALTER TABLE public.empresa_modules
ADD COLUMN IF NOT EXISTS trial_granted boolean NOT NULL DEFAULT false;

-- Function to deactivate trial-granted modules for an empresa
-- Called when trial expires or empresa transitions to a paid plan without converting modules
CREATE OR REPLACE FUNCTION public.deactivate_trial_modules(_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.empresa_modules
  SET status = 'inactive',
      updated_at = now()
  WHERE empresa_id = _empresa_id
    AND trial_granted = true
    AND status = 'active';

  -- Log the deactivation
  INSERT INTO public.system_logs (tipo, acao, descricao, empresa_id)
  SELECT 'modulo', 'trial_modules_desativados',
         'Módulos de trial desativados automaticamente para empresa',
         _empresa_id
  WHERE EXISTS (
    SELECT 1 FROM public.empresa_modules
    WHERE empresa_id = _empresa_id AND trial_granted = true
  );
END;
$$;
