-- P1-10: the company backup only ever covered events/event_days/event_files/
-- financials. An audit of every empresa-scoped table found clientes,
-- funcionarios, event_funcionarios, event_checklist_items,
-- document_templates and generated_documents are equally "A" (company data
-- that belongs in a real recovery) and were silently absent.
--
-- This migration extends restore_company_backup (added by
-- 20260817200000_atomic_company_backup_restore.sql) to also validate and
-- restore those six tables, in the same single transaction, without
-- touching the already-atomic events/event_days/event_files/financials
-- path at all - every existing statement for that scope is left byte for
-- byte as it was.
--
-- Two different restore strategies are used, chosen per table by whether
-- anything *outside* today's backup scope can reference it:
--
--   - event_funcionarios, event_checklist_items, document_templates and
--     generated_documents are leaves: nothing outside this backup's scope
--     points at them, so they use the same delete-then-insert replace
--     already used for event_days/event_files/financials.
--
--   - clientes and funcionarios are master data other subsystems already
--     depend on today (material_locacoes.cliente_id has a hard composite
--     FK to clientes; funcionarios is looked up by id from
--     material_custodias/manutencao_ordens without a formal FK). Those
--     subsystems are NOT part of this backup yet. A delete-then-replace of
--     clientes/funcionarios would either hard-fail on the clientes FK or
--     silently orphan live custody/maintenance rows that reference a
--     funcionario_id absent from an older/partial backup. So both tables
--     are upserted (insert-if-missing, update-if-present) and never
--     deleted here - restoring a backup can only add or refresh company
--     master data, never remove a client or employee that something else
--     now depends on.
--
-- Backward compatibility: a backup created before this migration has no
-- 'clientes'/'funcionarios'/'event_funcionarios'/'event_checklist_items'/
-- 'document_templates'/'generated_documents' keys under "data" at all. Each
-- new collection is only processed when its jsonb key is actually present;
-- an old-format payload leaves all six tables completely untouched instead
-- of being treated as "restore to empty". Presence, not the payload
-- version string, is what is authoritative here - it is the one signal
-- that cannot drift out of sync with what the payload actually contains.

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
  v_clientes jsonb;
  v_funcionarios jsonb;
  v_event_funcionarios jsonb;
  v_event_checklist_items jsonb;
  v_document_templates jsonb;
  v_generated_documents jsonb;
  v_clientes_count integer := 0;
  v_funcionarios_count integer := 0;
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

  -- ---------------------------------------------------------------------
  -- New in this migration: six additional collections, each only present
  -- in payloads produced after this migration. Every one of them is
  -- optional at the jsonb level; only validate/process a table when its
  -- key actually exists under "data".
  -- ---------------------------------------------------------------------
  v_clientes := _payload -> 'data' -> 'clientes';
  v_funcionarios := _payload -> 'data' -> 'funcionarios';
  v_event_funcionarios := _payload -> 'data' -> 'event_funcionarios';
  v_event_checklist_items := _payload -> 'data' -> 'event_checklist_items';
  v_document_templates := _payload -> 'data' -> 'document_templates';
  v_generated_documents := _payload -> 'data' -> 'generated_documents';

  IF v_clientes IS NOT NULL AND jsonb_typeof(v_clientes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.clientes must be an array';
  END IF;
  IF v_funcionarios IS NOT NULL AND jsonb_typeof(v_funcionarios) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.funcionarios must be an array';
  END IF;
  IF v_event_funcionarios IS NOT NULL AND jsonb_typeof(v_event_funcionarios) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.event_funcionarios must be an array';
  END IF;
  IF v_event_checklist_items IS NOT NULL AND jsonb_typeof(v_event_checklist_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.event_checklist_items must be an array';
  END IF;
  IF v_document_templates IS NOT NULL AND jsonb_typeof(v_document_templates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.document_templates must be an array';
  END IF;
  IF v_generated_documents IS NOT NULL AND jsonb_typeof(v_generated_documents) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup payload: data.generated_documents must be an array';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      COALESCE(v_clientes, '[]'::jsonb) || COALESCE(v_funcionarios, '[]'::jsonb)
      || COALESCE(v_event_funcionarios, '[]'::jsonb) || COALESCE(v_event_checklist_items, '[]'::jsonb)
      || COALESCE(v_document_templates, '[]'::jsonb) || COALESCE(v_generated_documents, '[]'::jsonb)
    ) AS item
    WHERE jsonb_typeof(item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: collections must contain only objects';
  END IF;

  IF v_clientes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_clientes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
       OR item ->> 'tipo_pessoa' IS NULL
       OR item ->> 'created_by' IS NULL
       OR item ->> 'updated_by' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in clientes';
  END IF;

  IF v_funcionarios IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_funcionarios) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in funcionarios';
  END IF;

  IF v_event_funcionarios IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_funcionarios) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'event_id' IS NULL
       OR item ->> 'funcionario_id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in event_funcionarios';
  END IF;

  IF v_event_checklist_items IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_checklist_items) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'event_id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'categoria', '') IS NULL
       OR NULLIF(item ->> 'descricao', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in event_checklist_items';
  END IF;

  IF v_document_templates IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_document_templates) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in document_templates';
  END IF;

  IF v_generated_documents IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_generated_documents) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in generated_documents';
  END IF;

  -- Type-check the six new collections the same way as the original four.
  IF v_clientes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.clientes, v_clientes);
  END IF;
  IF v_funcionarios IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.funcionarios, v_funcionarios);
  END IF;
  IF v_event_funcionarios IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.event_funcionarios, v_event_funcionarios);
  END IF;
  IF v_event_checklist_items IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.event_checklist_items, v_event_checklist_items);
  END IF;
  IF v_document_templates IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.document_templates, v_document_templates);
  END IF;
  IF v_generated_documents IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.generated_documents, v_generated_documents);
  END IF;

  IF (v_clientes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_clientes) AS item))
     OR (v_funcionarios IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_funcionarios) AS item))
     OR (v_event_funcionarios IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_event_funcionarios) AS item))
     OR (v_event_checklist_items IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_event_checklist_items) AS item))
     OR (v_document_templates IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_document_templates) AS item))
     OR (v_generated_documents IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_generated_documents) AS item)) THEN
    RAISE EXCEPTION 'Invalid backup payload: duplicate identifiers';
  END IF;

  -- Cross-collection relationships. event_funcionarios/event_checklist_items
  -- reference events from this same payload (the events collection is
  -- always present - it is the one table backups have covered since v1.0).
  -- generated_documents references events and, optionally, a template from
  -- this same payload.
  IF (v_event_funcionarios IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_funcionarios) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event WHERE event ->> 'id' = item ->> 'event_id'
    )
  )) OR (v_event_checklist_items IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_checklist_items) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event WHERE event ->> 'id' = item ->> 'event_id'
    )
  )) OR (v_generated_documents IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_generated_documents) AS item
    WHERE (
      NULLIF(item ->> 'event_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_events) AS event WHERE event ->> 'id' = item ->> 'event_id'
      )
    ) OR (
      NULLIF(item ->> 'template_id', '') IS NOT NULL
      AND v_document_templates IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_document_templates) AS tmpl WHERE tmpl ->> 'id' = item ->> 'template_id'
      )
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: broken relationships in the new collections';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('restore_company_backup:' || v_company_id::text, 0)
  );

  -- clientes/funcionarios are upserted, never deleted here: material_locacoes
  -- has a hard FK to clientes and material_custodias/manutencao_ordens look
  -- funcionarios up by id, and none of those tables are part of this backup
  -- yet. Refreshing or adding a client/employee is always safe; removing one
  -- because it is absent from an older or partial backup is not.
  IF v_clientes IS NOT NULL THEN
    INSERT INTO public.clientes (
      id, empresa_id, nome, nome_fantasia, tipo_pessoa, cpf_cnpj, email,
      telefone, observacoes, ativo, created_by, updated_by, created_at, updated_at
    )
    SELECT
      customer.id, v_company_id, customer.nome, customer.nome_fantasia,
      customer.tipo_pessoa, customer.cpf_cnpj, customer.email, customer.telefone,
      customer.observacoes, COALESCE(customer.ativo, true), customer.created_by,
      customer.updated_by, COALESCE(customer.created_at, now()),
      COALESCE(customer.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.clientes, v_clientes) AS customer
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, nome_fantasia = EXCLUDED.nome_fantasia,
      tipo_pessoa = EXCLUDED.tipo_pessoa, cpf_cnpj = EXCLUDED.cpf_cnpj,
      email = EXCLUDED.email, telefone = EXCLUDED.telefone,
      observacoes = EXCLUDED.observacoes, ativo = EXCLUDED.ativo,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.clientes.empresa_id = v_company_id;
    GET DIAGNOSTICS v_clientes_count = ROW_COUNT;
  END IF;

  IF v_funcionarios IS NOT NULL THEN
    INSERT INTO public.funcionarios (
      id, empresa_id, nome, funcao, cache_padrao, tipo, created_at, updated_at
    )
    SELECT
      employee.id, v_company_id, employee.nome, COALESCE(employee.funcao, ''),
      COALESCE(employee.cache_padrao, 0), COALESCE(employee.tipo, 'equipe'),
      COALESCE(employee.created_at, now()), COALESCE(employee.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.funcionarios, v_funcionarios) AS employee
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, funcao = EXCLUDED.funcao,
      cache_padrao = EXCLUDED.cache_padrao, tipo = EXCLUDED.tipo, updated_at = now()
    WHERE public.funcionarios.empresa_id = v_company_id;
    GET DIAGNOSTICS v_funcionarios_count = ROW_COUNT;
  END IF;

  -- event_funcionarios references funcionarios (just upserted above, so any
  -- id already present live but absent from this payload's funcionarios
  -- collection still resolves).
  IF v_event_funcionarios IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event_funcionarios) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.funcionarios AS f
      WHERE f.id = (item ->> 'funcionario_id')::uuid AND f.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: event_funcionarios references a funcionario that does not exist in this company';
  END IF;

  -- Preserve the former delete order. Deleting events last also preserves the
  -- existing cascade semantics for event-owned tables outside this backup's
  -- intentionally unchanged scope.
  DELETE FROM public.event_files
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  DELETE FROM public.event_days
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  DELETE FROM public.financials
  WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);

  IF v_event_funcionarios IS NOT NULL THEN
    DELETE FROM public.event_funcionarios
    WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  END IF;
  IF v_event_checklist_items IS NOT NULL THEN
    DELETE FROM public.event_checklist_items
    WHERE event_id IN (SELECT id FROM public.events WHERE empresa_id = v_company_id);
  END IF;
  IF v_generated_documents IS NOT NULL THEN
    DELETE FROM public.generated_documents WHERE empresa_id = v_company_id;
  END IF;
  IF v_document_templates IS NOT NULL THEN
    DELETE FROM public.document_templates WHERE empresa_id = v_company_id;
  END IF;

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

  IF v_document_templates IS NOT NULL THEN
    INSERT INTO public.document_templates (
      id, empresa_id, nome, tipo, conteudo, variaveis, ativo, created_at, updated_at
    )
    SELECT
      tmpl.id, v_company_id, tmpl.nome, COALESCE(tmpl.tipo, 'contrato'),
      COALESCE(tmpl.conteudo, ''), COALESCE(tmpl.variaveis, '[]'::jsonb),
      COALESCE(tmpl.ativo, true), COALESCE(tmpl.created_at, now()),
      COALESCE(tmpl.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.document_templates, v_document_templates) AS tmpl;
  END IF;

  IF v_generated_documents IS NOT NULL THEN
    INSERT INTO public.generated_documents (
      id, empresa_id, event_id, template_id, nome, tipo, conteudo_final, dados, created_at
    )
    SELECT
      doc.id, v_company_id, doc.event_id, doc.template_id, doc.nome,
      COALESCE(doc.tipo, 'contrato'), COALESCE(doc.conteudo_final, ''),
      COALESCE(doc.dados, '{}'::jsonb), COALESCE(doc.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.generated_documents, v_generated_documents) AS doc;
  END IF;

  IF v_event_funcionarios IS NOT NULL THEN
    INSERT INTO public.event_funcionarios (id, event_id, funcionario_id, empresa_id, created_at)
    SELECT
      link.id, link.event_id, link.funcionario_id, v_company_id,
      COALESCE(link.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.event_funcionarios, v_event_funcionarios) AS link;
  END IF;

  IF v_event_checklist_items IS NOT NULL THEN
    INSERT INTO public.event_checklist_items (
      id, empresa_id, event_id, categoria, descricao, ordem, concluido, observacao, created_at, updated_at
    )
    SELECT
      item.id, v_company_id, item.event_id, item.categoria, item.descricao,
      COALESCE(item.ordem, 0), COALESCE(item.concluido, false), item.observacao,
      COALESCE(item.created_at, now()), COALESCE(item.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.event_checklist_items, v_event_checklist_items) AS item;
  END IF;

  RETURN jsonb_build_object(
    'empresa_id', v_company_id,
    'events', jsonb_array_length(v_events),
    'event_days', jsonb_array_length(v_event_days),
    'event_files', jsonb_array_length(v_event_files),
    'financials', jsonb_array_length(v_financials),
    'clientes', v_clientes_count,
    'funcionarios', v_funcionarios_count,
    'event_funcionarios', CASE WHEN v_event_funcionarios IS NOT NULL THEN jsonb_array_length(v_event_funcionarios) ELSE 0 END,
    'event_checklist_items', CASE WHEN v_event_checklist_items IS NOT NULL THEN jsonb_array_length(v_event_checklist_items) ELSE 0 END,
    'document_templates', CASE WHEN v_document_templates IS NOT NULL THEN jsonb_array_length(v_document_templates) ELSE 0 END,
    'generated_documents', CASE WHEN v_generated_documents IS NOT NULL THEN jsonb_array_length(v_generated_documents) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_company_backup(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_company_backup(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.restore_company_backup(uuid, jsonb) IS
  'Atomically validates and restores the company backup scope for the authenticated administrator company: events/event_days/event_files/financials (delete+replace) plus clientes/funcionarios (upsert, never deleted) and event_funcionarios/event_checklist_items/document_templates/generated_documents (delete+replace) when present in the payload. Any failure rolls back every change. Collections absent from an older backup are left untouched.';

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
