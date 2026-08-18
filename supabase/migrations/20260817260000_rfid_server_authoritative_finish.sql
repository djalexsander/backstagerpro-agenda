-- P1-6: RFID read-session results must be derived from persisted session data.

ALTER TABLE public.rfid_read_sessions
  ADD COLUMN expected_material_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN read_epcs text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.rfid_read_sessions
  ADD CONSTRAINT rfid_read_sessions_expected_no_nulls
    CHECK (array_position(expected_material_ids, NULL) IS NULL),
  ADD CONSTRAINT rfid_read_sessions_epcs_no_nulls
    CHECK (array_position(read_epcs, NULL) IS NULL);

-- Expected materials are the session's immutable baseline. Reads may only be
-- appended while the session is open, through rfid_record_read_session_epcs.
CREATE OR REPLACE FUNCTION public.prepare_rfid_read_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.referencia_tipo := nullif(btrim(NEW.referencia_tipo), '');
  NEW.dispositivo_label := nullif(btrim(NEW.dispositivo_label), '');

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('concluida', 'cancelada') THEN
      RAISE EXCEPTION 'Sessão de conferência encerrada é imutável';
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.responsavel_user_id IS DISTINCT FROM OLD.responsavel_user_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.expected_material_ids IS DISTINCT FROM OLD.expected_material_ids THEN
      RAISE EXCEPTION 'Campos de identidade da sessão são imutáveis';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- New overload used by current clients. The four-argument overload below is
-- kept as a compatibility wrapper for already deployed callers.
CREATE OR REPLACE FUNCTION public.rfid_start_read_session(
  _tipo public.rfid_read_session_type,
  _referencia_tipo text,
  _referencia_id uuid,
  _dispositivo_label text,
  _expected_material_ids uuid[]
)
RETURNS public.rfid_read_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_expected_material_ids uuid[] := '{}'::uuid[];
  v_result public.rfid_read_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_empresa_id := public.get_user_empresa_id(auth.uid());

  IF v_empresa_id IS NULL
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sem permissão para iniciar conferência RFID.';
  END IF;

  IF (_referencia_tipo IS NULL) <> (_referencia_id IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'RF006',
      MESSAGE = 'Tipo e identificador da referência devem ser informados juntos.';
  END IF;

  IF nullif(btrim(_referencia_tipo), '') = 'locacao' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.material_locacoes AS rental
      WHERE rental.id = _referencia_id
        AND rental.empresa_id = v_empresa_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Locação não encontrada ou sem permissão.';
    END IF;

    SELECT COALESCE(array_agg(item.material_id ORDER BY item.material_id), '{}'::uuid[])
    INTO v_expected_material_ids
    FROM public.material_locacao_itens AS item
    JOIN public.materiais AS material
      ON material.id = item.material_id
     AND material.empresa_id = item.empresa_id
    WHERE item.empresa_id = v_empresa_id
      AND item.locacao_id = _referencia_id
      AND material.tipo_controle = 'individual';
  ELSE
    IF EXISTS (
      SELECT 1
      FROM unnest(COALESCE(_expected_material_ids, '{}'::uuid[])) AS requested(material_id)
      LEFT JOIN public.materiais AS material
        ON material.id = requested.material_id
       AND material.empresa_id = v_empresa_id
       AND material.tipo_controle = 'individual'
      WHERE material.id IS NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Material esperado não encontrado ou sem permissão.';
    END IF;

    SELECT COALESCE(array_agg(deduplicated.material_id ORDER BY deduplicated.first_position), '{}'::uuid[])
    INTO v_expected_material_ids
    FROM (
      SELECT requested.material_id, min(requested.position) AS first_position
      FROM unnest(COALESCE(_expected_material_ids, '{}'::uuid[]))
        WITH ORDINALITY AS requested(material_id, position)
      GROUP BY requested.material_id
    ) AS deduplicated;
  END IF;

  INSERT INTO public.rfid_read_sessions (
    empresa_id, tipo, referencia_tipo, referencia_id,
    dispositivo_label, responsavel_user_id, status, started_at,
    expected_material_ids, read_epcs
  )
  VALUES (
    v_empresa_id, _tipo, _referencia_tipo, _referencia_id,
    _dispositivo_label, auth.uid(), 'em_andamento', clock_timestamp(),
    v_expected_material_ids, '{}'::text[]
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rfid_start_read_session(
  _tipo public.rfid_read_session_type,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _dispositivo_label text DEFAULT NULL
)
RETURNS public.rfid_read_sessions
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.rfid_start_read_session(
    _tipo, _referencia_tipo, _referencia_id, _dispositivo_label, '{}'::uuid[]
  );
$$;

CREATE OR REPLACE FUNCTION public.rfid_record_read_session_epcs(
  _session_id uuid,
  _epcs text[]
)
RETURNS public.rfid_read_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_status public.rfid_read_session_status;
  v_normalized_epcs text[];
  v_result public.rfid_read_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  SELECT session.empresa_id, session.status
  INTO v_empresa_id, v_status
  FROM public.rfid_read_sessions AS session
  WHERE session.id = _session_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sessão não encontrada ou sem permissão.';
  END IF;

  IF v_status <> 'em_andamento' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF008', MESSAGE = 'Esta sessão já foi encerrada.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(_epcs, '{}'::text[])) AS supplied(epc)
    WHERE supplied.epc IS NULL
       OR upper(btrim(supplied.epc)) !~ '^[0-9A-F]{8,64}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'RF001', MESSAGE = 'EPC inválido.';
  END IF;

  SELECT COALESCE(array_agg(normalized.epc ORDER BY normalized.first_position), '{}'::text[])
  INTO v_normalized_epcs
  FROM (
    SELECT upper(btrim(supplied.epc)) AS epc, min(supplied.position) AS first_position
    FROM unnest(COALESCE(_epcs, '{}'::text[]))
      WITH ORDINALITY AS supplied(epc, position)
    GROUP BY upper(btrim(supplied.epc))
  ) AS normalized;

  UPDATE public.rfid_read_sessions AS session
  SET read_epcs = (
    SELECT COALESCE(array_agg(combined.epc ORDER BY combined.first_position), '{}'::text[])
    FROM (
      SELECT candidate.epc, min(candidate.position) AS first_position
      FROM unnest(session.read_epcs || v_normalized_epcs)
        WITH ORDINALITY AS candidate(epc, position)
      GROUP BY candidate.epc
    ) AS combined
  )
  WHERE session.id = _session_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Canonical finish signature. It accepts only identity and final status; all
-- counts and the result snapshot come from the session's persisted arrays.
CREATE OR REPLACE FUNCTION public.rfid_finish_read_session(
  _session_id uuid,
  _status public.rfid_read_session_status
)
RETURNS public.rfid_read_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.rfid_read_sessions;
  v_expected_count integer;
  v_found_count integer;
  v_missing_count integer;
  v_unexpected_count integer;
  v_unknown_count integer;
  v_resultado jsonb;
  v_result public.rfid_read_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF _status = 'em_andamento' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF007', MESSAGE = 'Status final inválido.';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.rfid_read_sessions AS session
  WHERE session.id = _session_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_session.empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sessão não encontrada ou sem permissão.';
  END IF;

  IF v_session.status <> 'em_andamento' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF008', MESSAGE = 'Esta sessão já foi encerrada.';
  END IF;

  IF _status = 'concluida' THEN
    WITH expected AS (
      SELECT material_id, position
      FROM unnest(v_session.expected_material_ids)
        WITH ORDINALITY AS item(material_id, position)
    ),
    reads AS (
      SELECT epc, position
      FROM unnest(v_session.read_epcs)
        WITH ORDINALITY AS reading(epc, position)
    ),
    resolved AS (
      SELECT reads.epc, reads.position, matched.material_id, matched.status
      FROM reads
      LEFT JOIN LATERAL (
        SELECT tag.material_id, tag.status
        FROM public.rfid_tags AS tag
        WHERE tag.empresa_id = v_session.empresa_id
          AND tag.epc = reads.epc
        ORDER BY (tag.status = 'ativa') DESC, tag.vinculada_em DESC
        LIMIT 1
      ) AS matched ON true
    ),
    found AS (
      SELECT resolved.material_id, resolved.epc, resolved.position
      FROM resolved
      WHERE resolved.status = 'ativa'
        AND EXISTS (SELECT 1 FROM expected WHERE expected.material_id = resolved.material_id)
    ),
    missing AS (
      SELECT expected.material_id, expected.position
      FROM expected
      WHERE NOT EXISTS (SELECT 1 FROM found WHERE found.material_id = expected.material_id)
    ),
    unexpected AS (
      SELECT resolved.material_id, resolved.epc, resolved.position
      FROM resolved
      WHERE resolved.status = 'ativa'
        AND NOT EXISTS (SELECT 1 FROM expected WHERE expected.material_id = resolved.material_id)
    ),
    unknown AS (
      SELECT resolved.epc, resolved.position
      FROM resolved
      WHERE resolved.material_id IS NULL
    ),
    inactive AS (
      SELECT resolved.material_id, resolved.epc, resolved.position
      FROM resolved
      WHERE resolved.material_id IS NOT NULL
        AND resolved.status <> 'ativa'
    )
    SELECT
      (SELECT count(*)::integer FROM expected),
      (SELECT count(*)::integer FROM found),
      (SELECT count(*)::integer FROM missing),
      (SELECT count(*)::integer FROM unexpected),
      (SELECT count(*)::integer FROM unknown),
      jsonb_build_object(
        'found', COALESCE((SELECT jsonb_agg(material_id ORDER BY position) FROM found), '[]'::jsonb),
        'missing', COALESCE((SELECT jsonb_agg(material_id ORDER BY position) FROM missing), '[]'::jsonb),
        'unexpected', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('materialId', material_id, 'epc', epc) ORDER BY position)
          FROM unexpected
        ), '[]'::jsonb),
        'unknown', COALESCE((SELECT jsonb_agg(epc ORDER BY position) FROM unknown), '[]'::jsonb),
        'inactiveTag', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('materialId', material_id, 'epc', epc) ORDER BY position)
          FROM inactive
        ), '[]'::jsonb)
      )
    INTO
      v_expected_count, v_found_count, v_missing_count,
      v_unexpected_count, v_unknown_count, v_resultado;
  END IF;

  UPDATE public.rfid_read_sessions
  SET status = _status,
      finished_at = clock_timestamp(),
      expected_count = CASE WHEN _status = 'concluida' THEN v_expected_count END,
      found_count = CASE WHEN _status = 'concluida' THEN v_found_count END,
      missing_count = CASE WHEN _status = 'concluida' THEN v_missing_count END,
      unexpected_count = CASE WHEN _status = 'concluida' THEN v_unexpected_count END,
      unknown_count = CASE WHEN _status = 'concluida' THEN v_unknown_count END,
      resultado = CASE WHEN _status = 'concluida' THEN v_resultado END
  WHERE id = _session_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Compatibility wrapper: old clients may still send forged counts/snapshot,
-- but every legacy argument is deliberately ignored by the canonical RPC.
DROP FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
);

CREATE OR REPLACE FUNCTION public.rfid_finish_read_session(
  _session_id uuid,
  _status public.rfid_read_session_status,
  _expected_count integer,
  _found_count integer,
  _missing_count integer,
  _unexpected_count integer,
  _unknown_count integer,
  _resultado jsonb
)
RETURNS public.rfid_read_sessions
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.rfid_finish_read_session(_session_id, _status);
$$;

REVOKE ALL ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text, uuid[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfid_record_read_session_epcs(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text, uuid[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_record_read_session_epcs(uuid, text[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
) TO authenticated;

COMMENT ON COLUMN public.rfid_read_sessions.expected_material_ids IS
  'Immutable expected material ids persisted when the session starts; rental sessions derive them server-side.';
COMMENT ON COLUMN public.rfid_read_sessions.read_epcs IS
  'Normalized distinct EPC observations persisted before server-side reconciliation; not raw radio events.';
COMMENT ON FUNCTION public.rfid_record_read_session_epcs(uuid, text[]) IS
  'Appends normalized distinct EPCs to an open same-company RFID session.';
COMMENT ON FUNCTION public.rfid_finish_read_session(uuid, public.rfid_read_session_status) IS
  'Finalizes an open same-company session and derives every count/result from persisted expected materials and EPCs.';
