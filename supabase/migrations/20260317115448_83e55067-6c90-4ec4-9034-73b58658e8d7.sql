-- Add data_contrato column to empresas
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS data_contrato date;