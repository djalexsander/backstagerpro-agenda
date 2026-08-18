-- P1-10C: extends restore_company_backup and gather_company_backup_data
-- (both added/extended by 20260817200000, 20260818090000 and
-- 20260818120000 - all already applied) to cover the last three areas
-- explicitly deferred until now: RFID (rfid_tags, rfid_read_sessions),
-- etiquetas/impressão (etiqueta_modelos, etiqueta_impressoes,
-- etiqueta_solicitacoes, etiqueta_solicitacao_itens) and the company's
-- SHARED printer/bobina configuration (empresa_bobina_perfis,
-- empresa_impressora_config). Local per-terminal printer overrides live in
-- localStorage/desktop config and are explicitly out of scope - nothing
-- here reads or writes them.
--
-- Same rule as every extension before this one: reuses the existing atomic
-- restore_company_backup and gather_company_backup_data functions (no
-- second backup architecture), extends them via CREATE OR REPLACE, and
-- every existing line for previously-covered scope is left byte for byte
-- as it was.
--
-- ---------------------------------------------------------------------
-- Per-table strategy (audited against these eight tables' own triggers
-- and FKs only - not a general re-audit):
--
--   - rfid_tags: UPSERT (ON CONFLICT (id) DO UPDATE), never deleted.
--     prepare_material_write_style reasoning does not apply here (no
--     identity-regeneration trigger), but two real constraints do:
--     epc/material_id/empresa_id are immutable once set
--     (prepare_rfid_tag_write, BEFORE INSERT OR UPDATE), and - the
--     specific rule this task calls out - "a deactivated tag can never be
--     reactivated" is already enforced by that same trigger
--     (`OLD.status <> 'ativa' AND NEW.status = 'ativa'` raises
--     unconditionally, no bypass). Rather than let a time-skew restore
--     (an older backup with the tag still 'ativa', replayed after it was
--     legitimately deactivated live) abort the whole transaction on that
--     RAISE, the UPDATE branch's own WHERE clause excludes exactly that
--     case, so the row is silently left exactly as it is instead - the
--     live, more-progressed deactivation wins, matching "não reativar tag
--     historicamente desativada por engano" as a graceful skip rather
--     than a hard failure.
--   - rfid_read_sessions: INSERT ... ON CONFLICT (id) DO NOTHING.
--     prepare_rfid_read_session_write blocks any UPDATE once
--     status IN ('concluida','cancelada') with no bypass, so an UPSERT
--     that re-touches an already-finished session would abort the
--     restore even when replaying identical values. Treating every
--     session as append-only (never attempt UPDATE at all) sidesteps
--     that entirely and is exactly as safe: a session id that already
--     exists, finished or not, is simply left untouched.
--   - etiqueta_modelos: UPSERT, never deleted (configuration/reference
--     data, same treatment as categorias_materiais in 20260818120000).
--     Guarded by the existing backstage.material_labels_write bypass
--     (BEFORE INSERT OR UPDATE OR DELETE, reused as-is, no new flag).
--   - etiqueta_impressoes: INSERT ... ON CONFLICT (id) DO NOTHING.
--     protect_material_label_projection (BEFORE INSERT only, same
--     existing bypass) + protect_material_label_history (BEFORE UPDATE
--     OR DELETE, unconditional, no bypass) together make this an
--     append-only print-history ledger by construction - restoring never
--     re-executes a print, it replays the historical request/audit row.
--   - etiqueta_solicitacoes / etiqueta_solicitacao_itens: INSERT ...
--     ON CONFLICT (id) DO NOTHING for both. protect_material_label_batch_history
--     (BEFORE INSERT OR UPDATE OR DELETE) only ever allows INSERT, gated
--     by its own existing bypass flag backstage.material_label_batch_write
--     (reused as-is); UPDATE/DELETE are unconditionally blocked. The
--     DEFERRABLE INITIALLY DEFERRED completeness constraint trigger on
--     both tables (quantidade_materiais/quantidade_etiquetas must match
--     the actual item rows) checks at transaction commit, not per
--     statement, so restoring solicitacoes then itens in two separate
--     statements - same order as everywhere else in this function -
--     resolves correctly regardless.
--   - empresa_bobina_perfis / empresa_impressora_config: UPSERT, never
--     deleted - plain configuration tables with no protective trigger at
--     all (RLS-only, bypassed like every other table here by this
--     function's own SECURITY DEFINER). empresa_bobina_perfis is
--     restored first (empresa_impressora_config.perfil_bobina_padrao_id
--     references it, ON DELETE SET NULL). empresa_impressora_config is
--     upserted on its real business key (empresa_id, finalidade) - the
--     same conflict target its own canonical RPC
--     (salvar_configuracao_impressora) already uses - rather than id, for
--     the same reason estoque_saldos was keyed on
--     (empresa_id, material_id, localizacao_id) in 20260818120000: the
--     "same" per-purpose config could exist live under a different id.
--
-- No new trigger-bypass GUC flags are introduced. RFID has no bypassable
-- trigger to begin with (its rules are hard business invariants that a
-- faithful historical replay satisfies on its own, plus the graceful-skip
-- WHERE clause above); etiquetas/impressão reuse the two flags already
-- shipped for their own canonical RPCs
-- (backstage.material_labels_write, backstage.material_label_batch_write).
--
-- Restoration order (appended after financeiro_recebimentos, the last
-- step of the existing function - nothing before that point is touched):
-- rfid_tags -> rfid_read_sessions -> etiqueta_modelos ->
-- etiqueta_impressoes -> etiqueta_solicitacoes ->
-- etiqueta_solicitacao_itens -> empresa_bobina_perfis ->
-- empresa_impressora_config. rfid_tags/etiqueta_impressoes/
-- etiqueta_solicitacao_itens need materiais, already restored in step 2
-- of the existing chain; nothing else in this batch depends on anything
-- from steps 3-16.
--
-- Known, disclosed limitations (not silently decided, same posture as
-- every prior step): a live rfid_tags row can keep its own id "ativa"
-- while an OLDER backup's DIFFERENT tag id for the same material or EPC
-- also claims 'ativa' - the two partial unique indexes
-- (rfid_tags_material_ativa_uidx, rfid_tags_empresa_epc_ativa_uidx) would
-- then raise a real, clear constraint violation rather than something
-- silently resolved here; the same "let a genuine unique-index collision
-- surface as an honest error" choice already made for
-- estoque_localizacoes' codigo/nome and financeiro_lancamentos'
-- origem_unica in 20260818120000 applies identically to
-- etiqueta_modelos' name/default-model indexes and
-- empresa_bobina_perfis' name/default-profile indexes.
-- ---------------------------------------------------------------------
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
  -- P1-10B: operational core (materiais -> financeiro).
  v_categorias jsonb;
  v_materiais jsonb;
  v_estoque_localizacoes jsonb;
  v_estoque_saldos jsonb;
  v_estoque_movimentacoes jsonb;
  v_material_custodias jsonb;
  v_material_custodia_eventos jsonb;
  v_material_locacoes jsonb;
  v_material_locacao_itens jsonb;
  v_material_locacao_eventos jsonb;
  v_manutencao_ordens jsonb;
  v_manutencao_ordem_insumos jsonb;
  v_manutencao_ordem_eventos jsonb;
  v_financeiro_lancamentos jsonb;
  v_financeiro_parcelas jsonb;
  v_financeiro_recebimentos jsonb;
  v_categorias_count integer := 0;
  v_materiais_count integer := 0;
  v_estoque_localizacoes_count integer := 0;
  v_estoque_saldos_count integer := 0;
  v_material_custodias_count integer := 0;
  v_material_locacoes_count integer := 0;
  v_material_locacao_itens_count integer := 0;
  v_manutencao_ordens_count integer := 0;
  v_manutencao_ordem_insumos_count integer := 0;
  v_financeiro_lancamentos_count integer := 0;
  v_financeiro_parcelas_count integer := 0;
  v_op_core_reachable integer;
  -- P1-10C: RFID, etiquetas/impressão, configuração compartilhada de bobina/impressora.
  v_rfid_tags jsonb;
  v_rfid_read_sessions jsonb;
  v_etiqueta_modelos jsonb;
  v_etiqueta_impressoes jsonb;
  v_etiqueta_solicitacoes jsonb;
  v_etiqueta_solicitacao_itens jsonb;
  v_empresa_bobina_perfis jsonb;
  v_empresa_impressora_config jsonb;
  v_rfid_tags_count integer := 0;
  v_etiqueta_modelos_count integer := 0;
  v_empresa_bobina_perfis_count integer := 0;
  v_empresa_impressora_config_count integer := 0;
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

  -- ---------------------------------------------------------------------
  -- P1-10B: sixteen more collections - the operational core. Same
  -- optional-by-jsonb-key-presence rule as above: a backup created before
  -- this migration (or before P1-10A) has none of these keys and leaves
  -- all sixteen tables completely untouched.
  -- ---------------------------------------------------------------------
  v_categorias := _payload -> 'data' -> 'categorias_materiais';
  v_materiais := _payload -> 'data' -> 'materiais';
  v_estoque_localizacoes := _payload -> 'data' -> 'estoque_localizacoes';
  v_estoque_saldos := _payload -> 'data' -> 'estoque_saldos';
  v_estoque_movimentacoes := _payload -> 'data' -> 'estoque_movimentacoes';
  v_material_custodias := _payload -> 'data' -> 'material_custodias';
  v_material_custodia_eventos := _payload -> 'data' -> 'material_custodia_eventos';
  v_material_locacoes := _payload -> 'data' -> 'material_locacoes';
  v_material_locacao_itens := _payload -> 'data' -> 'material_locacao_itens';
  v_material_locacao_eventos := _payload -> 'data' -> 'material_locacao_eventos';
  v_manutencao_ordens := _payload -> 'data' -> 'manutencao_ordens';
  v_manutencao_ordem_insumos := _payload -> 'data' -> 'manutencao_ordem_insumos';
  v_manutencao_ordem_eventos := _payload -> 'data' -> 'manutencao_ordem_eventos';
  v_financeiro_lancamentos := _payload -> 'data' -> 'financeiro_lancamentos';
  v_financeiro_parcelas := _payload -> 'data' -> 'financeiro_parcelas';
  v_financeiro_recebimentos := _payload -> 'data' -> 'financeiro_recebimentos';

  IF (v_categorias IS NOT NULL AND jsonb_typeof(v_categorias) IS DISTINCT FROM 'array')
     OR (v_materiais IS NOT NULL AND jsonb_typeof(v_materiais) IS DISTINCT FROM 'array')
     OR (v_estoque_localizacoes IS NOT NULL AND jsonb_typeof(v_estoque_localizacoes) IS DISTINCT FROM 'array')
     OR (v_estoque_saldos IS NOT NULL AND jsonb_typeof(v_estoque_saldos) IS DISTINCT FROM 'array')
     OR (v_estoque_movimentacoes IS NOT NULL AND jsonb_typeof(v_estoque_movimentacoes) IS DISTINCT FROM 'array')
     OR (v_material_custodias IS NOT NULL AND jsonb_typeof(v_material_custodias) IS DISTINCT FROM 'array')
     OR (v_material_custodia_eventos IS NOT NULL AND jsonb_typeof(v_material_custodia_eventos) IS DISTINCT FROM 'array')
     OR (v_material_locacoes IS NOT NULL AND jsonb_typeof(v_material_locacoes) IS DISTINCT FROM 'array')
     OR (v_material_locacao_itens IS NOT NULL AND jsonb_typeof(v_material_locacao_itens) IS DISTINCT FROM 'array')
     OR (v_material_locacao_eventos IS NOT NULL AND jsonb_typeof(v_material_locacao_eventos) IS DISTINCT FROM 'array')
     OR (v_manutencao_ordens IS NOT NULL AND jsonb_typeof(v_manutencao_ordens) IS DISTINCT FROM 'array')
     OR (v_manutencao_ordem_insumos IS NOT NULL AND jsonb_typeof(v_manutencao_ordem_insumos) IS DISTINCT FROM 'array')
     OR (v_manutencao_ordem_eventos IS NOT NULL AND jsonb_typeof(v_manutencao_ordem_eventos) IS DISTINCT FROM 'array')
     OR (v_financeiro_lancamentos IS NOT NULL AND jsonb_typeof(v_financeiro_lancamentos) IS DISTINCT FROM 'array')
     OR (v_financeiro_parcelas IS NOT NULL AND jsonb_typeof(v_financeiro_parcelas) IS DISTINCT FROM 'array')
     OR (v_financeiro_recebimentos IS NOT NULL AND jsonb_typeof(v_financeiro_recebimentos) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid backup payload: all operational-core data collections must be arrays';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      COALESCE(v_categorias, '[]'::jsonb) || COALESCE(v_materiais, '[]'::jsonb)
      || COALESCE(v_estoque_localizacoes, '[]'::jsonb) || COALESCE(v_estoque_saldos, '[]'::jsonb)
      || COALESCE(v_estoque_movimentacoes, '[]'::jsonb) || COALESCE(v_material_custodias, '[]'::jsonb)
      || COALESCE(v_material_custodia_eventos, '[]'::jsonb) || COALESCE(v_material_locacoes, '[]'::jsonb)
      || COALESCE(v_material_locacao_itens, '[]'::jsonb) || COALESCE(v_material_locacao_eventos, '[]'::jsonb)
      || COALESCE(v_manutencao_ordens, '[]'::jsonb) || COALESCE(v_manutencao_ordem_insumos, '[]'::jsonb)
      || COALESCE(v_manutencao_ordem_eventos, '[]'::jsonb) || COALESCE(v_financeiro_lancamentos, '[]'::jsonb)
      || COALESCE(v_financeiro_parcelas, '[]'::jsonb) || COALESCE(v_financeiro_recebimentos, '[]'::jsonb)
    ) AS item
    WHERE jsonb_typeof(item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: operational-core collections must contain only objects';
  END IF;

  IF v_categorias IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_categorias) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in categorias_materiais';
  END IF;

  IF v_materiais IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_materiais) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'categoria_id' IS NULL
       OR NULLIF(item ->> 'codigo_interno', '') IS NULL
       OR NULLIF(item ->> 'nome', '') IS NULL
       OR item ->> 'tipo_controle' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in materiais';
  END IF;

  IF v_estoque_localizacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_localizacoes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'codigo', '') IS NULL
       OR NULLIF(item ->> 'nome', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in estoque_localizacoes';
  END IF;

  IF v_estoque_saldos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_saldos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR item ->> 'localizacao_id' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in estoque_saldos';
  END IF;

  IF v_estoque_movimentacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_movimentacoes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR item ->> 'tipo_movimentacao' IS NULL
       OR item ->> 'quantidade' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
       OR item ->> 'saldo_total_anterior' IS NULL
       OR item ->> 'saldo_total_posterior' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in estoque_movimentacoes';
  END IF;

  IF v_material_custodias IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodias) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR item ->> 'tipo_controle' IS NULL
       OR item ->> 'quantidade_retirada' IS NULL
       OR item ->> 'localizacao_origem_id' IS NULL
       OR item ->> 'movimento_saida_id' IS NULL
       OR NULLIF(item ->> 'responsavel_nome', '') IS NULL
       OR item ->> 'responsavel_tipo' IS NULL
       OR item ->> 'finalidade' IS NULL
       OR item ->> 'condicao_saida' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in material_custodias';
  END IF;

  IF v_material_custodia_eventos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodia_eventos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'custodia_id' IS NULL
       OR item ->> 'material_id' IS NULL
       OR item ->> 'tipo' IS NULL
       OR item ->> 'quantidade' IS NULL
       OR item ->> 'executado_por' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in material_custodia_eventos';
  END IF;

  IF v_material_locacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacoes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'cliente_id' IS NULL
       OR NULLIF(item ->> 'numero', '') IS NULL
       OR NULLIF(item ->> 'responsavel_nome', '') IS NULL
       OR item ->> 'responsavel_tipo' IS NULL
       OR item ->> 'retirada_prevista_em' IS NULL
       OR item ->> 'devolucao_prevista_em' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in material_locacoes';
  END IF;

  IF v_material_locacao_itens IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_itens) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'locacao_id' IS NULL
       OR item ->> 'material_id' IS NULL
       OR item ->> 'quantidade_contratada' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in material_locacao_itens';
  END IF;

  IF v_material_locacao_eventos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_eventos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'locacao_id' IS NULL
       OR item ->> 'tipo' IS NULL
       OR NULLIF(item ->> 'descricao', '') IS NULL
       OR item ->> 'executado_por' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in material_locacao_eventos';
  END IF;

  IF v_manutencao_ordens IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordens) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR NULLIF(item ->> 'numero', '') IS NULL
       OR item ->> 'tipo' IS NULL
       OR NULLIF(item ->> 'defeito_relatado', '') IS NULL
       OR item ->> 'tipo_controle' IS NULL
       OR item ->> 'quantidade_afetada' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
       OR item ->> 'created_by' IS NULL
       OR item ->> 'updated_by' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in manutencao_ordens';
  END IF;

  IF v_manutencao_ordem_insumos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordem_insumos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'ordem_id' IS NULL
       OR NULLIF(item ->> 'descricao', '') IS NULL
       OR item ->> 'created_by' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in manutencao_ordem_insumos';
  END IF;

  IF v_manutencao_ordem_eventos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordem_eventos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'ordem_id' IS NULL
       OR item ->> 'tipo' IS NULL
       OR NULLIF(item ->> 'descricao', '') IS NULL
       OR item ->> 'executado_por' IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in manutencao_ordem_eventos';
  END IF;

  IF v_financeiro_lancamentos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_lancamentos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'origem_tipo', '') IS NULL
       OR item ->> 'origem_id' IS NULL
       OR item ->> 'valor_original' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in financeiro_lancamentos';
  END IF;

  IF v_financeiro_parcelas IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_parcelas) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'lancamento_id' IS NULL
       OR item ->> 'numero' IS NULL
       OR item ->> 'valor' IS NULL
       OR item ->> 'vencimento' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in financeiro_parcelas';
  END IF;

  IF v_financeiro_recebimentos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_recebimentos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'lancamento_id' IS NULL
       OR item ->> 'tipo' IS NULL
       OR item ->> 'valor' IS NULL
       OR item ->> 'client_uuid' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in financeiro_recebimentos';
  END IF;

  -- Type-check every present operational-core collection before any write.
  IF v_categorias IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.categorias_materiais, v_categorias);
  END IF;
  IF v_materiais IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.materiais, v_materiais);
  END IF;
  IF v_estoque_localizacoes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.estoque_localizacoes, v_estoque_localizacoes);
  END IF;
  IF v_estoque_saldos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.estoque_saldos, v_estoque_saldos);
  END IF;
  IF v_estoque_movimentacoes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.estoque_movimentacoes, v_estoque_movimentacoes);
  END IF;
  IF v_material_custodias IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.material_custodias, v_material_custodias);
  END IF;
  IF v_material_custodia_eventos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.material_custodia_eventos, v_material_custodia_eventos);
  END IF;
  IF v_material_locacoes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.material_locacoes, v_material_locacoes);
  END IF;
  IF v_material_locacao_itens IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.material_locacao_itens, v_material_locacao_itens);
  END IF;
  IF v_material_locacao_eventos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.material_locacao_eventos, v_material_locacao_eventos);
  END IF;
  IF v_manutencao_ordens IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.manutencao_ordens, v_manutencao_ordens);
  END IF;
  IF v_manutencao_ordem_insumos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.manutencao_ordem_insumos, v_manutencao_ordem_insumos);
  END IF;
  IF v_manutencao_ordem_eventos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.manutencao_ordem_eventos, v_manutencao_ordem_eventos);
  END IF;
  IF v_financeiro_lancamentos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.financeiro_lancamentos, v_financeiro_lancamentos);
  END IF;
  IF v_financeiro_parcelas IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.financeiro_parcelas, v_financeiro_parcelas);
  END IF;
  IF v_financeiro_recebimentos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.financeiro_recebimentos, v_financeiro_recebimentos);
  END IF;

  IF (v_categorias IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_categorias) AS item))
     OR (v_materiais IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_materiais) AS item))
     OR (v_estoque_localizacoes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_estoque_localizacoes) AS item))
     OR (v_estoque_saldos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_estoque_saldos) AS item))
     OR (v_estoque_movimentacoes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_estoque_movimentacoes) AS item))
     OR (v_material_custodias IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_material_custodias) AS item))
     OR (v_material_custodia_eventos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_material_custodia_eventos) AS item))
     OR (v_material_locacoes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_material_locacoes) AS item))
     OR (v_material_locacao_itens IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_material_locacao_itens) AS item))
     OR (v_material_locacao_eventos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_material_locacao_eventos) AS item))
     OR (v_manutencao_ordens IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_manutencao_ordens) AS item))
     OR (v_manutencao_ordem_insumos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_manutencao_ordem_insumos) AS item))
     OR (v_manutencao_ordem_eventos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_manutencao_ordem_eventos) AS item))
     OR (v_financeiro_lancamentos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_financeiro_lancamentos) AS item))
     OR (v_financeiro_parcelas IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_financeiro_parcelas) AS item))
     OR (v_financeiro_recebimentos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_financeiro_recebimentos) AS item)) THEN
    RAISE EXCEPTION 'Invalid backup payload: duplicate identifiers in the operational-core collections';
  END IF;

  IF v_estoque_localizacoes IS NOT NULL THEN
    WITH RECURSIVE payload_locations AS (
      SELECT id, localizacao_pai_id
      FROM jsonb_populate_recordset(NULL::public.estoque_localizacoes, v_estoque_localizacoes)
    ),
    reachable AS (
      SELECT loc.id, 0 AS depth
      FROM payload_locations AS loc
      WHERE loc.localizacao_pai_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM payload_locations AS p WHERE p.id = loc.localizacao_pai_id)
      UNION ALL
      SELECT child.id, parent_row.depth + 1
      FROM payload_locations AS child
      JOIN reachable AS parent_row ON parent_row.id = child.localizacao_pai_id
    )
    SELECT count(*) INTO v_op_core_reachable FROM reachable;

    IF v_op_core_reachable <> jsonb_array_length(v_estoque_localizacoes) THEN
      RAISE EXCEPTION 'Invalid backup payload: estoque_localizacoes contains a cycle or an unreachable hierarchy';
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- P1-10C: RFID, etiquetas/impressão, configuração compartilhada de
  -- bobina/impressora. Same optional-by-jsonb-key-presence rule as every
  -- collection above: absent key = table left completely untouched.
  -- ---------------------------------------------------------------------
  v_rfid_tags := _payload -> 'data' -> 'rfid_tags';
  v_rfid_read_sessions := _payload -> 'data' -> 'rfid_read_sessions';
  v_etiqueta_modelos := _payload -> 'data' -> 'etiqueta_modelos';
  v_etiqueta_impressoes := _payload -> 'data' -> 'etiqueta_impressoes';
  v_etiqueta_solicitacoes := _payload -> 'data' -> 'etiqueta_solicitacoes';
  v_etiqueta_solicitacao_itens := _payload -> 'data' -> 'etiqueta_solicitacao_itens';
  v_empresa_bobina_perfis := _payload -> 'data' -> 'empresa_bobina_perfis';
  v_empresa_impressora_config := _payload -> 'data' -> 'empresa_impressora_config';

  IF (v_rfid_tags IS NOT NULL AND jsonb_typeof(v_rfid_tags) IS DISTINCT FROM 'array')
     OR (v_rfid_read_sessions IS NOT NULL AND jsonb_typeof(v_rfid_read_sessions) IS DISTINCT FROM 'array')
     OR (v_etiqueta_modelos IS NOT NULL AND jsonb_typeof(v_etiqueta_modelos) IS DISTINCT FROM 'array')
     OR (v_etiqueta_impressoes IS NOT NULL AND jsonb_typeof(v_etiqueta_impressoes) IS DISTINCT FROM 'array')
     OR (v_etiqueta_solicitacoes IS NOT NULL AND jsonb_typeof(v_etiqueta_solicitacoes) IS DISTINCT FROM 'array')
     OR (v_etiqueta_solicitacao_itens IS NOT NULL AND jsonb_typeof(v_etiqueta_solicitacao_itens) IS DISTINCT FROM 'array')
     OR (v_empresa_bobina_perfis IS NOT NULL AND jsonb_typeof(v_empresa_bobina_perfis) IS DISTINCT FROM 'array')
     OR (v_empresa_impressora_config IS NOT NULL AND jsonb_typeof(v_empresa_impressora_config) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid backup payload: all RFID/labels/printing data collections must be arrays';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      COALESCE(v_rfid_tags, '[]'::jsonb) || COALESCE(v_rfid_read_sessions, '[]'::jsonb)
      || COALESCE(v_etiqueta_modelos, '[]'::jsonb) || COALESCE(v_etiqueta_impressoes, '[]'::jsonb)
      || COALESCE(v_etiqueta_solicitacoes, '[]'::jsonb) || COALESCE(v_etiqueta_solicitacao_itens, '[]'::jsonb)
      || COALESCE(v_empresa_bobina_perfis, '[]'::jsonb) || COALESCE(v_empresa_impressora_config, '[]'::jsonb)
    ) AS item
    WHERE jsonb_typeof(item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: RFID/labels/printing collections must contain only objects';
  END IF;

  IF v_rfid_tags IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rfid_tags) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR NULLIF(item ->> 'epc', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in rfid_tags';
  END IF;

  IF v_rfid_read_sessions IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rfid_read_sessions) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'tipo' IS NULL
       OR item ->> 'responsavel_user_id' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in rfid_read_sessions';
  END IF;

  IF v_etiqueta_modelos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_modelos) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
       OR item ->> 'largura_mm' IS NULL
       OR item ->> 'altura_mm' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in etiqueta_modelos';
  END IF;

  IF v_etiqueta_impressoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_impressoes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'material_id' IS NULL
       OR item ->> 'quantidade' IS NULL
       OR item ->> 'modelo_snapshot' IS NULL
       OR item ->> 'material_snapshot' IS NULL
       OR item ->> 'solicitada_por' IS NULL
       OR NULLIF(item ->> 'solicitante_nome', '') IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in etiqueta_impressoes';
  END IF;

  IF v_etiqueta_solicitacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_solicitacoes) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'modelo_snapshot' IS NULL
       OR item ->> 'quantidade_materiais' IS NULL
       OR item ->> 'quantidade_etiquetas' IS NULL
       OR item ->> 'solicitada_por' IS NULL
       OR NULLIF(item ->> 'solicitante_nome', '') IS NULL
       OR item ->> 'client_uuid' IS NULL
       OR NULLIF(item ->> 'payload_hash', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in etiqueta_solicitacoes';
  END IF;

  IF v_etiqueta_solicitacao_itens IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_solicitacao_itens) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'solicitacao_id' IS NULL
       OR item ->> 'material_id' IS NULL
       OR item ->> 'ordem' IS NULL
       OR item ->> 'quantidade' IS NULL
       OR item ->> 'material_snapshot' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in etiqueta_solicitacao_itens';
  END IF;

  IF v_empresa_bobina_perfis IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_empresa_bobina_perfis) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR NULLIF(item ->> 'nome', '') IS NULL
       OR item ->> 'largura_etiqueta_mm' IS NULL
       OR item ->> 'altura_etiqueta_mm' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in empresa_bobina_perfis';
  END IF;

  IF v_empresa_impressora_config IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_empresa_impressora_config) AS item
    WHERE item ->> 'id' IS NULL
       OR item ->> 'empresa_id' IS DISTINCT FROM v_company_id::text
       OR item ->> 'finalidade' IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: required fields or tenant identifiers are invalid in empresa_impressora_config';
  END IF;

  IF v_rfid_tags IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.rfid_tags, v_rfid_tags);
  END IF;
  IF v_rfid_read_sessions IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.rfid_read_sessions, v_rfid_read_sessions);
  END IF;
  IF v_etiqueta_modelos IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.etiqueta_modelos, v_etiqueta_modelos);
  END IF;
  IF v_etiqueta_impressoes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.etiqueta_impressoes, v_etiqueta_impressoes);
  END IF;
  IF v_etiqueta_solicitacoes IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.etiqueta_solicitacoes, v_etiqueta_solicitacoes);
  END IF;
  IF v_etiqueta_solicitacao_itens IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.etiqueta_solicitacao_itens, v_etiqueta_solicitacao_itens);
  END IF;
  IF v_empresa_bobina_perfis IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.empresa_bobina_perfis, v_empresa_bobina_perfis);
  END IF;
  IF v_empresa_impressora_config IS NOT NULL THEN
    PERFORM 1 FROM jsonb_populate_recordset(NULL::public.empresa_impressora_config, v_empresa_impressora_config);
  END IF;

  IF (v_rfid_tags IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_rfid_tags) AS item))
     OR (v_rfid_read_sessions IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_rfid_read_sessions) AS item))
     OR (v_etiqueta_modelos IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_etiqueta_modelos) AS item))
     OR (v_etiqueta_impressoes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_etiqueta_impressoes) AS item))
     OR (v_etiqueta_solicitacoes IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_etiqueta_solicitacoes) AS item))
     OR (v_etiqueta_solicitacao_itens IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_etiqueta_solicitacao_itens) AS item))
     OR (v_empresa_bobina_perfis IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_empresa_bobina_perfis) AS item))
     OR (v_empresa_impressora_config IS NOT NULL AND (SELECT count(*) <> count(DISTINCT item ->> 'id') FROM jsonb_array_elements(v_empresa_impressora_config) AS item)) THEN
    RAISE EXCEPTION 'Invalid backup payload: duplicate identifiers in the RFID/labels/printing collections';
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

  -- =====================================================================
  -- P1-10B writes. Order matches the dependency chain documented at the
  -- top of this migration. Every table here is upsert-only or
  -- append-only (ON CONFLICT DO NOTHING) - see that comment for why a
  -- delete phase is deliberately absent for all sixteen.
  -- =====================================================================

  IF v_categorias IS NOT NULL THEN
    INSERT INTO public.categorias_materiais (
      id, empresa_id, nome, descricao, ativo, created_by, updated_by, created_at, updated_at
    )
    SELECT
      categoria.id, v_company_id, categoria.nome, categoria.descricao,
      COALESCE(categoria.ativo, true), categoria.created_by, categoria.updated_by,
      COALESCE(categoria.created_at, now()), COALESCE(categoria.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.categorias_materiais, v_categorias) AS categoria
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, ativo = EXCLUDED.ativo,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.categorias_materiais.empresa_id = v_company_id;
    GET DIAGNOSTICS v_categorias_count = ROW_COUNT;
  END IF;

  IF v_materiais IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_materiais) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categorias_materiais AS c
      WHERE c.id = (item ->> 'categoria_id')::uuid AND c.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: materiais references a categoria_materiais that does not exist in this company';
  END IF;

  IF v_materiais IS NOT NULL THEN
    -- Bypass prepare_material_write's identity/state-machine rules for this
    -- statement only - see the function definition above for why.
    PERFORM set_config('backstage.materials_restore_write', 'on', true);
    INSERT INTO public.materiais (
      id, empresa_id, categoria_id, codigo_interno, identificador_unico, codigo_barras,
      tipo_identificacao, conteudo_qr_code, identificacao_gerada_em, identificacao_gerada_por,
      status_identificacao, nome, descricao, marca, modelo, numero_serie, numero_patrimonio,
      tipo_controle, unidade_medida, valor_aquisicao, valor_reposicao, valor_locacao_padrao,
      data_aquisicao, fornecedor, observacoes, status_operacional, justificativa_status,
      ativo, estoque_minimo, created_by, updated_by, created_at, updated_at
    )
    SELECT
      material.id, v_company_id, material.categoria_id, material.codigo_interno,
      COALESCE(material.identificador_unico, gen_random_uuid()), material.codigo_barras,
      COALESCE(material.tipo_identificacao, 'qr_code'), material.conteudo_qr_code,
      material.identificacao_gerada_em, material.identificacao_gerada_por,
      COALESCE(material.status_identificacao, 'nao_gerada'), material.nome, material.descricao,
      material.marca, material.modelo, material.numero_serie, material.numero_patrimonio,
      material.tipo_controle, COALESCE(material.unidade_medida, 'unidade'),
      material.valor_aquisicao, material.valor_reposicao, material.valor_locacao_padrao,
      material.data_aquisicao, material.fornecedor, material.observacoes,
      COALESCE(material.status_operacional, 'disponivel'), material.justificativa_status,
      COALESCE(material.ativo, true), COALESCE(material.estoque_minimo, 0),
      material.created_by, material.updated_by,
      COALESCE(material.created_at, now()), COALESCE(material.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.materiais, v_materiais) AS material
    ON CONFLICT (id) DO UPDATE SET
      categoria_id = EXCLUDED.categoria_id, codigo_interno = EXCLUDED.codigo_interno,
      codigo_barras = EXCLUDED.codigo_barras, tipo_identificacao = EXCLUDED.tipo_identificacao,
      conteudo_qr_code = EXCLUDED.conteudo_qr_code,
      identificacao_gerada_em = EXCLUDED.identificacao_gerada_em,
      identificacao_gerada_por = EXCLUDED.identificacao_gerada_por,
      status_identificacao = EXCLUDED.status_identificacao,
      nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, marca = EXCLUDED.marca,
      modelo = EXCLUDED.modelo, numero_serie = EXCLUDED.numero_serie,
      numero_patrimonio = EXCLUDED.numero_patrimonio, tipo_controle = EXCLUDED.tipo_controle,
      unidade_medida = EXCLUDED.unidade_medida, valor_aquisicao = EXCLUDED.valor_aquisicao,
      valor_reposicao = EXCLUDED.valor_reposicao, valor_locacao_padrao = EXCLUDED.valor_locacao_padrao,
      data_aquisicao = EXCLUDED.data_aquisicao, fornecedor = EXCLUDED.fornecedor,
      observacoes = EXCLUDED.observacoes, status_operacional = EXCLUDED.status_operacional,
      justificativa_status = EXCLUDED.justificativa_status, ativo = EXCLUDED.ativo,
      estoque_minimo = EXCLUDED.estoque_minimo, updated_by = EXCLUDED.updated_by,
      updated_at = now()
    WHERE public.materiais.empresa_id = v_company_id;
    GET DIAGNOSTICS v_materiais_count = ROW_COUNT;
    PERFORM set_config('backstage.materials_restore_write', 'off', true);
  END IF;

  IF v_estoque_localizacoes IS NOT NULL THEN
    WITH RECURSIVE payload_locations AS (
      SELECT * FROM jsonb_populate_recordset(NULL::public.estoque_localizacoes, v_estoque_localizacoes)
    ),
    ordered AS (
      SELECT loc.*, 0 AS depth
      FROM payload_locations AS loc
      WHERE loc.localizacao_pai_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM payload_locations AS p WHERE p.id = loc.localizacao_pai_id)
      UNION ALL
      SELECT child.*, parent_row.depth + 1
      FROM payload_locations AS child
      JOIN ordered AS parent_row ON parent_row.id = child.localizacao_pai_id
    )
    INSERT INTO public.estoque_localizacoes (
      id, empresa_id, localizacao_pai_id, codigo, nome, tipo, descricao, ativa,
      created_by, updated_by, created_at, updated_at
    )
    SELECT
      o.id, v_company_id, o.localizacao_pai_id, o.codigo, o.nome,
      COALESCE(o.tipo, 'outra'), o.descricao, COALESCE(o.ativa, true),
      o.created_by, o.updated_by, COALESCE(o.created_at, now()), COALESCE(o.updated_at, now())
    FROM ordered AS o
    ORDER BY o.depth
    ON CONFLICT (id) DO UPDATE SET
      localizacao_pai_id = EXCLUDED.localizacao_pai_id, codigo = EXCLUDED.codigo,
      nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, descricao = EXCLUDED.descricao,
      ativa = EXCLUDED.ativa, updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.estoque_localizacoes.empresa_id = v_company_id;
    GET DIAGNOSTICS v_estoque_localizacoes_count = ROW_COUNT;
  END IF;

  IF v_estoque_saldos IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_saldos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_saldos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.estoque_localizacoes AS l
      WHERE l.id = (item ->> 'localizacao_id')::uuid AND l.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: estoque_saldos references a material or localizacao that does not exist in this company';
  END IF;

  IF v_estoque_saldos IS NOT NULL THEN
    -- Upserted on the real business key, not id: the "same" balance row
    -- restored twice (or restored after a live row was created with a
    -- different id for the same material+localizacao) must never produce
    -- two rows for one material in one place -
    -- estoque_saldos_empresa_material_localizacao_unique already forbids
    -- that, so aligning the conflict target with it is what makes this
    -- restore idempotent instead of erroring on the second run.
    INSERT INTO public.estoque_saldos (
      id, empresa_id, material_id, localizacao_id, quantidade, created_at, updated_at
    )
    SELECT
      saldo.id, v_company_id, saldo.material_id, saldo.localizacao_id,
      COALESCE(saldo.quantidade, 0), COALESCE(saldo.created_at, now()),
      COALESCE(saldo.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.estoque_saldos, v_estoque_saldos) AS saldo
    ON CONFLICT (empresa_id, material_id, localizacao_id) DO UPDATE SET
      quantidade = EXCLUDED.quantidade, updated_at = now()
    WHERE public.estoque_saldos.empresa_id = v_company_id;
    GET DIAGNOSTICS v_estoque_saldos_count = ROW_COUNT;
  END IF;

  IF v_estoque_movimentacoes IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_movimentacoes) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_movimentacoes) AS item
    WHERE NULLIF(item ->> 'localizacao_origem_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.estoque_localizacoes AS l
      WHERE l.id = (item ->> 'localizacao_origem_id')::uuid AND l.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_estoque_movimentacoes) AS item
    WHERE NULLIF(item ->> 'localizacao_destino_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.estoque_localizacoes AS l
      WHERE l.id = (item ->> 'localizacao_destino_id')::uuid AND l.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: estoque_movimentacoes references a material or localizacao that does not exist in this company';
  END IF;

  IF v_estoque_movimentacoes IS NOT NULL THEN
    -- Append-only ledger: protect_stock_ledger blocks UPDATE/DELETE
    -- unconditionally, so a restore can only ever add missing history.
    -- Values are replayed verbatim, including the audit-snapshot balance
    -- columns - this is a historical replay, not a new movement, so
    -- apply_stock_movement (which recomputes those against *current*
    -- state) is deliberately not called.
    INSERT INTO public.estoque_movimentacoes (
      id, empresa_id, material_id, tipo_movimentacao, quantidade,
      localizacao_origem_id, localizacao_destino_id,
      saldo_origem_anterior, saldo_origem_posterior,
      saldo_destino_anterior, saldo_destino_posterior,
      saldo_total_anterior, saldo_total_posterior,
      motivo, justificativa, observacao, documento_referencia,
      origem_modulo, origem_id, movimentacao_estornada_id,
      client_uuid, payload_hash, data_efetiva, created_by, created_at
    )
    SELECT
      mov.id, v_company_id, mov.material_id, mov.tipo_movimentacao, mov.quantidade,
      mov.localizacao_origem_id, mov.localizacao_destino_id,
      mov.saldo_origem_anterior, mov.saldo_origem_posterior,
      mov.saldo_destino_anterior, mov.saldo_destino_posterior,
      mov.saldo_total_anterior, mov.saldo_total_posterior,
      mov.motivo, mov.justificativa, mov.observacao, mov.documento_referencia,
      COALESCE(mov.origem_modulo, 'manual'), mov.origem_id, mov.movimentacao_estornada_id,
      mov.client_uuid, mov.payload_hash, COALESCE(mov.data_efetiva, now()),
      mov.created_by, COALESCE(mov.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.estoque_movimentacoes, v_estoque_movimentacoes) AS mov
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_material_custodias IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodias) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodias) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.estoque_localizacoes AS l
      WHERE l.id = (item ->> 'localizacao_origem_id')::uuid AND l.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodias) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.estoque_movimentacoes AS mv
      WHERE mv.id = (item ->> 'movimento_saida_id')::uuid
        AND mv.empresa_id = v_company_id
        AND mv.material_id = (item ->> 'material_id')::uuid
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: material_custodias references a material, localizacao or movimento_saida that does not exist in this company';
  END IF;

  IF v_material_custodias IS NOT NULL THEN
    -- protect_material_custody_history unconditionally blocks DELETE for
    -- this table (no bypass reachable) - upsert is not a preference here,
    -- it is the only mechanically possible replace strategy.
    INSERT INTO public.material_custodias (
      id, empresa_id, material_id, tipo_controle, quantidade_retirada,
      quantidade_devolvida, quantidade_baixada, status, localizacao_origem_id,
      retirada_em, previsao_retorno, encerrada_em, responsavel_tipo,
      responsavel_usuario_id, responsavel_funcionario_id, responsavel_nome,
      executado_por, finalidade, referencia_tipo, referencia_id,
      condicao_saida, observacao_saida, movimento_saida_id,
      client_uuid, payload_hash, created_at, updated_at
    )
    SELECT
      custodia.id, v_company_id, custodia.material_id, custodia.tipo_controle,
      custodia.quantidade_retirada, COALESCE(custodia.quantidade_devolvida, 0),
      COALESCE(custodia.quantidade_baixada, 0), COALESCE(custodia.status, 'aberta'),
      custodia.localizacao_origem_id, COALESCE(custodia.retirada_em, now()),
      custodia.previsao_retorno, custodia.encerrada_em, custodia.responsavel_tipo,
      custodia.responsavel_usuario_id, custodia.responsavel_funcionario_id,
      custodia.responsavel_nome, custodia.executado_por, custodia.finalidade,
      custodia.referencia_tipo, custodia.referencia_id, custodia.condicao_saida,
      custodia.observacao_saida, custodia.movimento_saida_id,
      custodia.client_uuid, custodia.payload_hash,
      COALESCE(custodia.created_at, now()), COALESCE(custodia.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.material_custodias, v_material_custodias) AS custodia
    ON CONFLICT (id) DO UPDATE SET
      quantidade_devolvida = EXCLUDED.quantidade_devolvida,
      quantidade_baixada = EXCLUDED.quantidade_baixada, status = EXCLUDED.status,
      previsao_retorno = EXCLUDED.previsao_retorno, encerrada_em = EXCLUDED.encerrada_em,
      condicao_saida = EXCLUDED.condicao_saida, observacao_saida = EXCLUDED.observacao_saida,
      updated_at = now()
    WHERE public.material_custodias.empresa_id = v_company_id;
    GET DIAGNOSTICS v_material_custodias_count = ROW_COUNT;
  END IF;

  IF v_material_custodia_eventos IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodia_eventos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.material_custodias AS c
      WHERE c.id = (item ->> 'custodia_id')::uuid AND c.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_custodia_eventos) AS item
    WHERE NULLIF(item ->> 'movimento_estoque_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.estoque_movimentacoes AS mv
      WHERE mv.id = (item ->> 'movimento_estoque_id')::uuid
        AND mv.empresa_id = v_company_id
        AND mv.material_id = (item ->> 'material_id')::uuid
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: material_custodia_eventos references a custodia or movimento_estoque that does not exist in this company';
  END IF;

  IF v_material_custodia_eventos IS NOT NULL THEN
    -- Immutable history (protect_material_custody_history blocks this
    -- table unconditionally, any TG_OP): append-only.
    INSERT INTO public.material_custodia_eventos (
      id, empresa_id, custodia_id, material_id, tipo, quantidade, condicao,
      ocorrencia, justificativa, observacao, localizacao_origem_id,
      localizacao_destino_id, movimento_estoque_id, status_operacional_resultante,
      executado_por, data_efetiva, client_uuid, payload_hash, created_at
    )
    SELECT
      evt.id, v_company_id, evt.custodia_id, evt.material_id, evt.tipo, evt.quantidade,
      evt.condicao, evt.ocorrencia, evt.justificativa, evt.observacao,
      evt.localizacao_origem_id, evt.localizacao_destino_id, evt.movimento_estoque_id,
      evt.status_operacional_resultante, evt.executado_por,
      COALESCE(evt.data_efetiva, now()), evt.client_uuid, evt.payload_hash,
      COALESCE(evt.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.material_custodia_eventos, v_material_custodia_eventos) AS evt
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_material_locacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacoes) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = (item ->> 'cliente_id')::uuid AND c.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: material_locacoes references a cliente that does not exist in this company';
  END IF;

  IF v_material_locacoes IS NOT NULL THEN
    -- protect_material_rental_history unconditionally blocks DELETE for
    -- this table specifically (no bypass reachable) - upsert is the only
    -- mechanically possible replace strategy, same as material_custodias.
    INSERT INTO public.material_locacoes (
      id, empresa_id, cliente_id, numero, status, evento_id, contrato_referencia_id,
      orcamento_referencia_id, financeiro_lancamento_id, retirada_prevista_em,
      devolucao_prevista_em, iniciada_em, encerrada_em, desconto, valor_bruto,
      valor_total, responsavel_tipo, responsavel_usuario_id, responsavel_funcionario_id,
      responsavel_nome, observacoes, client_uuid, payload_hash,
      created_by, updated_by, created_at, updated_at
    )
    SELECT
      loc.id, v_company_id, loc.cliente_id, loc.numero, COALESCE(loc.status, 'rascunho'),
      loc.evento_id, loc.contrato_referencia_id, loc.orcamento_referencia_id,
      loc.financeiro_lancamento_id, loc.retirada_prevista_em, loc.devolucao_prevista_em,
      loc.iniciada_em, loc.encerrada_em, COALESCE(loc.desconto, 0),
      COALESCE(loc.valor_bruto, 0), COALESCE(loc.valor_total, 0), loc.responsavel_tipo,
      loc.responsavel_usuario_id, loc.responsavel_funcionario_id, loc.responsavel_nome,
      loc.observacoes, loc.client_uuid, loc.payload_hash, loc.created_by, loc.updated_by,
      COALESCE(loc.created_at, now()), COALESCE(loc.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.material_locacoes, v_material_locacoes) AS loc
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status, encerrada_em = EXCLUDED.encerrada_em,
      iniciada_em = EXCLUDED.iniciada_em, desconto = EXCLUDED.desconto,
      valor_bruto = EXCLUDED.valor_bruto, valor_total = EXCLUDED.valor_total,
      observacoes = EXCLUDED.observacoes, updated_by = EXCLUDED.updated_by,
      updated_at = now()
    WHERE public.material_locacoes.empresa_id = v_company_id;
    GET DIAGNOSTICS v_material_locacoes_count = ROW_COUNT;
  END IF;

  IF v_material_locacao_itens IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_itens) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.material_locacoes AS l
      WHERE l.id = (item ->> 'locacao_id')::uuid AND l.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_itens) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: material_locacao_itens references a locacao or material that does not exist in this company';
  END IF;

  IF v_material_locacao_itens IS NOT NULL THEN
    -- material_locacao_eventos.item_id holds a plain (NO ACTION) reference
    -- to this table, and material_locacoes above is forced-upsert - a
    -- blanket delete here would both fail once any item has a history
    -- event and, even where it did not, strip a live (not-in-this-backup)
    -- locação down to zero items. Upserted.
    INSERT INTO public.material_locacao_itens (
      id, empresa_id, locacao_id, material_id, modalidade_cobranca,
      quantidade_contratada, unidades_cobranca, valor_unitario, desconto,
      subtotal, observacoes, created_at, updated_at
    )
    SELECT
      item.id, v_company_id, item.locacao_id, item.material_id,
      COALESCE(item.modalidade_cobranca, 'unidade'), item.quantidade_contratada,
      COALESCE(item.unidades_cobranca, 1), COALESCE(item.valor_unitario, 0),
      COALESCE(item.desconto, 0), item.subtotal, item.observacoes,
      COALESCE(item.created_at, now()), COALESCE(item.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.material_locacao_itens, v_material_locacao_itens) AS item
    ON CONFLICT (id) DO UPDATE SET
      modalidade_cobranca = EXCLUDED.modalidade_cobranca,
      quantidade_contratada = EXCLUDED.quantidade_contratada,
      unidades_cobranca = EXCLUDED.unidades_cobranca, valor_unitario = EXCLUDED.valor_unitario,
      desconto = EXCLUDED.desconto, subtotal = EXCLUDED.subtotal,
      observacoes = EXCLUDED.observacoes, updated_at = now()
    WHERE public.material_locacao_itens.empresa_id = v_company_id;
    GET DIAGNOSTICS v_material_locacao_itens_count = ROW_COUNT;
  END IF;

  IF v_material_locacao_eventos IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_eventos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.material_locacoes AS l
      WHERE l.id = (item ->> 'locacao_id')::uuid AND l.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_eventos) AS item
    WHERE NULLIF(item ->> 'item_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.material_locacao_itens AS i
      WHERE i.id = (item ->> 'item_id')::uuid AND i.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_material_locacao_eventos) AS item
    WHERE NULLIF(item ->> 'custodia_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.material_custodias AS c
      WHERE c.id = (item ->> 'custodia_id')::uuid AND c.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: material_locacao_eventos references a locacao, item or custodia that does not exist in this company';
  END IF;

  IF v_material_locacao_eventos IS NOT NULL THEN
    -- Immutable history (protect_material_rental_history unconditionally
    -- blocks this table, any TG_OP): append-only.
    INSERT INTO public.material_locacao_eventos (
      id, empresa_id, locacao_id, item_id, custodia_id, tipo, descricao,
      dados, data_efetiva, executado_por, client_uuid, payload_hash, created_at
    )
    SELECT
      evt.id, v_company_id, evt.locacao_id, evt.item_id, evt.custodia_id, evt.tipo,
      evt.descricao, COALESCE(evt.dados, '{}'::jsonb), COALESCE(evt.data_efetiva, now()),
      evt.executado_por, evt.client_uuid, evt.payload_hash, COALESCE(evt.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.material_locacao_eventos, v_material_locacao_eventos) AS evt
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_manutencao_ordens IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordens) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordens) AS item
    WHERE NULLIF(item ->> 'custodia_evento_origem_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.material_custodia_eventos AS e
      WHERE e.id = (item ->> 'custodia_evento_origem_id')::uuid AND e.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: manutencao_ordens references a material or custodia_evento_origem that does not exist in this company';
  END IF;

  IF v_manutencao_ordens IS NOT NULL THEN
    -- manutencao_ordem_insumos/eventos both hold plain (NO ACTION)
    -- references to this table, and manutencao_ordem_eventos can never be
    -- deleted - any order with at least one history event (every order,
    -- from creation onward) blocks its own deletion. Upserted. custo_total
    -- is a GENERATED column and is never written directly.
    PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
    INSERT INTO public.manutencao_ordens (
      id, empresa_id, material_id, numero, tipo, origem, custodia_evento_origem_id,
      prioridade, status, tipo_controle, quantidade_afetada, defeito_relatado,
      diagnostico, servico_executado, condicao_entrada, condicao_saida,
      modalidade_execucao, fornecedor_externo, responsavel_tipo, responsavel_usuario_id,
      responsavel_funcionario_id, responsavel_nome, custo_mao_obra, custo_pecas,
      custo_outros, intervalo_preventivo_dias, proxima_preventiva_em, aberta_em,
      iniciada_em, previsao_conclusao_em, concluida_em, cancelada_em, observacoes,
      client_uuid, payload_hash, created_by, updated_by, created_at, updated_at
    )
    SELECT
      ordem.id, v_company_id, ordem.material_id, ordem.numero, ordem.tipo,
      COALESCE(ordem.origem, 'manual'), ordem.custodia_evento_origem_id,
      COALESCE(ordem.prioridade, 'normal'), COALESCE(ordem.status, 'aberta'),
      ordem.tipo_controle, ordem.quantidade_afetada, ordem.defeito_relatado,
      ordem.diagnostico, ordem.servico_executado, ordem.condicao_entrada,
      ordem.condicao_saida, COALESCE(ordem.modalidade_execucao, 'interna'),
      ordem.fornecedor_externo, ordem.responsavel_tipo, ordem.responsavel_usuario_id,
      ordem.responsavel_funcionario_id, ordem.responsavel_nome,
      COALESCE(ordem.custo_mao_obra, 0), COALESCE(ordem.custo_pecas, 0),
      COALESCE(ordem.custo_outros, 0), ordem.intervalo_preventivo_dias,
      ordem.proxima_preventiva_em, COALESCE(ordem.aberta_em, now()), ordem.iniciada_em,
      ordem.previsao_conclusao_em, ordem.concluida_em, ordem.cancelada_em,
      ordem.observacoes, ordem.client_uuid, ordem.payload_hash,
      ordem.created_by, ordem.updated_by,
      COALESCE(ordem.created_at, now()), COALESCE(ordem.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.manutencao_ordens, v_manutencao_ordens) AS ordem
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status, diagnostico = EXCLUDED.diagnostico,
      servico_executado = EXCLUDED.servico_executado, condicao_entrada = EXCLUDED.condicao_entrada,
      condicao_saida = EXCLUDED.condicao_saida, custo_mao_obra = EXCLUDED.custo_mao_obra,
      custo_pecas = EXCLUDED.custo_pecas, custo_outros = EXCLUDED.custo_outros,
      proxima_preventiva_em = EXCLUDED.proxima_preventiva_em, iniciada_em = EXCLUDED.iniciada_em,
      previsao_conclusao_em = EXCLUDED.previsao_conclusao_em, concluida_em = EXCLUDED.concluida_em,
      cancelada_em = EXCLUDED.cancelada_em, observacoes = EXCLUDED.observacoes,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.manutencao_ordens.empresa_id = v_company_id;
    GET DIAGNOSTICS v_manutencao_ordens_count = ROW_COUNT;
    PERFORM set_config('backstage.equipment_maintenance_write', 'off', true);
  END IF;

  IF v_manutencao_ordem_insumos IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordem_insumos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.manutencao_ordens AS o
      WHERE o.id = (item ->> 'ordem_id')::uuid AND o.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordem_insumos) AS item
    WHERE NULLIF(item ->> 'material_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: manutencao_ordem_insumos references an ordem or material that does not exist in this company';
  END IF;

  IF v_manutencao_ordem_insumos IS NOT NULL THEN
    -- Parent (manutencao_ordens) is forced-upsert; a blanket delete here
    -- would strip a live, currently-valid order down to zero consumed
    -- parts. Upserted. custo_total is GENERATED and never written
    -- directly.
    PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
    INSERT INTO public.manutencao_ordem_insumos (
      id, empresa_id, ordem_id, material_id, descricao, quantidade, unidade,
      custo_unitario, created_by, created_at
    )
    SELECT
      insumo.id, v_company_id, insumo.ordem_id, insumo.material_id, insumo.descricao,
      COALESCE(insumo.quantidade, 1), COALESCE(insumo.unidade, 'un'),
      COALESCE(insumo.custo_unitario, 0), insumo.created_by, COALESCE(insumo.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.manutencao_ordem_insumos, v_manutencao_ordem_insumos) AS insumo
    ON CONFLICT (id) DO UPDATE SET
      descricao = EXCLUDED.descricao, quantidade = EXCLUDED.quantidade,
      unidade = EXCLUDED.unidade, custo_unitario = EXCLUDED.custo_unitario
    WHERE public.manutencao_ordem_insumos.empresa_id = v_company_id;
    GET DIAGNOSTICS v_manutencao_ordem_insumos_count = ROW_COUNT;
    PERFORM set_config('backstage.equipment_maintenance_write', 'off', true);
  END IF;

  IF v_manutencao_ordem_eventos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manutencao_ordem_eventos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.manutencao_ordens AS o
      WHERE o.id = (item ->> 'ordem_id')::uuid AND o.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: manutencao_ordem_eventos references an ordem that does not exist in this company';
  END IF;

  IF v_manutencao_ordem_eventos IS NOT NULL THEN
    -- Immutable history (protect_equipment_maintenance_history
    -- unconditionally blocks UPDATE/DELETE, no bypass): append-only.
    INSERT INTO public.manutencao_ordem_eventos (
      id, empresa_id, ordem_id, tipo, status_anterior, status_novo, descricao,
      dados, executado_por, data_efetiva, client_uuid, payload_hash, created_at
    )
    SELECT
      evt.id, v_company_id, evt.ordem_id, evt.tipo, evt.status_anterior, evt.status_novo,
      evt.descricao, COALESCE(evt.dados, '{}'::jsonb), evt.executado_por,
      COALESCE(evt.data_efetiva, now()), evt.client_uuid, evt.payload_hash,
      COALESCE(evt.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.manutencao_ordem_eventos, v_manutencao_ordem_eventos) AS evt
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_financeiro_lancamentos IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_lancamentos) AS item
    WHERE NULLIF(item ->> 'cliente_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clientes AS c
      WHERE c.id = (item ->> 'cliente_id')::uuid AND c.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: financeiro_lancamentos references a cliente that does not exist in this company';
  END IF;

  IF v_financeiro_lancamentos IS NOT NULL THEN
    -- financeiro_recebimentos holds a plain (NO ACTION) reference to this
    -- table and can never be deleted - any lançamento that has ever
    -- received a payment blocks its own deletion. Upserted.
    INSERT INTO public.financeiro_lancamentos (
      id, empresa_id, origem_tipo, origem_id, cliente_id, tipo, descricao,
      forma_cobranca, valor_original, valor_recebido, valor_estornado, status,
      vencimento, forma_pagamento, observacoes, created_by, updated_by,
      created_at, updated_at
    )
    SELECT
      lanc.id, v_company_id, lanc.origem_tipo, lanc.origem_id, lanc.cliente_id,
      COALESCE(lanc.tipo, 'receita'), lanc.descricao, COALESCE(lanc.forma_cobranca, 'avista'),
      lanc.valor_original, COALESCE(lanc.valor_recebido, 0), COALESCE(lanc.valor_estornado, 0),
      COALESCE(lanc.status, 'pendente'), lanc.vencimento, lanc.forma_pagamento,
      lanc.observacoes, lanc.created_by, lanc.updated_by,
      COALESCE(lanc.created_at, now()), COALESCE(lanc.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.financeiro_lancamentos, v_financeiro_lancamentos) AS lanc
    ON CONFLICT (id) DO UPDATE SET
      valor_recebido = EXCLUDED.valor_recebido, valor_estornado = EXCLUDED.valor_estornado,
      status = EXCLUDED.status, forma_pagamento = EXCLUDED.forma_pagamento,
      observacoes = EXCLUDED.observacoes, updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.financeiro_lancamentos.empresa_id = v_company_id;
    GET DIAGNOSTICS v_financeiro_lancamentos_count = ROW_COUNT;
  END IF;

  IF v_financeiro_parcelas IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_parcelas) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.financeiro_lancamentos AS l
      WHERE l.id = (item ->> 'lancamento_id')::uuid AND l.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: financeiro_parcelas references a lancamento that does not exist in this company';
  END IF;

  IF v_financeiro_parcelas IS NOT NULL THEN
    -- Same reasoning as financeiro_lancamentos: financeiro_recebimentos
    -- references this table too and can never be deleted. Upserted.
    INSERT INTO public.financeiro_parcelas (
      id, empresa_id, lancamento_id, numero, valor, valor_recebido,
      valor_estornado, vencimento, status, created_at, updated_at
    )
    SELECT
      parcela.id, v_company_id, parcela.lancamento_id, parcela.numero, parcela.valor,
      COALESCE(parcela.valor_recebido, 0), COALESCE(parcela.valor_estornado, 0),
      parcela.vencimento, COALESCE(parcela.status, 'pendente'),
      COALESCE(parcela.created_at, now()), COALESCE(parcela.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.financeiro_parcelas, v_financeiro_parcelas) AS parcela
    ON CONFLICT (id) DO UPDATE SET
      valor_recebido = EXCLUDED.valor_recebido, valor_estornado = EXCLUDED.valor_estornado,
      status = EXCLUDED.status, updated_at = now()
    WHERE public.financeiro_parcelas.empresa_id = v_company_id;
    GET DIAGNOSTICS v_financeiro_parcelas_count = ROW_COUNT;
  END IF;

  IF v_financeiro_recebimentos IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_recebimentos) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.financeiro_lancamentos AS l
      WHERE l.id = (item ->> 'lancamento_id')::uuid AND l.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_financeiro_recebimentos) AS item
    WHERE NULLIF(item ->> 'parcela_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.financeiro_parcelas AS p
      WHERE p.id = (item ->> 'parcela_id')::uuid
        AND p.empresa_id = v_company_id
        AND p.lancamento_id = (item ->> 'lancamento_id')::uuid
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: financeiro_recebimentos references a lancamento or parcela that does not exist in this company';
  END IF;

  IF v_financeiro_recebimentos IS NOT NULL THEN
    -- Immutable ledger (protect_financeiro_recebimentos_history
    -- unconditionally blocks UPDATE/DELETE, no bypass): append-only. The
    -- self-referencing recebimento_estornado_id is a plain FK with no
    -- extra trigger, so it is checked once at end of statement and any
    -- row order within this single INSERT works.
    INSERT INTO public.financeiro_recebimentos (
      id, empresa_id, lancamento_id, parcela_id, tipo, recebimento_estornado_id,
      valor, forma_pagamento, data_recebimento, observacao, executado_por,
      client_uuid, created_at
    )
    SELECT
      receb.id, v_company_id, receb.lancamento_id, receb.parcela_id,
      COALESCE(receb.tipo, 'recebimento'), receb.recebimento_estornado_id,
      receb.valor, receb.forma_pagamento, COALESCE(receb.data_recebimento, now()),
      receb.observacao, receb.executado_por, receb.client_uuid,
      COALESCE(receb.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.financeiro_recebimentos, v_financeiro_recebimentos) AS receb
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- =====================================================================
  -- P1-10C writes. Order matches the dependency chain documented at the
  -- top of this migration. Every table here is upsert-only or
  -- append-only (ON CONFLICT DO NOTHING) - see that comment for why.
  -- =====================================================================

  IF v_rfid_tags IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rfid_tags) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: rfid_tags references a material that does not exist in this company';
  END IF;

  IF v_rfid_tags IS NOT NULL THEN
    -- prepare_rfid_tag_write makes epc/material_id/empresa_id immutable and
    -- unconditionally rejects reactivating an already-deactivated tag (same
    -- id). The WHERE clause below preserves that second rule as a graceful
    -- per-row skip instead of letting the trigger abort the whole restore -
    -- see the migration header for why.
    INSERT INTO public.rfid_tags (
      id, empresa_id, material_id, epc, status, vinculada_em, desativada_em,
      motivo_desativacao, substituida_por_tag_id, ultima_leitura_em,
      created_at, updated_at, created_by, updated_by
    )
    SELECT
      tag.id, v_company_id, tag.material_id, tag.epc, COALESCE(tag.status, 'ativa'),
      COALESCE(tag.vinculada_em, now()), tag.desativada_em, tag.motivo_desativacao,
      tag.substituida_por_tag_id, tag.ultima_leitura_em,
      COALESCE(tag.created_at, now()), COALESCE(tag.updated_at, now()),
      tag.created_by, tag.updated_by
    FROM jsonb_populate_recordset(NULL::public.rfid_tags, v_rfid_tags) AS tag
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status, desativada_em = EXCLUDED.desativada_em,
      motivo_desativacao = EXCLUDED.motivo_desativacao,
      substituida_por_tag_id = EXCLUDED.substituida_por_tag_id,
      ultima_leitura_em = EXCLUDED.ultima_leitura_em,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.rfid_tags.empresa_id = v_company_id
      AND NOT (public.rfid_tags.status <> 'ativa' AND EXCLUDED.status = 'ativa');
    GET DIAGNOSTICS v_rfid_tags_count = ROW_COUNT;
  END IF;

  IF v_rfid_read_sessions IS NOT NULL THEN
    -- prepare_rfid_read_session_write blocks any UPDATE once the session is
    -- concluida/cancelada, with no bypass - treated as append-only so a
    -- restore never attempts that UPDATE at all, finished or not.
    INSERT INTO public.rfid_read_sessions (
      id, empresa_id, tipo, referencia_tipo, referencia_id, dispositivo_label,
      responsavel_user_id, status, started_at, finished_at, expected_count,
      found_count, missing_count, unexpected_count, unknown_count, resultado,
      created_at, updated_at
    )
    SELECT
      sess.id, v_company_id, sess.tipo, sess.referencia_tipo, sess.referencia_id,
      sess.dispositivo_label, sess.responsavel_user_id, COALESCE(sess.status, 'em_andamento'),
      COALESCE(sess.started_at, now()), sess.finished_at, sess.expected_count,
      sess.found_count, sess.missing_count, sess.unexpected_count, sess.unknown_count,
      sess.resultado, COALESCE(sess.created_at, now()), COALESCE(sess.updated_at, now())
    FROM jsonb_populate_recordset(NULL::public.rfid_read_sessions, v_rfid_read_sessions) AS sess
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_etiqueta_modelos IS NOT NULL THEN
    PERFORM set_config('backstage.material_labels_write', 'on', true);
    INSERT INTO public.etiqueta_modelos (
      id, empresa_id, nome, descricao, largura_mm, altura_mm, tipo_identificacao,
      campos, tamanho_fonte, mostrar_borda, padrao, ativo, versao,
      margem_interna_mm, espacamento_interno_mm, created_at, updated_at, created_by, updated_by
    )
    SELECT
      modelo.id, v_company_id, modelo.nome, modelo.descricao, modelo.largura_mm, modelo.altura_mm,
      COALESCE(modelo.tipo_identificacao, 'qr_code'), COALESCE(modelo.campos, '["nome","codigo_interno"]'::jsonb),
      COALESCE(modelo.tamanho_fonte, 10), COALESCE(modelo.mostrar_borda, false),
      COALESCE(modelo.padrao, false), COALESCE(modelo.ativo, true), COALESCE(modelo.versao, 1),
      COALESCE(modelo.margem_interna_mm, 1.50), COALESCE(modelo.espacamento_interno_mm, 1.50),
      COALESCE(modelo.created_at, now()), COALESCE(modelo.updated_at, now()), modelo.created_by, modelo.updated_by
    FROM jsonb_populate_recordset(NULL::public.etiqueta_modelos, v_etiqueta_modelos) AS modelo
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, largura_mm = EXCLUDED.largura_mm,
      altura_mm = EXCLUDED.altura_mm, tipo_identificacao = EXCLUDED.tipo_identificacao,
      campos = EXCLUDED.campos, tamanho_fonte = EXCLUDED.tamanho_fonte,
      mostrar_borda = EXCLUDED.mostrar_borda, padrao = EXCLUDED.padrao, ativo = EXCLUDED.ativo,
      versao = EXCLUDED.versao, margem_interna_mm = EXCLUDED.margem_interna_mm,
      espacamento_interno_mm = EXCLUDED.espacamento_interno_mm,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.etiqueta_modelos.empresa_id = v_company_id;
    GET DIAGNOSTICS v_etiqueta_modelos_count = ROW_COUNT;
    PERFORM set_config('backstage.material_labels_write', 'off', true);
  END IF;

  IF v_etiqueta_impressoes IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_impressoes) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_impressoes) AS item
    WHERE NULLIF(item ->> 'modelo_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.etiqueta_modelos AS mo
      WHERE mo.id = (item ->> 'modelo_id')::uuid AND mo.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: etiqueta_impressoes references a material or modelo that does not exist in this company';
  END IF;

  IF v_etiqueta_impressoes IS NOT NULL THEN
    -- Append-only print-history ledger (protect_material_label_history
    -- blocks UPDATE/DELETE unconditionally): a restore replays the
    -- historical request/audit row, it never re-executes a print.
    PERFORM set_config('backstage.material_labels_write', 'on', true);
    INSERT INTO public.etiqueta_impressoes (
      id, empresa_id, modelo_id, material_id, quantidade, modelo_snapshot, material_snapshot,
      solicitada_em, solicitada_por, solicitante_nome, client_uuid, payload_hash, reimpressao_de_id
    )
    SELECT
      imp.id, v_company_id, imp.modelo_id, imp.material_id, imp.quantidade,
      imp.modelo_snapshot, imp.material_snapshot, COALESCE(imp.solicitada_em, now()),
      imp.solicitada_por, imp.solicitante_nome, imp.client_uuid, imp.payload_hash, imp.reimpressao_de_id
    FROM jsonb_populate_recordset(NULL::public.etiqueta_impressoes, v_etiqueta_impressoes) AS imp
    ON CONFLICT (id) DO NOTHING;
    PERFORM set_config('backstage.material_labels_write', 'off', true);
  END IF;

  IF v_etiqueta_solicitacoes IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_solicitacoes) AS item
    WHERE NULLIF(item ->> 'modelo_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.etiqueta_modelos AS mo
      WHERE mo.id = (item ->> 'modelo_id')::uuid AND mo.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: etiqueta_solicitacoes references a modelo that does not exist in this company';
  END IF;

  IF v_etiqueta_solicitacoes IS NOT NULL THEN
    -- Append-only (protect_material_label_batch_history: only INSERT is
    -- ever allowed, gated by this same flag; UPDATE/DELETE are always
    -- blocked). The batch-completeness constraint trigger on this table is
    -- DEFERRABLE INITIALLY DEFERRED, so it checks at commit, not against
    -- this statement alone - restoring solicitacoes before itens (below)
    -- resolves correctly regardless.
    PERFORM set_config('backstage.material_label_batch_write', 'on', true);
    INSERT INTO public.etiqueta_solicitacoes (
      id, empresa_id, modelo_id, modelo_snapshot, quantidade_materiais, quantidade_etiquetas,
      solicitada_em, solicitada_por, solicitante_nome, client_uuid, payload_hash,
      reimpressao_de_id, origem
    )
    SELECT
      sol.id, v_company_id, sol.modelo_id, sol.modelo_snapshot, sol.quantidade_materiais,
      sol.quantidade_etiquetas, COALESCE(sol.solicitada_em, now()), sol.solicitada_por,
      sol.solicitante_nome, sol.client_uuid, sol.payload_hash, sol.reimpressao_de_id,
      COALESCE(sol.origem, 'lote')
    FROM jsonb_populate_recordset(NULL::public.etiqueta_solicitacoes, v_etiqueta_solicitacoes) AS sol
    ON CONFLICT (id) DO NOTHING;
    PERFORM set_config('backstage.material_label_batch_write', 'off', true);
  END IF;

  IF v_etiqueta_solicitacao_itens IS NOT NULL AND (EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_solicitacao_itens) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.etiqueta_solicitacoes AS sol
      WHERE sol.id = (item ->> 'solicitacao_id')::uuid AND sol.empresa_id = v_company_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_etiqueta_solicitacao_itens) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.materiais AS m
      WHERE m.id = (item ->> 'material_id')::uuid AND m.empresa_id = v_company_id
    )
  )) THEN
    RAISE EXCEPTION 'Invalid backup payload: etiqueta_solicitacao_itens references a solicitacao or material that does not exist in this company';
  END IF;

  IF v_etiqueta_solicitacao_itens IS NOT NULL THEN
    PERFORM set_config('backstage.material_label_batch_write', 'on', true);
    INSERT INTO public.etiqueta_solicitacao_itens (
      id, empresa_id, solicitacao_id, material_id, ordem, quantidade, material_snapshot, created_at
    )
    SELECT
      item_row.id, v_company_id, item_row.solicitacao_id, item_row.material_id, item_row.ordem,
      item_row.quantidade, item_row.material_snapshot, COALESCE(item_row.created_at, now())
    FROM jsonb_populate_recordset(NULL::public.etiqueta_solicitacao_itens, v_etiqueta_solicitacao_itens) AS item_row
    ON CONFLICT (id) DO NOTHING;
    PERFORM set_config('backstage.material_label_batch_write', 'off', true);
  END IF;

  IF v_empresa_bobina_perfis IS NOT NULL THEN
    -- Plain configuration table, no protective trigger - RLS-only, already
    -- bypassed like every other table here by this function's own
    -- SECURITY DEFINER.
    INSERT INTO public.empresa_bobina_perfis (
      id, empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, colunas,
      espacamento_horizontal_mm, espacamento_vertical_mm, margem_esquerda_mm,
      margem_direita_mm, margem_superior_mm, margem_inferior_mm, orientacao,
      largura_midia_mm, offset_horizontal_mm, offset_vertical_mm, dpi,
      dpi_personalizado, padrao, ativo, created_at, updated_at, created_by, updated_by
    )
    SELECT
      perfil.id, v_company_id, perfil.nome, perfil.largura_etiqueta_mm, perfil.altura_etiqueta_mm,
      COALESCE(perfil.colunas, 1), COALESCE(perfil.espacamento_horizontal_mm, 0),
      COALESCE(perfil.espacamento_vertical_mm, 0), COALESCE(perfil.margem_esquerda_mm, 0),
      COALESCE(perfil.margem_direita_mm, 0), COALESCE(perfil.margem_superior_mm, 0),
      COALESCE(perfil.margem_inferior_mm, 0), COALESCE(perfil.orientacao, 'retrato'),
      perfil.largura_midia_mm, COALESCE(perfil.offset_horizontal_mm, 0),
      COALESCE(perfil.offset_vertical_mm, 0), COALESCE(perfil.dpi, 'automatico'),
      perfil.dpi_personalizado, COALESCE(perfil.padrao, false), COALESCE(perfil.ativo, true),
      COALESCE(perfil.created_at, now()), COALESCE(perfil.updated_at, now()),
      perfil.created_by, perfil.updated_by
    FROM jsonb_populate_recordset(NULL::public.empresa_bobina_perfis, v_empresa_bobina_perfis) AS perfil
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome, largura_etiqueta_mm = EXCLUDED.largura_etiqueta_mm,
      altura_etiqueta_mm = EXCLUDED.altura_etiqueta_mm, colunas = EXCLUDED.colunas,
      espacamento_horizontal_mm = EXCLUDED.espacamento_horizontal_mm,
      espacamento_vertical_mm = EXCLUDED.espacamento_vertical_mm,
      margem_esquerda_mm = EXCLUDED.margem_esquerda_mm, margem_direita_mm = EXCLUDED.margem_direita_mm,
      margem_superior_mm = EXCLUDED.margem_superior_mm, margem_inferior_mm = EXCLUDED.margem_inferior_mm,
      orientacao = EXCLUDED.orientacao, largura_midia_mm = EXCLUDED.largura_midia_mm,
      offset_horizontal_mm = EXCLUDED.offset_horizontal_mm, offset_vertical_mm = EXCLUDED.offset_vertical_mm,
      dpi = EXCLUDED.dpi, dpi_personalizado = EXCLUDED.dpi_personalizado,
      padrao = EXCLUDED.padrao, ativo = EXCLUDED.ativo, updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.empresa_bobina_perfis.empresa_id = v_company_id;
    GET DIAGNOSTICS v_empresa_bobina_perfis_count = ROW_COUNT;
  END IF;

  IF v_empresa_impressora_config IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_empresa_impressora_config) AS item
    WHERE NULLIF(item ->> 'perfil_bobina_padrao_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.empresa_bobina_perfis AS bp
      WHERE bp.id = (item ->> 'perfil_bobina_padrao_id')::uuid AND bp.empresa_id = v_company_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid backup payload: empresa_impressora_config references a perfil_bobina_padrao that does not exist in this company';
  END IF;

  IF v_empresa_impressora_config IS NOT NULL THEN
    -- Upserted on its real business key (empresa_id, finalidade) - the same
    -- conflict target its own canonical RPC (salvar_configuracao_impressora)
    -- already uses - not id, so the "same" per-purpose config restores
    -- correctly even if a live row already exists under a different id.
    INSERT INTO public.empresa_impressora_config (
      id, empresa_id, finalidade, nome_impressora, formato, largura_mm, altura_mm,
      orientacao, ativo, configuracoes, perfil_bobina_padrao_id, created_at, updated_at,
      created_by, updated_by
    )
    SELECT
      config.id, v_company_id, config.finalidade, config.nome_impressora, config.formato,
      config.largura_mm, config.altura_mm, COALESCE(config.orientacao, 'retrato'),
      COALESCE(config.ativo, true), COALESCE(config.configuracoes, '{}'::jsonb),
      config.perfil_bobina_padrao_id, COALESCE(config.created_at, now()), COALESCE(config.updated_at, now()),
      config.created_by, config.updated_by
    FROM jsonb_populate_recordset(NULL::public.empresa_impressora_config, v_empresa_impressora_config) AS config
    ON CONFLICT (empresa_id, finalidade) DO UPDATE SET
      nome_impressora = EXCLUDED.nome_impressora, formato = EXCLUDED.formato,
      largura_mm = EXCLUDED.largura_mm, altura_mm = EXCLUDED.altura_mm,
      orientacao = EXCLUDED.orientacao, ativo = EXCLUDED.ativo,
      configuracoes = EXCLUDED.configuracoes, perfil_bobina_padrao_id = EXCLUDED.perfil_bobina_padrao_id,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE public.empresa_impressora_config.empresa_id = v_company_id;
    GET DIAGNOSTICS v_empresa_impressora_config_count = ROW_COUNT;
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
    'generated_documents', CASE WHEN v_generated_documents IS NOT NULL THEN jsonb_array_length(v_generated_documents) ELSE 0 END,
    'categorias_materiais', v_categorias_count,
    'materiais', v_materiais_count,
    'estoque_localizacoes', v_estoque_localizacoes_count,
    'estoque_saldos', v_estoque_saldos_count,
    'estoque_movimentacoes', CASE WHEN v_estoque_movimentacoes IS NOT NULL THEN jsonb_array_length(v_estoque_movimentacoes) ELSE 0 END,
    'material_custodias', v_material_custodias_count,
    'material_custodia_eventos', CASE WHEN v_material_custodia_eventos IS NOT NULL THEN jsonb_array_length(v_material_custodia_eventos) ELSE 0 END,
    'material_locacoes', v_material_locacoes_count,
    'material_locacao_itens', v_material_locacao_itens_count,
    'material_locacao_eventos', CASE WHEN v_material_locacao_eventos IS NOT NULL THEN jsonb_array_length(v_material_locacao_eventos) ELSE 0 END,
    'manutencao_ordens', v_manutencao_ordens_count,
    'manutencao_ordem_insumos', v_manutencao_ordem_insumos_count,
    'manutencao_ordem_eventos', CASE WHEN v_manutencao_ordem_eventos IS NOT NULL THEN jsonb_array_length(v_manutencao_ordem_eventos) ELSE 0 END,
    'financeiro_lancamentos', v_financeiro_lancamentos_count,
    'financeiro_parcelas', v_financeiro_parcelas_count,
    'financeiro_recebimentos', CASE WHEN v_financeiro_recebimentos IS NOT NULL THEN jsonb_array_length(v_financeiro_recebimentos) ELSE 0 END,
    'rfid_tags', v_rfid_tags_count,
    'rfid_read_sessions', CASE WHEN v_rfid_read_sessions IS NOT NULL THEN jsonb_array_length(v_rfid_read_sessions) ELSE 0 END,
    'etiqueta_modelos', v_etiqueta_modelos_count,
    'etiqueta_impressoes', CASE WHEN v_etiqueta_impressoes IS NOT NULL THEN jsonb_array_length(v_etiqueta_impressoes) ELSE 0 END,
    'etiqueta_solicitacoes', CASE WHEN v_etiqueta_solicitacoes IS NOT NULL THEN jsonb_array_length(v_etiqueta_solicitacoes) ELSE 0 END,
    'etiqueta_solicitacao_itens', CASE WHEN v_etiqueta_solicitacao_itens IS NOT NULL THEN jsonb_array_length(v_etiqueta_solicitacao_itens) ELSE 0 END,
    'empresa_bobina_perfis', v_empresa_bobina_perfis_count,
    'empresa_impressora_config', v_empresa_impressora_config_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_company_backup(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_company_backup(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.restore_company_backup(uuid, jsonb) IS
  'Atomically validates and restores the company backup scope for the authenticated administrator company: events/event_days/event_files/financials (delete+replace); clientes/funcionarios/categorias_materiais/materiais/estoque_localizacoes/estoque_saldos/material_custodias/material_locacoes/material_locacao_itens/manutencao_ordens/manutencao_ordem_insumos/financeiro_lancamentos/financeiro_parcelas/rfid_tags/etiqueta_modelos/empresa_bobina_perfis/empresa_impressora_config (upsert, never deleted); event_funcionarios/event_checklist_items/document_templates/generated_documents (delete+replace); and estoque_movimentacoes/material_custodia_eventos/material_locacao_eventos/manutencao_ordem_eventos/financeiro_recebimentos/rfid_read_sessions/etiqueta_impressoes/etiqueta_solicitacoes/etiqueta_solicitacao_itens (append-only, ON CONFLICT DO NOTHING) - all when present in the payload. Any failure rolls back every change. Collections absent from an older backup are left untouched. Local per-terminal printer overrides (localStorage/desktop) are never read or written by this function - only the company-shared empresa_bobina_perfis/empresa_impressora_config rows are in scope.';

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

CREATE OR REPLACE FUNCTION public.gather_company_backup_data(
  _empresa_id uuid,
  _date_start date DEFAULT NULL,
  _date_end date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid;
  v_event_ids uuid[];
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Authentication is required to read backup data';
  END IF;

  v_company_id := public.get_user_empresa_id(v_actor_id);

  IF v_company_id IS NULL OR _empresa_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Backup data can only be read for the authenticated user company';
  END IF;

  -- Same bar as assertBackupAdministrator on the client (role ===
  -- 'master_admin' || role === 'admin_empresa') - now also enforced here,
  -- server-side, independent of the UI. Deliberately not
  -- assert_actor_company_operational_access: that helper also requires
  -- company_has_operational_access (blocks writes for a suspended/unpaid
  -- company), which is exactly the wrong failure mode for a read-only
  -- export a company may need most when something is wrong with its
  -- account.
  IF NOT (
    public.has_role(v_actor_id, 'admin_empresa'::public.app_role)
    OR public.is_master_admin(v_actor_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Only a company administrator can read backup data';
  END IF;

  -- Mirrors gatherBackupData's own date-range scoping for events and
  -- everything event-owned; every other collection below is standing
  -- company data, always read in full, exactly as gatherBackupData already
  -- did for clientes/funcionarios/document_templates and as
  -- gatherOperationalCoreBackupData did for the sixteen P1-10B tables.
  SELECT COALESCE(array_agg(e.id), ARRAY[]::uuid[])
  INTO v_event_ids
  FROM public.events AS e
  WHERE e.empresa_id = v_company_id
    AND (_date_start IS NULL OR e.date >= _date_start)
    AND (_date_end IS NULL OR e.date <= _date_end);

  RETURN jsonb_build_object(
    'eventos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.events AS t WHERE t.id = ANY(v_event_ids)
    ),
    'event_days', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.event_days AS t WHERE t.event_id = ANY(v_event_ids)
    ),
    'event_files', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.event_files AS t WHERE t.event_id = ANY(v_event_ids)
    ),
    'financials', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.financials AS t WHERE t.event_id = ANY(v_event_ids)
    ),
    'clientes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.clientes AS t WHERE t.empresa_id = v_company_id
    ),
    'funcionarios', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.funcionarios AS t WHERE t.empresa_id = v_company_id
    ),
    'event_funcionarios', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.event_funcionarios AS t WHERE t.event_id = ANY(v_event_ids)
    ),
    'event_checklist_items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.event_checklist_items AS t WHERE t.event_id = ANY(v_event_ids)
    ),
    'document_templates', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.document_templates AS t WHERE t.empresa_id = v_company_id
    ),
    'generated_documents', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.generated_documents AS t
      WHERE t.empresa_id = v_company_id
        AND (t.event_id IS NULL OR t.event_id = ANY(v_event_ids))
    ),
    'categorias_materiais', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.categorias_materiais AS t WHERE t.empresa_id = v_company_id
    ),
    'materiais', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.materiais AS t WHERE t.empresa_id = v_company_id
    ),
    'estoque_localizacoes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.estoque_localizacoes AS t WHERE t.empresa_id = v_company_id
    ),
    'estoque_saldos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.estoque_saldos AS t WHERE t.empresa_id = v_company_id
    ),
    'estoque_movimentacoes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.estoque_movimentacoes AS t WHERE t.empresa_id = v_company_id
    ),
    'material_custodias', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.material_custodias AS t WHERE t.empresa_id = v_company_id
    ),
    'material_custodia_eventos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.material_custodia_eventos AS t WHERE t.empresa_id = v_company_id
    ),
    'material_locacoes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.material_locacoes AS t WHERE t.empresa_id = v_company_id
    ),
    'material_locacao_itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.material_locacao_itens AS t WHERE t.empresa_id = v_company_id
    ),
    'material_locacao_eventos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.material_locacao_eventos AS t WHERE t.empresa_id = v_company_id
    ),
    'manutencao_ordens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.manutencao_ordens AS t WHERE t.empresa_id = v_company_id
    ),
    'manutencao_ordem_insumos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.manutencao_ordem_insumos AS t WHERE t.empresa_id = v_company_id
    ),
    'manutencao_ordem_eventos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.manutencao_ordem_eventos AS t WHERE t.empresa_id = v_company_id
    ),
    'financeiro_lancamentos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.financeiro_lancamentos AS t WHERE t.empresa_id = v_company_id
    ),
    'financeiro_parcelas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.financeiro_parcelas AS t WHERE t.empresa_id = v_company_id
    ),
    'financeiro_recebimentos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.financeiro_recebimentos AS t WHERE t.empresa_id = v_company_id
    ),
    -- P1-10C: RFID, etiquetas/impressão, configuração compartilhada de
    -- bobina/impressora. Read directly, same as everything above -
    -- unaffected by can_read_company_module/company_has_active_module, so
    -- a company keeps exporting its own RFID/label history after the
    -- rfid_materiais/etiquetas_materiais module is deactivated.
    'rfid_tags', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.rfid_tags AS t WHERE t.empresa_id = v_company_id
    ),
    'rfid_read_sessions', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.rfid_read_sessions AS t WHERE t.empresa_id = v_company_id
    ),
    'etiqueta_modelos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.etiqueta_modelos AS t WHERE t.empresa_id = v_company_id
    ),
    'etiqueta_impressoes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.etiqueta_impressoes AS t WHERE t.empresa_id = v_company_id
    ),
    'etiqueta_solicitacoes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.etiqueta_solicitacoes AS t WHERE t.empresa_id = v_company_id
    ),
    'etiqueta_solicitacao_itens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.etiqueta_solicitacao_itens AS t WHERE t.empresa_id = v_company_id
    ),
    'empresa_bobina_perfis', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.empresa_bobina_perfis AS t WHERE t.empresa_id = v_company_id
    ),
    'empresa_impressora_config', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM public.empresa_impressora_config AS t WHERE t.empresa_id = v_company_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gather_company_backup_data(uuid, date, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gather_company_backup_data(uuid, date, date)
  TO authenticated;

COMMENT ON FUNCTION public.gather_company_backup_data(uuid, date, date) IS
  'SECURITY DEFINER read used exclusively by the backup export flow (createBackup -> gatherBackupData). Returns every backup collection (the original four, the six P1-10 collections, the sixteen P1-10B operational-core collections, and the eight P1-10C RFID/labels/printing collections) as one structured jsonb object, bypassing can_read_company_module/company_has_active_module so a company keeps exporting its own historical data after a module is deactivated or its subscription lapses. Not a general-purpose bypass: requires admin_empresa or master_admin, strictly resolves and isolates by the caller''s own company (the _empresa_id argument is asserted, never trusted), and is not granted to any other role or wired into any other read path. Normal screens are unaffected and keep obeying RLS and module entitlements exactly as before. Local per-terminal printer overrides (localStorage/desktop) are never read by this function.';

DO $$
DECLARE
  v_fn regprocedure := 'public.gather_company_backup_data(uuid,date,date)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'gather_company_backup_data privileges are not hardened as expected';
  END IF;
END;
$$;
