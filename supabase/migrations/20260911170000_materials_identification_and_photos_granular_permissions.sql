-- Backstage Pro - ETAPA 7: fecha o residuo deixado explicitamente em
-- 20260911140000_materials_granular_write_permissions.sql - o mesmo
-- mecanismo granular (user_module_permissions/user_has_module_action) chega
-- agora aos quatro RPCs de identificacao de material e as politicas do
-- bucket de Storage material-photos, ambos ainda restritos a
-- can_write_company_module('gestao_materiais') (admin_empresa/master_admin
-- apenas).
--
-- 1. Quatro RPCs de identificacao (generate_material_qr_code,
--    generate_material_barcode, replace_material_barcode,
--    clear_material_barcode): todas fazem um UPDATE em public.materiais
--    (conteudo_qr_code/codigo_barras/tipo_identificacao/status_identificacao),
--    nunca um INSERT - mesmo raciocinio ja usado para a propria tabela
--    materiais em 20260911140000 ("nao ha politica de DELETE - inativar e
--    UPDATE"), entao a acao granular equivalente e 'edit' para as quatro,
--    nao 'create'/'delete'. Assinatura (uuid) inalterada em todas - so o
--    corpo troca can_write_company_module(...) por
--    (can_write_company_module(...) OR user_has_module_action(...,'edit')),
--    mesma mecanica de resolve_custody_company em
--    20260819100000_checkin_checkout_granular_write_permissions.sql.
--
-- 2. Bucket material-photos: can_read_material_photo_object fica intocada
--    (leitura sem gate de papel em todo o modulo, mesmo padrao de
--    can_read_company_module). can_manage_material_photo_object hoje e uma
--    unica funcao de 1 argumento reaproveitada pelas 3 politicas de escrita
--    (upload=INSERT, substituir=UPDATE, excluir=DELETE) - nenhuma delas
--    distingue a acao. Para reproduzir o MESMO padrao ja aplicado a
--    materiais_fotos (a tabela de metadados irma: INSERT->create,
--    UPDATE->edit, DELETE->delete, tambem em 20260911140000), a funcao
--    ganha um segundo argumento _action e cada uma das 3 politicas passa a
--    acao que lhe corresponde. Isso evita um estado inconsistente onde um
--    usuario com permissao só de 'create' conseguiria apagar o arquivo no
--    Storage mesmo sem 'delete' na tabela materiais_fotos (a politica de
--    DELETE de materiais_fotos ja exige 'delete' desde 20260911140000).
--
--    Trocar a assinatura de can_manage_material_photo_object exige o
--    DROP FUNCTION IF EXISTS de sempre neste projeto (nao usa ALTER DEFAULT
--    PRIVILEGES - confirmado em 20260824110000_fix_listar_custodias_
--    materiais_overload.sql) para nao deixar as duas assinaturas convivendo
--    como overloads. A assinatura antiga de 1 argumento tambem e referenciada
--    por nome (::regprocedure) no teste supabase/tests/
--    materials_module_entitlement_test.sql - esse teste e atualizado para a
--    assinatura nova no mesmo commit desta migration.
--
-- Nao muda: RLS de categorias_materiais/materiais/materiais_fotos (ja
-- granular desde 20260911140000); can_read_material_photo_object; o bucket
-- em si (publico=false, tamanho/mime inalterados).

-- ============================================================================
-- 1. RPCs de identificacao - 'edit' granular, mesma assinatura (uuid)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_material_qr_code(
  _material_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_identifier uuid;
  v_existing_content text;
  v_content text;
BEGIN
  SELECT material.empresa_id
  INTO v_empresa_id
  FROM public.materiais AS material
  WHERE material.id = _material_id;

  IF NOT FOUND
     OR NOT (
       public.can_write_company_module(v_empresa_id, 'gestao_materiais')
       OR public.user_has_module_action(v_empresa_id, 'gestao_materiais', 'edit')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  SELECT
    material.identificador_unico,
    material.conteudo_qr_code
  INTO
    v_identifier,
    v_existing_content
  FROM public.materiais AS material
  WHERE material.id = _material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  v_content :=
    'BACKSTAGE-PRO:MATERIAL:' || v_identifier::text;

  IF v_existing_content IS NOT NULL THEN
    IF v_existing_content <> v_content THEN
      RAISE EXCEPTION 'Identificação QR armazenada é inconsistente';
    END IF;
    RETURN v_existing_content;
  END IF;

  UPDATE public.materiais
  SET conteudo_qr_code = v_content,
      tipo_identificacao = CASE
        WHEN codigo_barras IS NULL THEN 'qr_code'
        ELSE 'ambos'
      END::public.material_identification_type,
      status_identificacao = 'ativa'
  WHERE id = _material_id;

  RETURN v_content;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_material_barcode(
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
  v_sequence integer;
  v_sequence_text text;
  v_payload text;
  v_candidate text;
  v_sum integer;
  v_digit integer;
  v_position integer;
  v_check_digit integer;
BEGIN
  SELECT material.empresa_id
  INTO v_empresa_id
  FROM public.materiais AS material
  WHERE material.id = _material_id;

  IF NOT FOUND
     OR NOT (
       public.can_write_company_module(v_empresa_id, 'gestao_materiais')
       OR public.user_has_module_action(v_empresa_id, 'gestao_materiais', 'edit')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  -- Serializes concurrent requests for the same material. A retry that
  -- arrives after the first transaction returns the stored value without
  -- consuming another sequence number.
  SELECT material.codigo_barras
  INTO v_existing_barcode
  FROM public.materiais AS material
  WHERE material.id = _material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  IF v_existing_barcode IS NOT NULL THEN
    RETURN v_existing_barcode;
  END IF;

  LOOP
    -- The UPSERT locks one counter row per company. Requests for the same
    -- company are serialized, while different companies advance independently.
    INSERT INTO public.material_barcode_counters AS counter (
      empresa_id,
      ultima_sequencia,
      updated_at
    )
    VALUES (v_empresa_id, 1, clock_timestamp())
    ON CONFLICT (empresa_id) DO UPDATE
      SET ultima_sequencia = counter.ultima_sequencia + 1,
          updated_at = clock_timestamp()
      WHERE counter.ultima_sequencia < 999999999
    RETURNING ultima_sequencia INTO v_sequence;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'A sequência de códigos de barras desta empresa atingiu o limite de 999999999.';
    END IF;

    v_sequence_text := lpad(v_sequence::text, 9, '0');
    -- "200" restricted-distribution prefix + the company sequence = the
    -- 12-digit EAN-13 payload.
    v_payload := '200' || v_sequence_text;

    -- GS1 mod-10 check digit (same as Gestão Pro calcularDvEan13): weight 1 on
    -- odd positions, weight 3 on even positions, counting from the left.
    v_sum := 0;
    FOR v_position IN 1..12 LOOP
      v_digit := substr(v_payload, v_position, 1)::integer;
      IF mod(v_position, 2) = 0 THEN
        v_digit := v_digit * 3;
      END IF;
      v_sum := v_sum + v_digit;
    END LOOP;
    v_check_digit := mod(10 - mod(v_sum, 10), 10);
    v_candidate := v_payload || v_check_digit::text;

    BEGIN
      UPDATE public.materiais
      SET codigo_barras = v_candidate,
          tipo_identificacao = CASE
            WHEN conteudo_qr_code IS NULL THEN 'codigo_barras'
            ELSE 'ambos'
          END::public.material_identification_type,
          status_identificacao = 'ativa'
      WHERE id = _material_id;

      RETURN v_candidate;
    EXCEPTION
      WHEN unique_violation THEN
        -- A manually entered barcode may already occupy this value. Keep the
        -- consumed counter and atomically try the next sequence.
        NULL;
    END;
  END LOOP;
END;
$$;

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
     OR NOT (
       public.can_write_company_module(v_empresa_id, 'gestao_materiais')
       OR public.user_has_module_action(v_empresa_id, 'gestao_materiais', 'edit')
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
     OR NOT (
       public.can_write_company_module(v_empresa_id, 'gestao_materiais')
       OR public.user_has_module_action(v_empresa_id, 'gestao_materiais', 'edit')
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

-- Assinaturas inalteradas (uuid em todas as quatro) - REVOKE/GRANT ja
-- emitidos para elas continuam validos, nao precisam ser reemitidos.

-- ============================================================================
-- 2. Storage material-photos - can_manage_material_photo_object ganha _action
-- ============================================================================

DROP POLICY IF EXISTS "Tenant administrators upload material photos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant administrators replace material photos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant administrators delete material photos" ON storage.objects;

DROP FUNCTION IF EXISTS public.can_manage_material_photo_object(text);

CREATE FUNCTION public.can_manage_material_photo_object(
  _file_path text,
  _action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_material_photo_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.materiais AS material
      WHERE material.id::text = split_part(_file_path, '/', 2)
        AND material.empresa_id::text =
            split_part(_file_path, '/', 1)
        AND (
          public.can_write_company_module(material.empresa_id, 'gestao_materiais')
          OR public.user_has_module_action(material.empresa_id, 'gestao_materiais', _action)
        )
    )
$$;

CREATE POLICY "Tenant administrators upload material photos"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name, 'create')
);

CREATE POLICY "Tenant administrators replace material photos"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name, 'edit')
)
WITH CHECK (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name, 'edit')
);

CREATE POLICY "Tenant administrators delete material photos"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name, 'delete')
);

REVOKE ALL ON FUNCTION public.can_manage_material_photo_object(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_material_photo_object(text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_manage_material_photo_object(text, text) IS
  'Autoriza upload/substituicao/exclusao no bucket material-photos: admin_empresa/master_admin via can_write_company_module, ou um usuario comum com o grant granular _action (create/edit/delete) correspondente em gestao_materiais - mesma acao que a politica RLS irma de materiais_fotos ja exige para a linha de metadados equivalente.';
