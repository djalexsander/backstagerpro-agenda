-- Removes only the barcode from a material that already has one, so the
-- operator can request a fresh automatic code afterwards through the existing
-- generate_material_barcode RPC. The QR content and identificador_unico are
-- never touched. Sibling of replace_material_barcode; the difference is that
-- this function stops after clearing instead of regenerating.

CREATE OR REPLACE FUNCTION public.clear_material_barcode(
  _material_id uuid
)
RETURNS void
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
      MESSAGE = 'O material não possui código de barras para excluir.';
  END IF;

  -- codigo_barras and tipo_identificacao move together: the
  -- materiais_identification_type_content check rejects a NULL barcode while
  -- tipo_identificacao is still 'codigo_barras'/'ambos'. 'qr_code' is the only
  -- value valid without a barcode and is also valid with a QR present, so
  -- generate_material_barcode restores 'codigo_barras'/'ambos' on the next
  -- code. prepare_material_write then keeps status_identificacao consistent:
  -- it stays 'ativa' when a QR remains and returns to 'nao_gerada' otherwise.
  UPDATE public.materiais
  SET codigo_barras = NULL,
      tipo_identificacao = 'qr_code'
  WHERE id = _material_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_material_barcode(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_material_barcode(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.clear_material_barcode(uuid) IS
  'Removes only the material barcode, preserving identificador_unico and QR content. A fresh code is issued afterwards by the unchanged generate_material_barcode RPC.';
