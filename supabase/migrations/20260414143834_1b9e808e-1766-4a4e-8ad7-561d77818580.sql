
-- Deactivate the exportacoes_especiais module in the catalog (soft delete)
UPDATE public.module_catalog
SET ativo = false,
    descricao = '[DESCONTINUADO] Funcionalidade incorporada ao módulo Relatórios.',
    updated_at = now()
WHERE feature_key = 'exportacoes_especiais';

-- Migrate any active empresa_modules from exportacoes_especiais to relatorios
-- For companies that have exportacoes_especiais active but NOT relatorios, 
-- update their module_id to point to relatorios catalog entry
DO $$
DECLARE
  v_relatorios_id uuid;
  v_export_id uuid;
BEGIN
  SELECT id INTO v_relatorios_id FROM public.module_catalog WHERE feature_key = 'relatorios' LIMIT 1;
  SELECT id INTO v_export_id FROM public.module_catalog WHERE feature_key = 'exportacoes_especiais' LIMIT 1;
  
  IF v_relatorios_id IS NOT NULL AND v_export_id IS NOT NULL THEN
    -- For companies that have exportacoes_especiais active but no relatorios module,
    -- switch them to relatorios
    UPDATE public.empresa_modules em
    SET module_id = v_relatorios_id, updated_at = now()
    WHERE em.module_id = v_export_id
      AND em.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.empresa_modules em2
        WHERE em2.empresa_id = em.empresa_id
          AND em2.module_id = v_relatorios_id
          AND em2.status = 'active'
      );
    
    -- For companies that already have relatorios active, just deactivate their exportacoes_especiais
    UPDATE public.empresa_modules
    SET status = 'inactive', updated_at = now()
    WHERE module_id = v_export_id
      AND status = 'active';
  END IF;
END $$;

-- Log the consolidation
INSERT INTO public.system_logs (tipo, acao, descricao)
VALUES ('modulo', 'modulo_descontinuado', 'Módulo exportacoes_especiais descontinuado e incorporado ao módulo relatorios');
