-- Backstage Pro - Exibe o Evento vinculado a uma custódia
-- (material_custodias.referencia_tipo='evento') nos dois pontos de leitura
-- read-only que já existem para o vínculo irmão de locação
-- (referencia_tipo='locacao_item'): resumo_situacao_material (usado pelo
-- bloco "Onde está agora?" da Rastreabilidade) e obter_rastreabilidade_material
-- (timeline completa do material). Mesma forma que o enriquecimento de
-- locação já usa - um jsonb 'evento'/campos 'evento_nome'/'evento_data' -,
-- sem tabela nova, sem gate de módulo (events é dado central, sem
-- feature_key própria, igual já documentado em
-- 20260730043000_enforce_backend_entitlements.sql).
--
-- Não altera nenhuma RPC de escrita (registrar_checkout_material já grava
-- referencia_tipo/referencia_id desde 20260821090000_checkout_event_reference.sql)
-- nem nenhuma RPC de check-in, scanner remoto, locação, manutenção ou RFID -
-- só as duas funções de leitura agregada acima.

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
  v_evento jsonb;
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

    -- Mesmo formato de v_rental acima, para o par referencia_tipo='evento'
    -- introduzido em 20260821090000_checkout_event_reference.sql. Sem gate
    -- de módulo: events é dado central, não um add-on comercial.
    v_evento := NULL;
    IF v_custody.referencia_tipo = 'evento' THEN
      SELECT jsonb_build_object(
        'evento_id', event_row.id,
        'evento_nome', event_row.name,
        'evento_data', event_row.date
      )
      INTO v_evento
      FROM public.events AS event_row
      WHERE event_row.empresa_id = _empresa_id AND event_row.id = v_custody.referencia_id;
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
      'locacao', v_rental,
      'evento', v_evento
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
        'cliente_nome', COALESCE(nullif(btrim(customer.nome_fantasia), ''), customer.nome),
        'evento_nome', evento_row.name,
        'evento_data', evento_row.date
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
    LEFT JOIN public.events AS evento_row
      ON custody.referencia_tipo = 'evento'
      AND evento_row.empresa_id = event.empresa_id AND evento_row.id = custody.referencia_id
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
