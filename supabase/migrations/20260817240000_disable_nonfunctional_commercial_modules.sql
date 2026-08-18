-- P1-3: do not commercially expose catalog entries that do not provide a
-- dedicated feature. Keep the stable catalog rows and every historical
-- entitlement/request/payment that references them.

DO $$
DECLARE
  v_found integer;
BEGIN
  SELECT count(*)
  INTO v_found
  FROM public.module_catalog
  WHERE feature_key IN (
    'agenda_compartilhada',
    'equipe_permissoes',
    'notificacoes_premium',
    'relatorios_materiais'
  );

  IF v_found <> 4 THEN
    RAISE EXCEPTION
      'Expected all four P1-3 catalog modules before commercial deactivation; found %',
      v_found;
  END IF;
END;
$$;

UPDATE public.module_catalog
SET ativo = false,
    destaque = false,
    metadata = COALESCE(metadata, '{}'::jsonb) ||
      CASE feature_key
        WHEN 'equipe_permissoes' THEN jsonb_build_object(
          'commercial_status', 'not_sold_separately',
          'implementation_status', 'covered_by_core',
          'covered_by', 'company_administration'
        )
        ELSE jsonb_build_object(
          'commercial_status', 'not_sold',
          'implementation_status', 'not_implemented'
        )
      END,
    updated_at = clock_timestamp()
WHERE feature_key IN (
  'agenda_compartilhada',
  'equipe_permissoes',
  'notificacoes_premium',
  'relatorios_materiais'
);

