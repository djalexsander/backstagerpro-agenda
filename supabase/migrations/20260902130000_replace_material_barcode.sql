-- Replaces an existing material barcode atomically while preserving its QR
-- identity. The original generate_material_barcode(uuid) remains idempotent.

CREATE OR REPLACE FUNCTION public.replace_material_barcode(
  _material_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_existing_barcode text;
BEGIN
  SELECT material.empresa_id, material.codigo_barras
  INTO v_empresa_id, v_existing_barcode
  FROM public.materiais AS material
  WHERE material.id = _material_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.can_write_company_module(
       v_empresa_id,
       'gestao_materiais'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  IF v_existing_barcode IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'O material não possui código de barras para substituir.';
  END IF;

  -- The clear and the server-side generation share one transaction. Any
  -- failure in the generator rolls this update back and preserves the old code.
  UPDATE public.materiais
  SET codigo_barras = NULL
  WHERE id = _material_id;

  RETURN public.generate_material_barcode(_material_id);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_material_barcode(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_material_barcode(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.replace_material_barcode(uuid) IS
  'Atomically replaces an existing material barcode using the server-side sequence, preserving identificador_unico and QR content.';
