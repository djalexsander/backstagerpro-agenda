-- Backstage Pro - align the automatic material barcode with the Gestão Pro
-- standard: a valid 13-digit EAN-13 in the "200" internal-use range.
--
-- Only the *format* of the generated value changes. Everything that makes the
-- generator safe is kept byte for byte:
--   * SECURITY DEFINER + fixed search_path;
--   * the can_write_company_module('gestao_materiais') gate (SQLSTATE 42501);
--   * the FOR UPDATE lock + "return the code that already exists" short-circuit
--     that makes retries idempotent;
--   * the per-company material_barcode_counters row, consumed atomically, which
--     is what guarantees uniqueness per company (never a random draw);
--   * the unique_violation retry loop and the 999999999 exhaustion error.
--
-- New layout (13 digits): "200" + the 9-digit company sequence + 1 EAN-13
-- check digit. "200" is the GS1 restricted-distribution prefix Gestão Pro also
-- uses for internally issued codes (src/lib/barcode.ts -> gerarEan13("200")).
-- The 9-digit counter body is exactly the 12-digit EAN-13 payload minus that
-- prefix, so no counter change is needed.
--
-- The check digit is the standard GS1 mod-10 weight 1/3 algorithm, identical to
-- Gestão Pro's calcularDvEan13: over the 12 payload digits (1-indexed from the
-- left) odd positions weigh 1, even positions weigh 3; the digit is whatever
-- raises the weighted sum to the next multiple of ten.
--
-- Existing codes are untouched: CREATE OR REPLACE only swaps the function body,
-- there is no UPDATE over public.materiais here. Manually typed or legacy codes
-- keep being returned unchanged by the short-circuit above. replace_material_
-- barcode is unchanged - it already delegates its final value to this function,
-- so it now returns the new EAN-13 for free.

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
     OR NOT public.can_write_company_module(
       v_empresa_id,
       'gestao_materiais'
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

REVOKE ALL ON FUNCTION public.generate_material_barcode(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_material_barcode(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.generate_material_barcode(uuid) IS
  'Returns an existing barcode unchanged or atomically assigns the next company-local EAN-13: "200" + a 9-digit per-company sequence + a GS1 mod-10 check digit. Fails explicitly after sequence 999999999.';
