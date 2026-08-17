-- P0-5: move backup restoration from multiple independent PostgREST writes
-- into one PostgreSQL function invocation. A function call runs in the
-- caller transaction, so any validation, delete or insert failure rolls the
-- complete restore back.

CREATE OR REPLACE FUNCTION public.restore_company_backup(
  _empresa_id uuid,
  _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid;
  v_events jsonb;
  v_event_days jsonb;
  v_event_files jsonb;
  v_financials jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Authentication is required to restore a backup';
  END IF;

  v_company_id := public.get_user_empresa_id(v_actor_id);

  IF v_company_id IS NULL OR _empresa_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Backup restore is restricted to the authenticated user company';
  END IF;

  PERFORM public.assert_actor_company_operational_access(
    v_actor_id,
    v_company_id,
    NULL
  );

  -- Validate the complete envelope and all collection types before acquiring
  -- the restore lock or deleting any row.
  IF _payload IS NULL
     OR jsonb_typeof(_payload) <> 'object'
     OR jsonb_typeof(_payload -> 'meta') <> 'object'
     OR jsonb_typeof(_payload -> 'data') <> 'object' THEN
    RAISE EXCEPTION 'Invalid backup payload: expected meta and data objects';
  END IF;

  IF (_payload -> 'meta' ->> 'empresa_id') IS DISTINCT FROM v_company_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Backup payload company does not match the authenticated user company';
  END IF;

  v_events := _payload -> 'data' -> 'eventos';
  v_event_days := _payload -> 'data' -> 'event_days';
  v_event_files := _payload -> 'data' -> 'event_files';
  v_financials := _payload -> 'data' -> 'financials';

  IF jsonb_typeof(v_events) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_event_days) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_event_files) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_financials) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: all data collections must be arrays';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events || v_event_days || v_event_files || v_financials) AS item
    WHERE jsonb_typeof(item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: collections must contain only objects';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_events) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'name', '') IS NULL
       OR NULLIF(item ->> 'artist', '') IS NULL
       OR item ->> 'date' IS NULL
       OR NULLIF(item ->> 'city', '') IS NULL
       OR NULLIF(item ->> 'venue', '') IS NULL
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_days) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'event_id' IS NULL
       OR item ->> 'day_number' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_files) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'event_id' IS NULL
       OR NULLIF(item ->> 'file_path', '') IS NULL
       OR NULLIF(item ->> 'file_name', '') IS NULL
       OR item ->> 'file_type' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financials) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'event_id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid';
  END IF;

  -- Force PostgreSQL to parse every value into its real table type before
  -- destructive work. This catches malformed UUIDs, dates, enums and numbers.
  PERFORM 1 FROM jsonb_populate_recordset(NULL::public.events, v_events);
  PERFORM 1 FROM jsonb_populate_recordset(NULL::public.event_days, v_event_days);
  PERFORM 1 FROM jsonb_populate_recordset(NULL::public.event_files, v_event_files);
  PERFORM 1 FROM jsonb_populate_recordset(NULL::public.financials, v_financials);

  IF (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_events) AS item)
     OR (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_event_days) AS item)
     OR (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_event_files) AS item)
     OR (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_financials) AS item)
     OR (SELECT count(*) <> count(DISTINCT item ->> 'event_id') FROM jsonb_array_elements(v_financials) AS item) THEN
    RAISE EXCEPTION 'Invalid backup payload: duplicate identifiers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_event_days) AS day
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event
      WHERE event ->> 'id' = day ->> 'event_id'
    )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_event_files) AS file
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event
      WHERE event ->> 'id' = file ->> 'event_id'
    )
       OR (
         NULLIF(file ->> 'event_day_id', '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_event_days) AS day
           WHERE day ->> 'id' = file ->> 'event_day_id'
             AND day ->> 'event_id' = file ->> 'event_id'
         )
       )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_financials) AS financial
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event
      WHERE event ->> 'id' = financial ->> 'event_id'
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: broken event relationships';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('restore_company_backup:' || v_company_id::text, 0)
  );

  -- Preserve the former delete order. Deleting events last also preserves the
  -- existing cascade semantics for event-owned tables outside this backup's
  -- intentionally unchanged scope.
  DELETE FROM public.event_files
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  DELETE FROM public.event_days
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  DELETE FROM public.financials
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  DELETE FROM public.events WHERE empresa_id = v_company_id;

  INSERT INTO public.events (
    id, date, status, name, artist, city, venue, show_time,
    logistics_departure, observations, material_list, created_by,
    created_at, updated_at, empresa_id, num_days
  )
  SELECT
    event.id, event.date, COALESCE(event.status, 'pendente'::public.event_status),
    event.name, event.artist, event.city, event.venue, event.show_time,
    event.logistics_departure, event.observations, event.material_list,
    event.created_by, COALESCE(event.created_at, now()),
    COALESCE(event.updated_at, now()), v_company_id,
    COALESCE(event.num_days, 1)
  FROM jsonb_populate_recordset(NULL::public.events, v_events) AS event;

  INSERT INTO public.event_days (
    id, event_id, day_number, date, artist, show_time, observations,
    created_at, updated_at, empresa_id
  )
  SELECT
    day.id, day.event_id, day.day_number, day.date, day.artist, day.show_time,
    day.observations, COALESCE(day.created_at, now()),
    COALESCE(day.updated_at, now()), v_company_id
  FROM jsonb_populate_recordset(NULL::public.event_days, v_event_days) AS day;

  INSERT INTO public.event_files (
    id, event_id, file_type, file_path, file_name, created_at,
    empresa_id, event_day_id
  )
  SELECT
    file.id, file.event_id, file.file_type, file.file_path, file.file_name,
    COALESCE(file.created_at, now()), v_company_id, file.event_day_id
  FROM jsonb_populate_recordset(NULL::public.event_files, v_event_files) AS file;

  INSERT INTO public.financials (
    id, event_id, cache, transport, food, lodging, other_costs,
    created_at, updated_at, empresa_id, funcionarios_cache, extra_costs,
    cache_detail, transport_detail, lodging_detail
  )
  SELECT
    financial.id, financial.event_id, financial.cache, financial.transport,
    financial.food, financial.lodging, financial.other_costs,
    COALESCE(financial.created_at, now()), COALESCE(financial.updated_at, now()),
    v_company_id, financial.funcionarios_cache, financial.extra_costs,
    financial.cache_detail, financial.transport_detail, financial.lodging_detail
  FROM jsonb_populate_recordset(NULL::public.financials, v_financials) AS financial;

  RETURN jsonb_build_object(
    'empresa_id', v_company_id,
    'events', jsonb_array_length(v_events),
    'event_days', jsonb_array_length(v_event_days),
    'event_files', jsonb_array_length(v_event_files),
    'financials', jsonb_array_length(v_financials)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_company_backup(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_company_backup(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.restore_company_backup(uuid, jsonb) IS
  'Atomically validates and restores the existing event backup scope for the authenticated administrator company. Any failure rolls back all deletes and inserts.';

DO $$
DECLARE
  v_fn regprocedure := 'public.restore_company_backup(uuid,jsonb)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'restore_company_backup privileges are not hardened as expected';
  END IF;
END;
$$;
