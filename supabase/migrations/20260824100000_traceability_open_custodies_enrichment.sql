-- resumo_situacao_material passa a expor, além do resumo de "situação
-- atual" que já existia (baseado só na custódia aberta mais recente):
--
--   * custodias_abertas: TODAS as custódias abertas do material (não só a
--     mais recente) - materiais controlados por quantidade podem ter várias
--     retiradas simultâneas (mesmo cenário que resolveCheckinOrigin/
--     EventCustodyPanel já tratam no client), e isso hoje fica invisível na
--     Rastreabilidade. Cada item traz quantidade retirada/devolvida/
--     pendente, finalidade, referencia_tipo/referencia_id crus, responsável
--     físico, liberado por, retirada_em, previsão de retorno, localização
--     de origem, condição de saída, e - reaproveitando exatamente o mesmo
--     enriquecimento que o bloco de "situação atual" já usa desde
--     20260822090000_traceability_event_reference.sql - nome/data do Evento
--     (referencia_tipo='evento') ou identificação da Locação + nome do
--     Cliente (referencia_tipo='locacao_item', sob o mesmo gate de módulo
--     locacao_materiais que o bloco único já respeita).
--   * quantidade_total/quantidade_disponivel/quantidade_fora: distribuição
--     atual do material (materiais.quantidade, soma de estoque_saldos nas
--     localizações ativas, soma de quantidade_pendente das custódias
--     abertas - mesma definição de "disponível" que
--     getCustodyMaterialActions já usa no client, só espelhada aqui).
--
-- Assinatura de resumo_situacao_material (_material_id uuid, _empresa_id
-- uuid) não muda - só o corpo/retorno -, então CREATE OR REPLACE simples
-- basta, sem DROP FUNCTION. obter_rastreabilidade_material não precisa ser
-- tocada: ela só embute o retorno inteiro de resumo_situacao_material sob a
-- chave 'resumo' (linha 'resumo', public.resumo_situacao_material(...)),
-- então os campos novos já chegam lá de graça.
--
-- Nenhuma tabela nova, nenhuma RPC nova, nenhuma mudança em check-in/
-- check-out, scanner remoto, RFID ou UI - só esta função de leitura
-- agregada, reaproveitando material_custodias/material_custodia_eventos
-- (já lida por obter_rastreabilidade_material para a timeline, não tocada
-- aqui)/estoque_saldos/events/material_locacao_itens/material_locacoes/
-- clientes, todas já existentes.

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
  v_custodias_abertas jsonb;
  v_quantidade_disponivel bigint;
  v_quantidade_fora bigint;
BEGIN
  SELECT status_operacional, justificativa_status, quantidade
  INTO v_material
  FROM public.materiais
  WHERE id = _material_id AND empresa_id = _empresa_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Reaproveitado em todo caminho de retorno abaixo, qualquer que seja a
  -- "situação" (em_manutencao/locado/emprestado/indisponível/disponível) -
  -- diferente de v_custody mais adiante, que continua resolvendo só para a
  -- mais recente (a "situação atual" já existente, inalterada).
  v_can_rental := public.company_has_active_module(_empresa_id, 'locacao_materiais')
    AND public.company_has_active_module(_empresa_id, 'gestao_materiais')
    AND public.company_has_active_module(_empresa_id, 'controle_estoque')
    AND public.company_has_active_module(_empresa_id, 'checkin_checkout');

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'custodia_id', custody.id,
      'status', custody.status,
      'finalidade', custody.finalidade,
      'referencia_tipo', custody.referencia_tipo,
      'referencia_id', custody.referencia_id,
      'quantidade_retirada', custody.quantidade_retirada,
      'quantidade_devolvida', custody.quantidade_devolvida,
      'quantidade_pendente', custody.quantidade_pendente,
      'retirado_por', custody.responsavel_nome,
      'liberado_por', COALESCE(actor.full_name, 'Usuário'),
      'retirada_em', custody.retirada_em,
      'previsao_retorno', custody.previsao_retorno,
      'localizacao_origem_id', origin.id,
      'localizacao_origem_nome', origin.nome,
      'condicao_saida', custody.condicao_saida,
      'evento', CASE WHEN custody.referencia_tipo = 'evento' THEN jsonb_build_object(
        'evento_id', evento_row.id,
        'evento_nome', evento_row.name,
        'evento_data', evento_row.date
      ) END,
      'locacao', CASE WHEN v_can_rental AND custody.referencia_tipo = 'locacao_item' THEN jsonb_build_object(
        'locacao_id', rental.id,
        'locacao_numero', rental.numero,
        'cliente_id', customer.id,
        'cliente_nome', COALESCE(nullif(btrim(customer.nome_fantasia), ''), customer.nome)
      ) END
    ) ORDER BY custody.retirada_em ASC), '[]'::jsonb),
    COALESCE(SUM(custody.quantidade_pendente), 0)
  INTO v_custodias_abertas, v_quantidade_fora
  FROM public.material_custodias AS custody
  LEFT JOIN public.profiles AS actor ON actor.user_id = custody.executado_por
  LEFT JOIN public.estoque_localizacoes AS origin
    ON origin.empresa_id = custody.empresa_id AND origin.id = custody.localizacao_origem_id
  LEFT JOIN public.material_locacao_itens AS item
    ON v_can_rental AND custody.referencia_tipo = 'locacao_item'
    AND item.empresa_id = custody.empresa_id AND item.id = custody.referencia_id
  LEFT JOIN public.material_locacoes AS rental
    ON rental.empresa_id = item.empresa_id AND rental.id = item.locacao_id
  LEFT JOIN public.clientes AS customer
    ON customer.empresa_id = rental.empresa_id AND customer.id = rental.cliente_id
  LEFT JOIN public.events AS evento_row
    ON custody.referencia_tipo = 'evento'
    AND evento_row.empresa_id = custody.empresa_id AND evento_row.id = custody.referencia_id
  WHERE custody.empresa_id = _empresa_id AND custody.material_id = _material_id
    AND custody.status IN ('aberta', 'parcial');

  -- Mesma definição de "disponível" que getCustodyMaterialActions já usa no
  -- client (checkin-checkout-domain.ts): só saldo em localização ativa
  -- conta - saldo preso numa localização inativa não é oferecido para
  -- checkout, então não é "disponível" de verdade.
  SELECT COALESCE(SUM(balance.quantidade), 0)
  INTO v_quantidade_disponivel
  FROM public.estoque_saldos AS balance
  JOIN public.estoque_localizacoes AS location
    ON location.empresa_id = balance.empresa_id AND location.id = balance.localizacao_id
  WHERE balance.empresa_id = _empresa_id AND balance.material_id = _material_id
    AND location.ativa;

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
      'manutencao_responsavel_nome', v_maintenance.responsavel_nome,
      'custodias_abertas', v_custodias_abertas,
      'quantidade_total', v_material.quantidade,
      'quantidade_disponivel', v_quantidade_disponivel,
      'quantidade_fora', v_quantidade_fora
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
      'evento', v_evento,
      'custodias_abertas', v_custodias_abertas,
      'quantidade_total', v_material.quantidade,
      'quantidade_disponivel', v_quantidade_disponivel,
      'quantidade_fora', v_quantidade_fora
    );
  END IF;

  IF v_material.status_operacional <> 'disponivel' THEN
    RETURN jsonb_build_object(
      'situacao', v_material.status_operacional::text,
      'justificativa_status', v_material.justificativa_status,
      'custodias_abertas', v_custodias_abertas,
      'quantidade_total', v_material.quantidade,
      'quantidade_disponivel', v_quantidade_disponivel,
      'quantidade_fora', v_quantidade_fora
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
    'ultimo_retorno_recebido_por', v_last_return_by,
    'custodias_abertas', v_custodias_abertas,
    'quantidade_total', v_material.quantidade,
    'quantidade_disponivel', v_quantidade_disponivel,
    'quantidade_fora', v_quantidade_fora
  );
END;
$$;
