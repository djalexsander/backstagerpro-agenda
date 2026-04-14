-- Add flag to control which plans are available for new signups
ALTER TABLE public.planos
ADD COLUMN disponivel_novo_cadastro boolean NOT NULL DEFAULT true;

-- Mark legacy plans as unavailable for new signups
-- Vitalicio is a legacy plan
UPDATE public.planos SET disponivel_novo_cadastro = false WHERE nome ILIKE '%vitalicio%';
-- Trial plan should not appear in paid grid (it has its own section)
UPDATE public.planos SET disponivel_novo_cadastro = false WHERE valor = 0;