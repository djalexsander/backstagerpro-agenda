-- Backstage Pro - Materials traceability ("Rastreabilidade de Materiais").
-- Read-only aggregation over existing domains. Does not create a new table,
-- a new commercial module, or a second checkout/rental engine: materiais,
-- material_custodias/material_custodia_eventos, material_locacoes/
-- material_locacao_itens, manutencao_ordens, estoque_saldos/
-- estoque_localizacoes/estoque_movimentacoes and rfid_tags remain the sole
-- source of truth and are only ever SELECTed here. Gated by the existing
-- 'gestao_materiais' module (per-user, via user_has_module_action) rather
-- than a new module_catalog row - this screen is part of Gestão de
-- Materiais, not a new paid add-on every existing company would need to
-- activate before using it.

-- ============================================================================
-- resolve_material_traceability_company - same auth/company shape as
-- resolve_custody_company/resolve_stock_company, but read-only (no _write
-- branch) and gated on user_has_module_action('gestao_materiais','view')
-- instead of can_read_company_module, following the more modern per-user
-- granular pattern introduced for RFID (20260810090000_user_module_permissions.sql)
-- rather than the older role-only cut every pre-RFID module still uses.
-- gestao_materiais already existed well before that migration's one-time
-- backfill, so existing 'usuario' accounts that could already see /materiais
-- already carry can_view=true for it and are not newly locked out here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_material_traceability_company(
  _requested_company_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'RT001',
        MESSAGE = 'Selecione a empresa para consultar a rastreabilidade.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL
       OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
  END IF;

  IF NOT public.user_has_module_action(v_company_id, 'gestao_materiais', 'view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Sem permissão para consultar a rastreabilidade de materiais desta empresa.';
  END IF;

  RETURN v_company_id;
END;
$$;

-- ============================================================================
-- resumo_situacao_material - the single "where is it / who has it / has it
-- come back" derivation, shared by the search results (lightweight, per row)
-- and the single-material detail (same shape, just one call). Internal
-- helper only (no GRANT to authenticated below) - callers are expected to
-- have already authorized via resolve_material_traceability_company.
--
-- Precedence, all derived (materiais.status_operacional is manually curated
-- and NEVER auto-synced by checkout/checkin/rental - see stage-one/three/four
-- migrations - so it cannot be read alone to answer "is it out right now"):
--   1. Open maintenance order (manutencao_ordens) - mutually exclusive with
--      open custody by construction (block_custody_when_maintenance_active /
--      criar_ordem_manutencao's own guard), so checking it first is safe.
--   2. Open/partial custody (material_custodias) - 'locado' when the custody
--      is tagged to a rental item (referencia_tipo='locacao_item'), else
--      'emprestado' for any other finalidade (uso_interno/funcionario/
--      evento/transferencia_operacional/outro). Rental enrichment (numero/
--      cliente) is only attempted when locacao_materiais is actually active
--      for the company, mirroring material_locacoes' own RLS module stack.
--   3. Manually-set non-'disponivel' status_operacional (avariado/
--      extraviado/baixado) - surfaced as-is, never invented.
--   4. Disponível - current stock balances (estoque_saldos, not the
--      deprecated materiais.localizacao) plus the last concluded custody's
--      return facts (encerrada_em from material_custodias, "quem recebeu"
--      from the matching checkin event in material_custodia_eventos, since
--      the parent custody row itself does not record a receiver).
-- No "em trânsito" state: not modeled anywhere in this domain, so it is not
-- fabricated here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resumo_situacao_material(
  _material_id uuid,
  _empresa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_material record;
  v_maintenance record;
  v_custody record;
  v_rental jsonb;
  v_can_rental boolean;
  v_last_return_at timestamptz;
  v_last_return_by text;
  v_locations jsonb;
BEGIN
  SELECT status_operacional, justificativa_status
  INTO v_material
  FROM public.materiais
  WHERE id = _material_id AND empresa_id = _empresa_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT numero, status, aberta_em, previsao_conclusao_em, responsavel_nome
  INTO v_maintenance
  FROM public.manutencao_ordens
  WHERE empresa_id = _empresa_id AND material_id = _material_id
    AND status IN ('aberta', 'aguardando_analise', 'em_manutencao', 'aguardando_peca')
  ORDER BY aberta_em DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'situacao', 'em_manutencao',
      'manutencao_numero', v_maintenance.numero,
      'manutencao_status', v_maintenance.status,
      'manutencao_aberta_em', v_maintenance.aberta_em,
      'manutencao_previsao_conclusao_em', v_maintenance.previsao_conclusao_em,
      'manutencao_responsavel_nome', v_maintenance.responsavel_nome
    );
  END IF;

  SELECT
    custody.id, custody.status, custody.finalidade,
    custody.retirada_em, custody.previsao_retorno,
    custody.responsavel_nome, custody.referencia_tipo, custody.referencia_id,
    COALESCE(actor.full_name, 'Usuário') AS executor_nome
  INTO v_custody
  FROM public.material_custodias AS custody
  LEFT JOIN public.profiles AS actor ON actor.user_id = custody.executado_por
  WHERE custody.empresa_id = _empresa_id AND custody.material_id = _material_id
    AND custody.status IN ('aberta', 'parcial')
  ORDER BY custody.retirada_em DESC
  LIMIT 1;

  IF FOUND THEN
    v_can_rental := public.company_has_active_module(_empresa_id, 'locacao_materiais')
      AND public.company_has_active_module(_empresa_id, 'gestao_materiais')
      AND public.company_has_active_module(_empresa_id, 'controle_estoque')
      AND public.company_has_active_module(_empresa_id, 'checkin_checkout');

    v_rental := NULL;
    IF v_can_rental AND v_custody.referencia_tipo = 'locacao_item' THEN
      SELECT jsonb_build_object(
        'locacao_id', rental.id,
        'locacao_numero', rental.numero,
        'cliente_id', customer.id,
        'cliente_nome', COALESCE(nullif(btrim(customer.nome_fantasia), ''), customer.nome)
      )
      INTO v_rental
      FROM public.material_locacao_itens AS item
      JOIN public.material_locacoes AS rental
        ON rental.empresa_id = item.empresa_id AND rental.id = item.locacao_id
      JOIN public.clientes AS customer
        ON customer.empresa_id = rental.empresa_id AND customer.id = rental.cliente_id
      WHERE item.empresa_id = _empresa_id AND item.id = v_custody.referencia_id;
    END IF;

    RETURN jsonb_build_object(
      'situacao', CASE WHEN v_custody.finalidade = 'locacao' THEN 'locado' ELSE 'emprestado' END,
      'custodia_id', v_custody.id,
      'custodia_status', v_custody.status,
      'finalidade', v_custody.finalidade,
      'retirada_em', v_custody.retirada_em,
      'previsao_retorno', v_custody.previsao_retorno,
      'atrasado', v_custody.previsao_retorno IS NOT NULL AND v_custody.previsao_retorno < clock_timestamp(),
      'retirado_por', v_custody.responsavel_nome,
      'liberado_por', v_custody.executor_nome,
      'locacao', v_rental
    );
  END IF;

  IF v_material.status_operacional <> 'disponivel' THEN
    RETURN jsonb_build_object(
      'situacao', v_material.status_operacional::text,
      'justificativa_status', v_material.justificativa_status
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'localizacao_id', balance.localizacao_id,
    'localizacao_codigo', location.codigo,
    'localizacao_nome', location.nome
  ) ORDER BY location.nome), '[]'::jsonb)
  INTO v_locations
  FROM public.estoque_saldos AS balance
  JOIN public.estoque_localizacoes AS location
    ON location.empresa_id = balance.empresa_id AND location.id = balance.localizacao_id
  WHERE balance.empresa_id = _empresa_id AND balance.material_id = _material_id
    AND balance.quantidade > 0;

  SELECT custody.encerrada_em, checkin_event.executor_nome
  INTO v_last_return_at, v_last_return_by
  FROM public.material_custodias AS custody
  LEFT JOIN LATERAL (
    SELECT COALESCE(actor.full_name, 'Usuário') AS executor_nome
    FROM public.material_custodia_eventos AS event
    LEFT JOIN public.profiles AS actor ON actor.user_id = event.executado_por
    WHERE event.empresa_id = custody.empresa_id
      AND event.custodia_id = custody.id
      AND event.tipo = 'checkin'
    ORDER BY event.data_efetiva DESC
    LIMIT 1
  ) AS checkin_event ON true
  WHERE custody.empresa_id = _empresa_id AND custody.material_id = _material_id
    AND custody.status = 'concluida'
  ORDER BY custody.encerrada_em DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'situacao', 'disponivel',
    'localizacoes', v_locations,
    'ultimo_retorno_em', v_last_return_at,
    'ultimo_retorno_recebido_por', v_last_return_by
  );
END;
$$;

-- ============================================================================
-- buscar_rastreabilidade_materiais - the search bar's single entry point.
-- Same identifier priority (id/identificador_unico/QR/barcode/codigo_interno/
-- patrimonio/serie exact, then nome/codigo_interno ILIKE) already used by
-- matchMaterialIdentifierLocally (material-resolution.ts) and, server-side,
-- by buscar_materiais_custodia - extended here with an EPC branch, gated
-- per-company so it costs nothing and matches nothing for a company without
-- the RFID entitlement. Deliberately its own SQL copy rather than a
-- refactor of buscar_materiais_custodia: that function is load-bearing for
-- the live checkout flow, and this screen's needs (paginated, multi-result,
-- EPC-aware, no client-side preload) diverge enough from its single-purpose
-- custody-search shape that sharing it would mean widening tested code for
-- a second, unrelated caller. See material-traceability-service.ts / the
-- delivery report for why resolveMaterialIdentifier (material-resolution.ts)
-- was evaluated and not used as the search engine itself (it returns at
-- most one match against an already-loaded list; this screen needs a
-- paginated, possibly-many-results, no-preload search).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.buscar_rastreabilidade_materiais(
  _termo text,
  _limite integer DEFAULT 20,
  _offset integer DEFAULT 0,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (item jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_search text := btrim(COALESCE(_termo, ''));
  v_limit integer := LEAST(GREATEST(COALESCE(_limite, 20), 1), 50);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_rfid_active boolean;
BEGIN
  v_company_id := public.resolve_material_traceability_company(_empresa_id);
  IF v_search = '' THEN
    RETURN;
  END IF;

  v_rfid_active := public.company_has_active_module(v_company_id, 'rfid_materiais');

  RETURN QUERY
  WITH matched AS (
    SELECT
      material.id,
      material.nome,
      material.codigo_interno,
      material.numero_patrimonio,
      material.numero_serie,
      material.codigo_barras,
      material.identificador_unico,
      material.status_operacional,
      material.ativo,
      material.empresa_id,
      CASE WHEN
        lower(material.id::text) = lower(v_search)
        OR lower(COALESCE(material.identificador_unico::text, '')) = lower(v_search)
        OR lower(COALESCE(material.conteudo_qr_code, '')) = lower(v_search)
        OR lower(COALESCE(material.codigo_barras, '')) = lower(v_search)
        OR lower(material.codigo_interno) = lower(v_search)
        OR lower(COALESCE(material.numero_patrimonio, '')) = lower(v_search)
        OR lower(COALESCE(material.numero_serie, '')) = lower(v_search)
        OR (v_rfid_active AND EXISTS (
              SELECT 1 FROM public.rfid_tags AS tag
              WHERE tag.empresa_id = material.empresa_id
                AND tag.material_id = material.id
                AND tag.status = 'ativa'
                AND tag.epc = upper(v_search)
            ))
        THEN 0 ELSE 1
      END AS match_rank
    FROM public.materiais AS material
    WHERE material.empresa_id = v_company_id
      AND (
        lower(material.id::text) = lower(v_search)
        OR lower(COALESCE(material.identificador_unico::text, '')) = lower(v_search)
        OR lower(COALESCE(material.conteudo_qr_code, '')) = lower(v_search)
        OR lower(COALESCE(material.codigo_barras, '')) = lower(v_search)
        OR lower(material.codigo_interno) = lower(v_search)
        OR lower(COALESCE(material.numero_patrimonio, '')) = lower(v_search)
        OR lower(COALESCE(material.numero_serie, '')) = lower(v_search)
        OR material.nome ILIKE '%' || v_search || '%'
        OR material.codigo_interno ILIKE '%' || v_search || '%'
        OR (v_rfid_active AND EXISTS (
              SELECT 1 FROM public.rfid_tags AS tag
              WHERE tag.empresa_id = material.empresa_id
                AND tag.material_id = material.id
                AND tag.status = 'ativa'
                AND tag.epc = upper(v_search)
            ))
      )
  )
  SELECT
    jsonb_build_object(
      'id', matched.id,
      'nome', matched.nome,
      'codigo_interno', matched.codigo_interno,
      'numero_patrimonio', matched.numero_patrimonio,
      'numero_serie', matched.numero_serie,
      'codigo_barras', matched.codigo_barras,
      'identificador_unico', matched.identificador_unico,
      'status_operacional', matched.status_operacional,
      'ativo', matched.ativo,
      'foto_path', (
        SELECT photo.storage_path
        FROM public.materiais_fotos AS photo
        WHERE photo.empresa_id = matched.empresa_id AND photo.material_id = matched.id
        ORDER BY photo.foto_principal DESC, photo.created_at, photo.id
        LIMIT 1
      ),
      'resumo', public.resumo_situacao_material(matched.id, matched.empresa_id)
    ),
    count(*) OVER ()
  FROM matched
  ORDER BY matched.match_rank, matched.nome, matched.id
  OFFSET v_offset
  LIMIT v_limit;
END;
$$;

-- ============================================================================
-- obter_rastreabilidade_material - full single-material aggregation: current
-- situation (resumo_situacao_material), RFID tag identity history when
-- entitled, and a merged chronological timeline. Each source section is
-- independently gated by the same module stack its own table's RLS already
-- requires (material_custodias needs checkin_checkout+gestao_materiais+
-- controle_estoque; material_locacoes additionally needs locacao_materiais;
-- manutencao_ordens needs manutencao_equipamentos; rfid_tags needs
-- user_has_module_action(...,'rfid_materiais','view'), matching its own RLS
-- policy exactly since this function bypasses RLS as SECURITY DEFINER) - a
-- company without one of these modules simply gets that section empty, not
-- an error, and the 'permissoes' block tells the frontend which sections
-- were actually available so it can render "not enabled" instead of
-- confusing an empty section with an empty history.
--
-- The timeline never re-derives rental pickup/return as separate rows:
-- material_locacao_eventos are commercial echoes of the same physical
-- checkout/checkin already recorded in material_custodia_eventos (see the
-- table comments in 20260802200000_material_rentals_stage_four.sql - "eventos
-- físicos permanecem no histórico de custódia") - only material_custodias/
-- material_custodia_eventos are read for the physical checkout/checkin
-- entries, enriched with locação numero/cliente via the polymorphic
-- referencia_tipo='locacao_item' link, never duplicated as a second entry.
-- Stock movements sourced from checkin/checkout (origem_modulo=
-- 'checkin_checkout') are excluded for the same reason - they are the ledger
-- reflection of the very same custody event, not a distinct occurrence.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.obter_rastreabilidade_material(
  _material_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_material record;
  v_can_stock boolean;
  v_can_custody boolean;
  v_can_rental boolean;
  v_can_maintenance boolean;
  v_can_rfid boolean;
  v_timeline jsonb;
  v_rfid jsonb;
BEGIN
  v_company_id := public.resolve_material_traceability_company(_empresa_id);

  SELECT
    material.id, material.nome, material.codigo_interno, material.numero_patrimonio,
    material.numero_serie, material.codigo_barras, material.identificador_unico,
    material.conteudo_qr_code, category.nome AS categoria_nome,
    material.marca, material.modelo, material.unidade_medida, material.tipo_controle,
    material.status_operacional, material.ativo,
    (
      SELECT photo.storage_path FROM public.materiais_fotos AS photo
      WHERE photo.empresa_id = material.empresa_id AND photo.material_id = material.id
      ORDER BY photo.foto_principal DESC, photo.created_at, photo.id LIMIT 1
    ) AS foto_path
  INTO v_material
  FROM public.materiais AS material
  LEFT JOIN public.categorias_materiais AS category
    ON category.empresa_id = material.empresa_id AND category.id = material.categoria_id
  WHERE material.empresa_id = v_company_id AND material.id = _material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'RT002', MESSAGE = 'Material não encontrado nesta empresa.';
  END IF;

  v_can_stock := public.company_has_active_module(v_company_id, 'controle_estoque')
    AND public.company_has_active_module(v_company_id, 'gestao_materiais');
  v_can_custody := v_can_stock
    AND public.company_has_active_module(v_company_id, 'checkin_checkout');
  v_can_rental := v_can_custody
    AND public.company_has_active_module(v_company_id, 'locacao_materiais');
  v_can_maintenance := public.company_has_active_module(v_company_id, 'manutencao_equipamentos');
  v_can_rfid := public.user_has_module_action(v_company_id, 'rfid_materiais', 'view');

  WITH eventos AS (
    SELECT
      event.data_efetiva AS data,
      event.tipo::text AS tipo,
      jsonb_build_object(
        'custodia_id', event.custodia_id,
        'quantidade', event.quantidade,
        'condicao', event.condicao,
        'ocorrencia', event.ocorrencia,
        'observacao', event.observacao,
        'justificativa', event.justificativa,
        'executor_nome', COALESCE(actor.full_name, 'Usuário'),
        'localizacao_origem_nome', origin.nome,
        'localizacao_destino_nome', destination.nome,
        'responsavel_nome', custody.responsavel_nome,
        'finalidade', custody.finalidade,
        'locacao_numero', rental.numero,
        'cliente_nome', COALESCE(nullif(btrim(customer.nome_fantasia), ''), customer.nome)
      ) AS detalhes
    FROM public.material_custodia_eventos AS event
    JOIN public.material_custodias AS custody
      ON custody.empresa_id = event.empresa_id AND custody.id = event.custodia_id
    LEFT JOIN public.profiles AS actor ON actor.user_id = event.executado_por
    LEFT JOIN public.estoque_localizacoes AS origin
      ON origin.empresa_id = event.empresa_id AND origin.id = event.localizacao_origem_id
    LEFT JOIN public.estoque_localizacoes AS destination
      ON destination.empresa_id = event.empresa_id AND destination.id = event.localizacao_destino_id
    LEFT JOIN public.material_locacao_itens AS item
      ON v_can_rental AND custody.referencia_tipo = 'locacao_item'
      AND item.empresa_id = event.empresa_id AND item.id = custody.referencia_id
    LEFT JOIN public.material_locacoes AS rental
      ON rental.empresa_id = item.empresa_id AND rental.id = item.locacao_id
    LEFT JOIN public.clientes AS customer
      ON customer.empresa_id = rental.empresa_id AND customer.id = rental.cliente_id
    WHERE event.empresa_id = v_company_id AND event.material_id = _material_id
      AND v_can_custody

    UNION ALL

    SELECT
      order_row.aberta_em,
      'manutencao_aberta',
      jsonb_build_object(
        'numero', order_row.numero, 'tipo', order_row.tipo,
        'defeito_relatado', order_row.defeito_relatado,
        'responsavel_nome', order_row.responsavel_nome
      )
    FROM public.manutencao_ordens AS order_row
    WHERE order_row.empresa_id = v_company_id AND order_row.material_id = _material_id
      AND v_can_maintenance

    UNION ALL

    SELECT
      COALESCE(order_row.concluida_em, order_row.cancelada_em),
      CASE WHEN order_row.status = 'concluida' THEN 'manutencao_concluida' ELSE 'manutencao_cancelada' END,
      jsonb_build_object(
        'numero', order_row.numero,
        'servico_executado', order_row.servico_executado,
        'custo_total', order_row.custo_total
      )
    FROM public.manutencao_ordens AS order_row
    WHERE order_row.empresa_id = v_company_id AND order_row.material_id = _material_id
      AND order_row.status IN ('concluida', 'cancelada') AND v_can_maintenance

    UNION ALL

    SELECT
      movement.data_efetiva,
      'movimentacao_estoque',
      jsonb_build_object(
        'tipo_movimentacao', movement.tipo_movimentacao,
        'quantidade', movement.quantidade,
        'motivo', movement.motivo,
        'localizacao_origem_nome', origin.nome,
        'localizacao_destino_nome', destination.nome,
        'origem_modulo', movement.origem_modulo
      )
    FROM public.estoque_movimentacoes AS movement
    LEFT JOIN public.estoque_localizacoes AS origin
      ON origin.empresa_id = movement.empresa_id AND origin.id = movement.localizacao_origem_id
    LEFT JOIN public.estoque_localizacoes AS destination
      ON destination.empresa_id = movement.empresa_id AND destination.id = movement.localizacao_destino_id
    WHERE movement.empresa_id = v_company_id AND movement.material_id = _material_id
      AND movement.origem_modulo <> 'checkin_checkout' AND v_can_stock

    UNION ALL

    SELECT
      COALESCE(tag.desativada_em, tag.vinculada_em),
      CASE WHEN tag.desativada_em IS NOT NULL THEN 'rfid_tag_desativada' ELSE 'rfid_tag_vinculada' END,
      jsonb_build_object('epc', tag.epc, 'status', tag.status, 'motivo_desativacao', tag.motivo_desativacao)
    FROM public.rfid_tags AS tag
    WHERE tag.empresa_id = v_company_id AND tag.material_id = _material_id AND v_can_rfid
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('data', limited.data, 'tipo', limited.tipo, 'detalhes', limited.detalhes)
    ORDER BY limited.data DESC
  ), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT * FROM eventos ORDER BY data DESC LIMIT 200
  ) AS limited;

  IF v_can_rfid THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', tag.id, 'epc', tag.epc, 'status', tag.status,
      'vinculada_em', tag.vinculada_em, 'desativada_em', tag.desativada_em,
      'motivo_desativacao', tag.motivo_desativacao
    ) ORDER BY tag.vinculada_em DESC), '[]'::jsonb)
    INTO v_rfid
    FROM public.rfid_tags AS tag
    WHERE tag.empresa_id = v_company_id AND tag.material_id = _material_id;
  ELSE
    v_rfid := NULL;
  END IF;

  RETURN jsonb_build_object(
    'material', jsonb_build_object(
      'id', v_material.id, 'nome', v_material.nome, 'codigo_interno', v_material.codigo_interno,
      'numero_patrimonio', v_material.numero_patrimonio, 'numero_serie', v_material.numero_serie,
      'codigo_barras', v_material.codigo_barras, 'identificador_unico', v_material.identificador_unico,
      'conteudo_qr_code', v_material.conteudo_qr_code, 'categoria_nome', v_material.categoria_nome,
      'marca', v_material.marca, 'modelo', v_material.modelo, 'unidade_medida', v_material.unidade_medida,
      'tipo_controle', v_material.tipo_controle, 'status_operacional', v_material.status_operacional,
      'ativo', v_material.ativo, 'foto_path', v_material.foto_path
    ),
    'resumo', public.resumo_situacao_material(_material_id, v_company_id),
    'rfid_tags', v_rfid,
    'timeline', v_timeline,
    'permissoes', jsonb_build_object(
      'estoque', v_can_stock, 'custodia', v_can_custody, 'locacao', v_can_rental,
      'manutencao', v_can_maintenance, 'rfid', v_can_rfid
    )
  );
END;
$$;

-- ============================================================================
-- Index - material_custodia_eventos has a material_id column but, before
-- this migration, was only indexed by (empresa_id, custodia_id, data)
-- (custody-operation-scoped history, e.g. CustodyHistoryDialog) - no direct
-- (empresa_id, material_id, data) path existed for "every custody event for
-- this material, newest first", which the timeline above genuinely needs.
-- The join-through-material_custodias path (already indexed by material_id)
-- would work but forces a two-hop lookup for a query this feature makes on
-- every detail view; this index turns it into a single index scan.
-- ============================================================================
CREATE INDEX material_custodia_eventos_material_date_idx
  ON public.material_custodia_eventos (empresa_id, material_id, data_efetiva DESC, id DESC);

-- ============================================================================
-- Grants - resolve_material_traceability_company and resumo_situacao_material
-- are internal helpers only (called by the two RPCs below, which already run
-- as their SECURITY DEFINER owner and therefore need no separate grant to
-- call them); they are not meant to be invoked directly over the API.
-- ============================================================================
REVOKE ALL ON FUNCTION public.resolve_material_traceability_company(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resumo_situacao_material(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.buscar_rastreabilidade_materiais(text, integer, integer, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obter_rastreabilidade_material(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_rastreabilidade_materiais(text, integer, integer, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_rastreabilidade_material(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.resolve_material_traceability_company(uuid) IS
  'Resolves and authorizes the caller''s company for read-only materials traceability (user_has_module_action gestao_materiais/view). Internal helper, not exposed to authenticated directly.';
COMMENT ON FUNCTION public.resumo_situacao_material(uuid, uuid) IS
  'Derives current situation (disponivel/locado/emprestado/em_manutencao/manual status) for one material from custody, maintenance, and stock state. Internal helper shared by search and detail RPCs.';
COMMENT ON FUNCTION public.buscar_rastreabilidade_materiais(text, integer, integer, uuid) IS
  'Paginated materials traceability search by name/codigo/patrimonio/serie/barcode/QR/EPC, each row carrying a lightweight current-situation summary.';
COMMENT ON FUNCTION public.obter_rastreabilidade_material(uuid, uuid) IS
  'Full traceability aggregation for one material: identity, current situation, RFID tag history (when entitled), and a merged chronological timeline from custody/maintenance/stock/RFID, each section gated by its own module entitlement.';
