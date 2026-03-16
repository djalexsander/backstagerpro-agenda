
-- Add trial_days to planos (0 = no trial/unlimited)
ALTER TABLE public.planos ADD COLUMN trial_days integer NOT NULL DEFAULT 0;

-- Update the free trial plan to 7 days
UPDATE public.planos SET trial_days = 7 WHERE nome = 'teste free 7 dias';

-- Add trial_expires_at to empresas to track when trial ends
ALTER TABLE public.empresas ADD COLUMN trial_expires_at timestamptz;
ALTER TABLE public.empresas ADD COLUMN plano_bloqueado boolean NOT NULL DEFAULT false;
