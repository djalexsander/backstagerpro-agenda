-- BUG: a devolução física de material vinculado a uma locação (custódia com
-- referencia_tipo = 'locacao_item') só recalculava o status da locação
-- (material_locacoes.status) quando o check-in era feito pelo fluxo próprio
-- de Locações (registrar_devolucao_locacao_material, aba "Receber materiais"
-- do detalhe da locação). Se o mesmo check-in fosse feito pela tela genérica
-- de Check-in/Check-out (registrar_checkin_material chamada diretamente por
-- checkin-checkout-service.ts::registerCheckin), a quantidade física em
-- material_custodias era atualizada corretamente (fonte única de verdade
-- para quantidade_retirada/devolvida/com_cliente, via
-- material_rental_item_operational_totals), mas o status da locação nunca
-- era resincronizado - podia ficar preso em 'em_andamento' mesmo após a
-- devolução física estar 100% completa, ou, inversamente, permitir que o
-- botão "Concluir" (concluir_locacao_material) ficasse disponível e fosse
-- acionado manualmente sem que o operador tivesse passado pelo fluxo nativo
-- de devolução da locação - dois caminhos para o mesmo dado, um deles sem a
-- sincronização de status.
--
-- Extrai a lógica de transição de status (já usada em
-- registrar_devolucao_locacao_material) para uma função compartilhada e
-- idempotente, e passa a chamá-la também a partir de
-- registrar_checkin_material sempre que a custódia pertencer a um item de
-- locação - assim o status da locação fica correto não importa qual tela
-- foi usada para o check-in físico.
--
-- registrar_devolucao_locacao_material e concluir_locacao_material NÃO são
-- alterados nesta migration - continuam exatamente como estavam.

CREATE OR REPLACE FUNCTION public.sync_material_rental_status(
  _company_id uuid,
  _locacao_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rental public.material_locacoes%ROWTYPE;
  v_pending bigint;
  v_returned bigint;
  v_all_delivered boolean;
  v_new_status public.material_rental_status;
BEGIN
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = _company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Só recalcula a partir de estados operacionais abertos. Uma locação
  -- cancelada, ainda em rascunho/reserva, ou já concluída não deve ser
  -- tocada por uma sincronização defensiva vinda do check-in genérico.
  IF v_rental.status NOT IN ('em_andamento', 'parcialmente_devolvida') THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(operational.com_cliente), 0),
         COALESCE(sum(operational.devolvida), 0),
         COALESCE(bool_and(operational.retirada >= item.quantidade_contratada), false)
  INTO v_pending, v_returned, v_all_delivered
  FROM public.material_locacao_itens AS item
  CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
  WHERE item.empresa_id = _company_id AND item.locacao_id = _locacao_id;

  IF v_pending = 0 AND v_all_delivered THEN
    v_new_status := 'concluida';
  ELSIF v_pending > 0 AND v_returned > 0 THEN
    v_new_status := 'parcialmente_devolvida';
  ELSE
    v_new_status := 'em_andamento';
  END IF;

  IF v_new_status = v_rental.status THEN
    RETURN;
  END IF;

  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = v_new_status,
      encerrada_em = CASE WHEN v_new_status = 'concluida' THEN clock_timestamp() ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE empresa_id = _company_id AND id = _locacao_id;

  IF v_new_status = 'concluida' THEN
    INSERT INTO public.material_locacao_eventos (
      empresa_id, locacao_id, tipo, descricao, executado_por,
      client_uuid, payload_hash, dados
    ) VALUES (
      _company_id, _locacao_id, 'conclusao', 'Locação concluída após devolução integral',
      auth.uid(), gen_random_uuid(),
      encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
      jsonb_build_object('devolvida_total', v_returned)
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_checkin_material(_custodia_id uuid, _quantidade integer, _localizacao_destino_id uuid, _condicao_retorno text, _client_uuid uuid, _observacao text DEFAULT NULL::text, _ocorrencia text DEFAULT NULL::text, _data_efetiva timestamp with time zone DEFAULT NULL::timestamp with time zone, _empresa_id uuid DEFAULT NULL::uuid)
 RETURNS material_custodias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_existing_event public.material_custodia_eventos%ROWTYPE;
  v_movement public.estoque_movimentacoes%ROWTYPE;
  v_condition public.material_custody_condition;
  v_hash text;
  v_stock_hash text;
  v_pending integer;
  v_new_returned integer;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
  v_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF _custodia_id IS NULL OR _localizacao_destino_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Operação, localização de retorno e identificador são obrigatórios.';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Informe uma quantidade devolvida maior que zero.';
  END IF;
  BEGIN
    v_condition := _condicao_retorno::public.material_custody_condition;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Condição de retorno inválida.';
  END;
  IF v_condition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Informe a condição de retorno.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', _custodia_id,
    'quantidade', _quantidade,
    'destino', _localizacao_destino_id,
    'condicao', v_condition,
    'observacao', nullif(btrim(_observacao), ''),
    'ocorrencia', nullif(btrim(_ocorrencia), ''),
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing_event
  FROM public.material_custodia_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash
       OR v_existing_event.tipo <> 'checkin' THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    SELECT * INTO v_result
    FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = v_existing_event.custodia_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_custody
  FROM public.material_custodias
  WHERE empresa_id = v_company_id AND id = _custodia_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005',
      MESSAGE = 'Operação de custódia não encontrada.';
  END IF;
  IF v_custody.status NOT IN ('aberta', 'parcial') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI014',
      MESSAGE = 'Esta operação não possui quantidade pendente para retorno.';
  END IF;
  v_pending := v_custody.quantidade_retirada - v_custody.quantidade_devolvida;
  IF _quantidade > v_pending THEN
    RAISE EXCEPTION USING ERRCODE = 'CI001',
      MESSAGE = 'A quantidade devolvida supera a quantidade ainda em custódia.';
  END IF;
  IF v_custody.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI002',
      MESSAGE = 'Material individual deve retornar com quantidade um.';
  END IF;

  v_stock_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', v_custody.id,
    'material', v_custody.material_id,
    'quantidade', _quantidade,
    'destino', _localizacao_destino_id,
    'data', _data_efetiva,
    'operacao', 'checkin'
  )::text, 'UTF8')), 'hex');
  v_movement := public.apply_stock_movement(
    v_company_id, v_custody.material_id, 'entrada', _quantidade,
    NULL, _localizacao_destino_id,
    'Check-in de material', NULL, _observacao, NULL,
    _data_efetiva, 'checkin_checkout', v_custody.id,
    _client_uuid, v_stock_hash, NULL
  );

  v_new_returned := v_custody.quantidade_devolvida + _quantidade;
  PERFORM set_config('backstage.custody_projection_write', 'on', true);
  UPDATE public.material_custodias
  SET quantidade_devolvida = v_new_returned,
      status = CASE
        WHEN v_new_returned = quantidade_retirada
          THEN 'concluida'::public.material_custody_status
        ELSE 'parcial'::public.material_custody_status
      END,
      encerrada_em = CASE
        WHEN v_new_returned = quantidade_retirada THEN v_effective_at
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = v_custody.id
  RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write', 'off', true);

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade,
    localizacao_destino_id, condicao, ocorrencia, observacao,
    data_efetiva, executado_por, movimento_estoque_id,
    client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_custody.id, v_custody.material_id, 'checkin', _quantidade,
    _localizacao_destino_id, v_condition, nullif(btrim(_ocorrencia), ''),
    nullif(btrim(_observacao), ''), v_effective_at, auth.uid(), v_movement.id,
    _client_uuid, v_hash
  );

  INSERT INTO public.system_logs (
    tipo, acao, descricao, user_id, empresa_id, dados
  ) VALUES (
    'custodia',
    CASE WHEN v_result.status = 'concluida'
      THEN 'material_checkin_total' ELSE 'material_checkin_parcial' END,
    CASE WHEN v_result.status = 'concluida'
      THEN 'Retorno total de material registrado'
      ELSE 'Retorno parcial de material registrado' END,
    auth.uid(), v_company_id,
    jsonb_build_object(
      'custodia_id', v_result.id,
      'material_id', v_result.material_id,
      'quantidade', _quantidade,
      'condicao', v_condition,
      'ocorrencia', nullif(btrim(_ocorrencia), ''),
      'movimento_estoque_id', v_movement.id
    )
  );

  -- Fecha o gap: mantém material_locacoes.status correto mesmo quando o
  -- check-in físico é feito pela tela genérica de Check-in/Check-out em vez
  -- da aba "Receber materiais" da própria locação.
  IF v_result.referencia_tipo = 'locacao_item' THEN
    SELECT locacao_id INTO v_rental_id
    FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND id = v_result.referencia_id;
    IF v_rental_id IS NOT NULL THEN
      PERFORM public.sync_material_rental_status(v_company_id, v_rental_id);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;
