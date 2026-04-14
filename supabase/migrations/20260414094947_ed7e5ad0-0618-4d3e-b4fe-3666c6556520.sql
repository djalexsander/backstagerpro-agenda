
-- Add commercial fields to module_catalog
ALTER TABLE public.module_catalog
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'operacional',
  ADD COLUMN IF NOT EXISTS badge text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS texto_venda text DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.module_catalog.categoria IS 'Categoria do módulo: operacional, financeiro, gestao, capacidade, premium';
COMMENT ON COLUMN public.module_catalog.badge IS 'Badge comercial: recomendado, mais_vendido, essencial, upgrade_sugerido';
COMMENT ON COLUMN public.module_catalog.texto_venda IS 'Texto curto de venda para exibição comercial';
