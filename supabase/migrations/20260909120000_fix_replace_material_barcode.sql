-- Fix: replace_material_barcode cleared the barcode with a bare
--   UPDATE public.materiais SET codigo_barras = NULL
-- which violates the materiais_identification_type_content CHECK
--   (tipo_identificacao = 'qr_code' OR codigo_barras IS NOT NULL)
-- for every real barcode: prepare_material_write does not touch
-- tipo_identificacao on UPDATE, so the intermediate row still had
-- tipo_identificacao = 'codigo_barras'/'ambos' with a NULL barcode and the
-- statement aborted with SQLSTATE 23514 before the replacement was generated.
--
-- codigo_barras and tipo_identificacao now move together in that intermediate
-- UPDATE, exactly as generate_material_barcode and clear_material_barcode
-- already do. 'qr_code' is the only type valid without a barcode and is also
-- valid while a QR is present; generate_material_barcode then restores
-- 'codigo_barras'/'ambos' when it writes the new code. identificador_unico and
-- conteudo_qr_code are never touched. Signature, SECURITY DEFINER, search_path,
-- permissions, validations and error codes are unchanged.

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
  -- codigo_barras and tipo_identificacao move together so the intermediate row
  -- (barcode NULL) still satisfies materiais_identification_type_content;
  -- generate_material_barcode restores 'codigo_barras'/'ambos' with the new code.
  UPDATE public.materiais
  SET codigo_barras = NULL,
      tipo_identificacao = 'qr_code'
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
