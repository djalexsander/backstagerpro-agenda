-- Backstage Pro - Scanner Remoto: a retirada/devolução de Locação usada pela
-- confirmação da sessão automática passa a aceitar o 'usuario' comum com o
-- grant granular do módulo Locação (não só admin_empresa/master_admin).
--
-- Etapa E5.1. Na E5 a confirmação da sessão automática executa a movimentação
-- delegando para registrar_retirada_locacao_material (finalidade "Cliente") e
-- registrar_devolucao_locacao_material (check-in de custódia de locação). As
-- duas resolvem a empresa por resolve_material_rental_company(_, true), cujo
-- ramo de escrita exige can_write_company_module('locacao_materiais') ->
-- can_write_company_data -> has_role('admin_empresa') OU is_master_admin
-- (20260808100000). Resultado hoje: um 'usuario' comum - mesmo com
-- checkin_checkout create/edit concedidos e podendo fazer check-in/out normal
-- e evento pelo Scanner Remoto (20260819100000 afrouxou resolve_custody_company
-- para grants granulares) - bate em 42501 nessas duas rotas; a E5 registra
-- isso como leitura acao_executada='erro'.
--
-- ============================================================================
-- ESCOPO - o que muda e o que NÃO muda
-- ============================================================================
--
-- Muda SOMENTE as duas RPCs que a E5 usa:
--   registrar_retirada_locacao_material   -> exige locacao_materiais 'create'
--   registrar_devolucao_locacao_material  -> exige locacao_materiais 'edit'
-- (mesmo par que as delegadas já exigem em checkin_checkout: retirada ->
-- registrar_checkout_material -> 'create'; devolução ->
-- registrar_checkin_material -> 'edit', 20260819100000.)
--
-- NÃO muda resolve_material_rental_company: afrouxá-la globalmente exporia as
-- ~13 outras RPCs de escrita de Locação (criar/atualizar rascunho/itens/
-- reserva/pronta-retirada/conclusão/cancelamento/cliente/financeiro) a um
-- 'usuario' com QUALQUER grant de Locação, e um grant de uma ação
-- desbloquearia as demais. Por isso o gate granular é aplicado inline só
-- nas duas RPCs em escopo: resolve_material_rental_company passa a ser
-- chamada em modo LEITURA (mantém toda a checagem de autenticação, tenant,
-- módulo ativo e as 3 dependências) e o gate de ESCRITA é reaplicado logo
-- em seguida - agora com o caminho granular, exatamente como
-- resolve_custody_company faz para checkin_checkout. As demais RPCs de
-- Locação continuam idênticas, admin-only, via resolve_material_rental_company(_, true).
--
-- Ordem/mensagens do gate reproduzem o que resolve_material_rental_company(_, true)
-- já fazia: LR010 ("modo somente leitura") antes de 42501 ("sem permissão").
-- company_has_operational_access também já é coberto por dentro de
-- can_write_company_module e user_has_module_action (nenhum deles concede
-- escrita numa empresa em somente-leitura); a checagem explícita é só para
-- preservar o código/mensagem LR010 amigável.
--
-- Assinaturas idênticas (mesmos 11/10 parâmetros, ordem, tipos, defaults) ->
-- CREATE OR REPLACE preserva os GRANTs de
-- 20260802200000_material_rentals_stage_four.sql (REVOKE ALL FROM PUBLIC,
-- anon, service_role; GRANT EXECUTE TO authenticated) sem reemitir, mesmo
-- padrão de 20260806090000 (que também redefine confirmar_reserva/cancelar
-- sem tocar em grants). Corpo copiado 1:1 de 20260802200000; a ÚNICA
-- diferença é o bloco de resolução/permissão no topo de cada função.

-- ============================================================================
-- 1. registrar_retirada_locacao_material - locacao_materiais 'create'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_retirada_locacao_material(
  _locacao_id uuid,
  _item_id uuid,
  _quantidade integer,
  _localizacao_origem_id uuid,
  _responsavel_tipo text,
  _responsavel_id uuid,
  _condicao_saida text,
  _client_uuid uuid,
  _data_efetiva timestamptz DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_custodias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_totals record;
  v_custody public.material_custodias%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
BEGIN
  -- E5.1: resolve em modo leitura (tenant/módulo/dependências) e reaplica o
  -- gate de escrita aceitando o grant granular de Locação. admin_empresa/
  -- master passam por can_write_company_module, como antes.
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  IF NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF NOT (
    public.can_write_company_module(v_company_id, 'locacao_materiais')
    OR public.user_has_module_action(v_company_id, 'locacao_materiais', 'create')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;

  IF _client_uuid IS NULL OR COALESCE(_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Quantidade e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'item', _item_id, 'quantidade', _quantidade,
    'origem', _localizacao_origem_id, 'responsavel_tipo', _responsavel_tipo,
    'responsavel', _responsavel_id, 'condicao', _condicao_saida,
    'data', _data_efetiva, 'observacao', nullif(btrim(_observacao), '')
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.item_id <> _item_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_custody FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = v_existing_event.custodia_id;
    RETURN v_custody;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status NOT IN ('reservada', 'pronta_retirada', 'em_andamento', 'parcialmente_devolvida') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não permite retirada neste estado.';
  END IF;
  SELECT * INTO v_item FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND locacao_id = _locacao_id AND id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Item não encontrado na locação.'; END IF;
  SELECT * INTO v_totals FROM public.material_rental_item_operational_totals(_item_id);
  IF _quantidade > v_item.quantidade_contratada - v_totals.retirada THEN
    RAISE EXCEPTION USING ERRCODE = 'LR015', MESSAGE = 'A retirada supera a quantidade contratada ainda não entregue.';
  END IF;

  v_custody := public.registrar_checkout_material(
    v_item.material_id, _quantidade, _localizacao_origem_id,
    _responsavel_tipo, _responsavel_id, 'locacao', _condicao_saida,
    _client_uuid, v_rental.devolucao_prevista_em, _observacao,
    'locacao_item', v_item.id, _data_efetiva, v_company_id
  );
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, item_id, custodia_id, tipo, descricao,
    executado_por, data_efetiva, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, _item_id, v_custody.id, 'retirada',
    'Retirada física vinculada à custódia', auth.uid(), v_custody.retirada_em,
    _client_uuid, v_hash,
    jsonb_build_object('quantidade', _quantidade, 'material_id', v_item.material_id, 'custodia_id', v_custody.id)
  );
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'em_andamento', iniciada_em = COALESCE(iniciada_em, v_custody.retirada_em),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_retirada', 'Retirada de locação registrada via custódia',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'item_id', _item_id, 'custodia_id', v_custody.id, 'quantidade', _quantidade));
  RETURN v_custody;
END;
$$;

-- ============================================================================
-- 2. registrar_devolucao_locacao_material - locacao_materiais 'edit'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_devolucao_locacao_material(
  _locacao_id uuid,
  _custodia_id uuid,
  _quantidade integer,
  _localizacao_destino_id uuid,
  _condicao_retorno text,
  _client_uuid uuid,
  _observacao text DEFAULT NULL,
  _ocorrencia text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_custodias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
  v_pending bigint;
  v_returned bigint;
  v_all_delivered boolean;
  v_new_status public.material_rental_status;
BEGIN
  -- E5.1: mesma resolução em modo leitura + gate de escrita granular. Aqui a
  -- ação é 'edit' (operar/fechar uma locação existente), espelhando
  -- registrar_checkin_material -> checkin_checkout 'edit'.
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  IF NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF NOT (
    public.can_write_company_module(v_company_id, 'locacao_materiais')
    OR public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;

  IF _client_uuid IS NULL OR COALESCE(_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Quantidade e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'custodia', _custodia_id, 'quantidade', _quantidade,
    'destino', _localizacao_destino_id, 'condicao', _condicao_retorno,
    'observacao', nullif(btrim(_observacao), ''),
    'ocorrencia', nullif(btrim(_ocorrencia), ''), 'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.custodia_id <> _custodia_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = _custodia_id;
    RETURN v_result;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND OR v_rental.status NOT IN ('em_andamento', 'parcialmente_devolvida') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não permite devolução neste estado.';
  END IF;
  SELECT * INTO v_custody FROM public.material_custodias
  WHERE empresa_id = v_company_id AND id = _custodia_id
    AND referencia_tipo = 'locacao_item' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Custódia da locação não encontrada.'; END IF;
  SELECT * INTO v_item FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND id = v_custody.referencia_id AND locacao_id = _locacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Custódia não pertence à locação informada.'; END IF;

  v_result := public.registrar_checkin_material(
    _custodia_id, _quantidade, _localizacao_destino_id, _condicao_retorno,
    _client_uuid, _observacao, _ocorrencia, _data_efetiva, v_company_id
  );
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, item_id, custodia_id, tipo, descricao,
    executado_por, data_efetiva, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, v_item.id, _custodia_id, 'devolucao',
    CASE WHEN v_result.status = 'concluida' THEN 'Devolução total da custódia' ELSE 'Devolução parcial da custódia' END,
    auth.uid(), COALESCE(_data_efetiva, clock_timestamp()), _client_uuid, v_hash,
    jsonb_build_object('quantidade', _quantidade, 'condicao', _condicao_retorno, 'ocorrencia', nullif(btrim(_ocorrencia), ''))
  );

  SELECT COALESCE(sum(operational.com_cliente), 0),
         COALESCE(sum(operational.devolvida), 0),
         COALESCE(bool_and(operational.retirada >= item.quantidade_contratada), false)
  INTO v_pending, v_returned, v_all_delivered
  FROM public.material_locacao_itens AS item
  CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
  WHERE item.empresa_id = v_company_id AND item.locacao_id = _locacao_id;

  IF v_pending = 0 AND v_all_delivered THEN
    v_new_status := 'concluida';
  ELSIF v_pending > 0 AND v_returned > 0 THEN
    v_new_status := 'parcialmente_devolvida';
  ELSE
    v_new_status := 'em_andamento';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = v_new_status,
      encerrada_em = CASE WHEN v_new_status = 'concluida' THEN COALESCE(_data_efetiva, clock_timestamp()) ELSE NULL END,
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id;
  IF v_new_status = 'concluida' THEN
    INSERT INTO public.material_locacao_eventos (
      empresa_id, locacao_id, tipo, descricao, executado_por,
      client_uuid, payload_hash, dados
    ) VALUES (
      v_company_id, _locacao_id, 'conclusao', 'Locação concluída após devolução integral',
      auth.uid(), gen_random_uuid(), v_hash, jsonb_build_object('devolvida_total', v_returned)
    );
  END IF;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_devolucao', 'Devolução de locação registrada via custódia',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'custodia_id', _custodia_id, 'quantidade', _quantidade, 'status', v_new_status));
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.registrar_retirada_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, uuid) IS
  'Retirada física de item de locação (delega para registrar_checkout_material). Permissão: admin_empresa/master OU usuario com grant granular locacao_materiais.create (+ checkin_checkout.create, exigido pela delegada). E5.1.';
COMMENT ON FUNCTION public.registrar_devolucao_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid) IS
  'Devolução física de custódia de locação (delega para registrar_checkin_material). Permissão: admin_empresa/master OU usuario com grant granular locacao_materiais.edit (+ checkin_checkout.edit, exigido pela delegada). E5.1.';
