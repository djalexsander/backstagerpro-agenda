-- Backstage Pro - short, tenant-scoped material barcodes.
-- Existing and manually entered barcodes are intentionally left untouched.

CREATE TABLE public.material_barcode_counters (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  ultima_sequencia integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_barcode_counters_range
    CHECK (ultima_sequencia BETWEEN 0 AND 999999999)
);

ALTER TABLE public.material_barcode_counters ENABLE ROW LEVEL SECURITY;

-- Only the SECURITY DEFINER generator may consume the counter. Clients do
-- not need direct visibility or mutation privileges for this internal state.
REVOKE ALL ON public.material_barcode_counters FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.material_barcode_counters IS
  'Internal per-company counter used atomically by generate_material_barcode. It never rewrites existing material barcodes.';

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

    -- Luhn over the nine-digit sequence. Since the check digit is appended
    -- at position 10, digits in odd positions from the left are doubled.
    v_sum := 0;
    FOR v_position IN 1..9 LOOP
      v_digit := substr(v_sequence_text, v_position, 1)::integer;
      IF mod(v_position, 2) = 1 THEN
        v_digit := v_digit * 2;
        IF v_digit > 9 THEN
          v_digit := v_digit - 9;
        END IF;
      END IF;
      v_sum := v_sum + v_digit;
    END LOOP;
    v_check_digit := mod(10 - mod(v_sum, 10), 10);
    v_candidate := v_sequence_text || v_check_digit::text;

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
        -- A manual ten-digit barcode may already occupy this value. Keep the
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
  'Returns an existing barcode unchanged or atomically assigns the next company-local 9-digit sequence plus a Luhn check digit. Fails explicitly after sequence 999999999.';
