-- P1-4: capacity extras may only be sold when the catalog capacity is backed
-- by real backend enforcement. Historical catalog and entitlement rows stay
-- intact. The commercial defaults below repair zeroed reconstructed catalogs
-- while preserving any positive price/capacity already configured.

DO $$
DECLARE
  v_found integer;
BEGIN
  SELECT count(*)
  INTO v_found
  FROM public.module_catalog
  WHERE feature_key IN ('extra_eventos', 'extra_usuarios', 'extra_storage');

  IF v_found <> 3 THEN
    RAISE EXCEPTION
      'Expected all three canonical capacity extras; found %', v_found;
  END IF;
END;
$$;

-- Storage has presentation-only arithmetic today: no byte measurement and no
-- upload/storage policy enforces this catalog value.
UPDATE public.module_catalog
SET ativo = false,
    destaque = false,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'commercial_status', 'not_sold',
      'implementation_status', 'not_enforced',
      'capacity_unit', 'gb'
    ),
    updated_at = clock_timestamp()
WHERE feature_key = 'extra_storage';

-- New installations currently receive zero values from the canonical seed.
-- Apply the approved defaults only to missing/zero values. Positive custom
-- configurations remain unchanged.
UPDATE public.module_catalog
SET valor = CASE feature_key
      WHEN 'extra_eventos' THEN
        CASE WHEN valor > 0 THEN valor ELSE 49.90 END
      WHEN 'extra_usuarios' THEN
        CASE WHEN valor > 0 THEN valor ELSE 39.90 END
    END,
    capacidade_extra_eventos = CASE
      WHEN feature_key = 'extra_eventos' AND capacidade_extra_eventos <= 0
        THEN 20
      ELSE capacidade_extra_eventos
    END,
    capacidade_extra_usuarios = CASE
      WHEN feature_key = 'extra_usuarios' AND capacidade_extra_usuarios <= 0
        THEN 20
      ELSE capacidade_extra_usuarios
    END,
    is_capacity_module = true,
    ativo = true,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'commercial_status', 'sellable',
      'implementation_status', 'backend_enforced'
    ),
    updated_at = clock_timestamp()
WHERE feature_key IN ('extra_eventos', 'extra_usuarios');

ALTER TABLE public.module_catalog
  ADD CONSTRAINT module_catalog_extra_eventos_real_capacity_check
  CHECK (
    feature_key <> 'extra_eventos'
    OR NOT ativo
    OR (is_capacity_module AND capacidade_extra_eventos > 0)
  );

ALTER TABLE public.module_catalog
  ADD CONSTRAINT module_catalog_extra_usuarios_real_capacity_check
  CHECK (
    feature_key <> 'extra_usuarios'
    OR NOT ativo
    OR (is_capacity_module AND capacidade_extra_usuarios > 0)
  );

ALTER TABLE public.module_catalog
  ADD CONSTRAINT module_catalog_extra_storage_not_commercial_check
  CHECK (feature_key <> 'extra_storage' OR NOT ativo);
