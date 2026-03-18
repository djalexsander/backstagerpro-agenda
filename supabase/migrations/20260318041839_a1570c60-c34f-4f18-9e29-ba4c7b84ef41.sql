ALTER TABLE public.financials ADD COLUMN IF NOT EXISTS transport_detail jsonb DEFAULT NULL;
ALTER TABLE public.financials ADD COLUMN IF NOT EXISTS lodging_detail jsonb DEFAULT NULL;