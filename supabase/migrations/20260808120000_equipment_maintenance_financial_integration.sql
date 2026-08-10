-- ============================================================================
-- INTEGRAÇÃO MANUTENÇÃO × FINANCEIRO (categoria "Manutenções")
-- ============================================================================
--
-- Reaproveita o razão financeiro criado por
-- 20260806090000_material_rental_financial_integration.sql
-- (financeiro_lancamentos, com financeiro_parcelas/financeiro_recebimentos
-- disponíveis mas não usados aqui) em vez de criar uma tabela paralela ou
-- uma coluna "categoria" nova - o mesmo mecanismo de categorização por
-- origem já usado por 'locacao_material' é reaproveitado com
-- origem_tipo = 'manutencao_equipamento'.
--
-- Diferença de desenho em relação a Locações: manutenção não tem cliente
-- nem cobrança - é custo interno (mão de obra + peças/insumos + outros,
-- já somado por manutencao_ordens.custo_total, coluna gerada na Etapa 5)
-- já incorrido no momento da conclusão, não uma obrigação a cobrar depois.
-- Por isso o lançamento nasce como 'despesa' já liquidada
-- (valor_recebido = valor_original, status 'recebido' via
-- financeiro_status_from_valores) e sem parcelas/recebimentos - "recebido"
-- aqui reaproveita o mesmo enum de status de Locações (nenhum status novo
-- é criado) no sentido de "contabilizado".
--
-- Ponto único de sincronização: transicionar_ordem_manutencao, exatamente
-- quando a ordem entra em 'concluida' - estado terminal, nunca reaberto
-- (equipment_maintenance_transition_allowed não permite saída de
-- 'concluida'). Ordens canceladas nunca chegam a gerar lançamento, porque
-- 'cancelada' é o outro único estado terminal e os dois são mutuamente
-- exclusivos. Ordens concluídas sem nenhum custo lançado (custo_total = 0)
-- também não geram lançamento - não há obrigação real para registrar.
--
-- Idempotência: mesma UNIQUE (empresa_id, origem_tipo, origem_id) de
-- financeiro_lancamentos_origem_unica (20260806090000) - reexecutar a
-- sincronização (ou o backfill) para a mesma ordem nunca duplica. A própria
-- transição para 'concluida' também só acontece uma vez por ordem (estado
-- terminal), então a duplicação por reexecução do fluxo normal nem chega a
-- ser possível - a checagem estrutural é defesa em profundidade, mesmo
-- padrão do sync de Locações.
--
-- Best-effort: se financeiro_avancado não estiver ativo para a empresa, a
-- sincronização apenas retorna sem lançar erro - concluir uma manutenção
-- NUNCA pode falhar por causa do Financeiro, mesmo padrão de
-- sync_material_rental_financial_entry.
--
-- Nenhuma migration já aplicada é alterada. Nenhuma tabela nova é criada.

-- ----------------------------------------------------------------------------
-- 1. SINCRONIZAÇÃO MANUTENÇÃO -> LANÇAMENTO (interna, best-effort, idempotente)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_equipment_maintenance_financial_entry(
  _company_id uuid,
  _ordem_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.manutencao_ordens%ROWTYPE;
  v_existing public.financeiro_lancamentos%ROWTYPE;
BEGIN
  IF NOT public.company_has_active_module(_company_id, 'financeiro_avancado') THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.manutencao_ordens
  WHERE empresa_id = _company_id AND id = _ordem_id;
  IF NOT FOUND OR v_order.status <> 'concluida' OR v_order.custo_total <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.financeiro_lancamentos
  WHERE empresa_id = _company_id
    AND origem_tipo = 'manutencao_equipamento'
    AND origem_id = _ordem_id
  FOR UPDATE;
  IF FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.financeiro_lancamentos (
    empresa_id, origem_tipo, origem_id, cliente_id, tipo,
    descricao, forma_cobranca, valor_original, valor_recebido, vencimento, status,
    created_by, updated_by
  ) VALUES (
    _company_id, 'manutencao_equipamento', _ordem_id, NULL, 'despesa',
    'Manutenção ' || v_order.numero, 'avista', v_order.custo_total, v_order.custo_total, NULL,
    public.financeiro_status_from_valores(false, v_order.custo_total, v_order.custo_total, 0),
    auth.uid(), auth.uid()
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. PONTO DE INTEGRAÇÃO: transicionar_ordem_manutencao ganha uma única
--    chamada nova, aditiva, logo antes do RETURN final. Corpo idêntico ao de
--    20260802230000 (não é migration aplicada alterada - CREATE OR REPLACE
--    em migration nova) em todo o resto; nenhum parâmetro, RAISE, lock ou
--    coluna atualizada muda.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transicionar_ordem_manutencao(
  _ordem_id uuid,
  _novo_status text,
  _client_uuid uuid,
  _expected_updated_at timestamptz,
  _justificativa text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.manutencao_ordens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_order public.manutencao_ordens%ROWTYPE;
  v_result public.manutencao_ordens%ROWTYPE;
  v_existing public.manutencao_ordem_eventos%ROWTYPE;
  v_status public.equipment_maintenance_status;
  v_event_type public.equipment_maintenance_event_type := 'mudanca_status'::public.equipment_maintenance_event_type;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
  v_hash text;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, true);
  IF _ordem_id IS NULL OR _client_uuid IS NULL OR _expected_updated_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Ordem, versão e identificador são obrigatórios.';
  END IF;
  BEGIN v_status := _novo_status::public.equipment_maintenance_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Status de manutenção inválido.';
  END;
  IF v_status IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Informe o novo status.'; END IF;
  IF v_status = 'cancelada' AND nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Informe a justificativa do cancelamento.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('ordem', _ordem_id, 'status', v_status,
    'justificativa', nullif(btrim(_justificativa), ''), 'data', _data_efetiva)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':maintenance-client:' || _client_uuid::text, 0));
  SELECT * INTO v_existing FROM public.manutencao_ordem_eventos WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash OR v_existing.ordem_id <> _ordem_id THEN
      RAISE EXCEPTION USING ERRCODE = 'MT013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.manutencao_ordens WHERE empresa_id = v_company_id AND id = _ordem_id;
    RETURN v_result;
  END IF;
  SELECT * INTO v_order FROM public.manutencao_ordens
  WHERE empresa_id = v_company_id AND id = _ordem_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Ordem de manutenção não encontrada.'; END IF;
  IF v_order.updated_at <> _expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'MT015', MESSAGE = 'A ordem foi alterada por outra sessão. Recarregue os dados.';
  END IF;
  IF NOT public.equipment_maintenance_transition_allowed(v_order.status, v_status) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT014', MESSAGE = 'Transição de status não permitida.';
  END IF;
  IF v_status = 'concluida' AND (
    nullif(btrim(v_order.diagnostico), '') IS NULL
    OR nullif(btrim(v_order.servico_executado), '') IS NULL
    OR nullif(btrim(v_order.condicao_saida), '') IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT016', MESSAGE = 'Diagnóstico, serviço executado e condição de saída são obrigatórios para concluir.';
  END IF;
  -- Serialize release against a simultaneous reservation or checkout.
  IF v_status IN ('concluida', 'cancelada') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-material:' || v_order.material_id::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':operational-material:' || v_order.material_id::text, 0));
  END IF;
  IF v_status = 'em_manutencao' AND v_order.iniciada_em IS NULL THEN v_event_type := 'inicio'::public.equipment_maintenance_event_type; END IF;
  IF v_status = 'concluida' THEN v_event_type := 'conclusao'::public.equipment_maintenance_event_type; END IF;
  IF v_status = 'cancelada' THEN v_event_type := 'cancelamento'::public.equipment_maintenance_event_type; END IF;
  PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
  UPDATE public.manutencao_ordens SET
    status = v_status,
    iniciada_em = CASE WHEN v_status IN ('em_manutencao', 'concluida') THEN COALESCE(iniciada_em, v_effective_at) ELSE iniciada_em END,
    concluida_em = CASE WHEN v_status = 'concluida' THEN v_effective_at ELSE NULL END,
    cancelada_em = CASE WHEN v_status = 'cancelada' THEN v_effective_at ELSE NULL END,
    proxima_preventiva_em = CASE
      WHEN v_status = 'concluida' AND intervalo_preventivo_dias IS NOT NULL
        THEN (v_effective_at AT TIME ZONE 'America/Sao_Paulo')::date + intervalo_preventivo_dias
      ELSE proxima_preventiva_em END,
    updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _ordem_id RETURNING * INTO v_result;
  INSERT INTO public.manutencao_ordem_eventos (
    empresa_id, ordem_id, tipo, status_anterior, status_novo, descricao, dados,
    executado_por, data_efetiva, client_uuid, payload_hash
  ) VALUES (
    v_company_id, _ordem_id, v_event_type, v_order.status, v_status,
    CASE v_status WHEN 'concluida' THEN 'Ordem concluída' WHEN 'cancelada' THEN 'Ordem cancelada'
      WHEN 'em_manutencao' THEN 'Manutenção iniciada' ELSE 'Status da ordem alterado' END,
    jsonb_build_object('justificativa', nullif(btrim(_justificativa), '')),
    auth.uid(), v_effective_at, _client_uuid, v_hash
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('manutencao', 'status_alterado', 'Status da ordem de manutenção alterado', auth.uid(), v_company_id,
    jsonb_build_object('ordem_id', _ordem_id, 'status_anterior', v_order.status, 'status_novo', v_status));

  -- Único ponto de geração do lançamento financeiro: a ordem acabou de virar
  -- 'concluida' nesta mesma transação, com custo_total já congelado (a
  -- própria RPC de edição bloqueia mudanças em ordem encerrada - MT014).
  IF v_status = 'concluida' THEN
    PERFORM public.sync_equipment_maintenance_financial_entry(v_company_id, _ordem_id);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. LEITURA - categoria "Manutenções" no Financeiro (lista + resumo),
--    mesmo formato jsonb paginado de listar_ordens_manutencao/
--    listar_contas_receber.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.listar_despesas_manutencao(
  _pagina integer DEFAULT 1,
  _por_pagina integer DEFAULT 20,
  _busca text DEFAULT NULL,
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
  v_page integer := greatest(COALESCE(_pagina, 1), 1);
  v_per_page integer := greatest(1, least(COALESCE(_por_pagina, 20), 100));
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  WITH base AS (
    SELECT fl.*, o.numero AS ordem_numero, o.concluida_em, o.material_id,
      m.nome AS material_nome, m.codigo_interno AS material_codigo,
      count(*) OVER () AS total
    FROM public.financeiro_lancamentos AS fl
    JOIN public.manutencao_ordens AS o ON o.empresa_id = fl.empresa_id AND o.id = fl.origem_id
    JOIN public.materiais AS m ON m.empresa_id = o.empresa_id AND m.id = o.material_id
    WHERE fl.empresa_id = v_company_id
      AND fl.origem_tipo = 'manutencao_equipamento'
      AND fl.tipo = 'despesa'
      AND (nullif(btrim(_busca), '') IS NULL
        OR o.numero ILIKE '%' || btrim(_busca) || '%'
        OR m.nome ILIKE '%' || btrim(_busca) || '%'
        OR m.codigo_interno ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(fl.descricao, '') ILIKE '%' || btrim(_busca) || '%')
    ORDER BY o.concluida_em DESC, fl.id DESC
    OFFSET (v_page - 1) * v_per_page LIMIT v_per_page
  )
  SELECT jsonb_build_object(
    'id', b.id, 'empresa_id', b.empresa_id, 'origem_id', b.origem_id,
    'ordem_numero', b.ordem_numero, 'material_id', b.material_id,
    'material_nome', b.material_nome, 'material_codigo', b.material_codigo,
    'descricao', b.descricao, 'valor_original', b.valor_original,
    'status', b.status, 'concluida_em', b.concluida_em
  ), b.total FROM base AS b;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_resumo_financeiro_manutencoes(
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (valor_total numeric, quantidade_ordens bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  SELECT COALESCE(sum(fl.valor_original), 0)::numeric, count(*)::bigint
  FROM public.financeiro_lancamentos AS fl
  WHERE fl.empresa_id = v_company_id AND fl.origem_tipo = 'manutencao_equipamento' AND fl.tipo = 'despesa';
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. BACKFILL - manutenção, NÃO exposta ao app (sem GRANT para
--    authenticated), mesmo papel de backfill_financeiro_locacoes: cobre
--    ordens já concluídas antes desta migration existir.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.backfill_financeiro_manutencoes(
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (ordem_id uuid, numero text, empresa_id uuid, resultado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order record;
  v_before public.financeiro_lancamentos%ROWTYPE;
  v_after public.financeiro_lancamentos%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_order IN
    SELECT * FROM public.manutencao_ordens AS o
    WHERE o.status = 'concluida' AND o.custo_total > 0
      AND (_empresa_id IS NULL OR o.empresa_id = _empresa_id)
    ORDER BY o.concluida_em
  LOOP
    SELECT fl.* INTO v_before FROM public.financeiro_lancamentos AS fl
    WHERE fl.empresa_id = v_order.empresa_id AND fl.origem_tipo = 'manutencao_equipamento' AND fl.origem_id = v_order.id;

    PERFORM public.sync_equipment_maintenance_financial_entry(v_order.empresa_id, v_order.id);

    SELECT fl.* INTO v_after FROM public.financeiro_lancamentos AS fl
    WHERE fl.empresa_id = v_order.empresa_id AND fl.origem_tipo = 'manutencao_equipamento' AND fl.origem_id = v_order.id;

    IF v_before.id IS NULL AND v_after.id IS NOT NULL THEN
      v_count := v_count + 1;
      RETURN QUERY SELECT v_order.id, v_order.numero, v_order.empresa_id, 'lancamento_criado'::text;
    ELSIF v_before.id IS NOT NULL THEN
      RETURN QUERY SELECT v_order.id, v_order.numero, v_order.empresa_id, 'ja_existia'::text;
    ELSE
      RETURN QUERY SELECT v_order.id, v_order.numero, v_order.empresa_id, 'sem_obrigacao'::text;
    END IF;
  END LOOP;

  IF _empresa_id IS NOT NULL THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
    VALUES ('financeiro', 'backfill_executado', 'Backfill de lançamentos financeiros de manutenção executado',
      auth.uid(), _empresa_id, jsonb_build_object('lancamentos_criados', v_count));
  END IF;

  RETURN;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. GRANTS - mesmo padrão de 20260807090000/20260808110000: todo helper
--    interno perde EXECUTE para PUBLIC/anon/authenticated/service_role;
--    toda RPC pública ganha authenticated e perde PUBLIC/anon/service_role.
--    transicionar_ordem_manutencao não aparece aqui de propósito: CREATE OR
--    REPLACE preserva os grants que 20260802230000 já concedeu, sem
--    necessidade de reemitir.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.sync_equipment_maintenance_financial_entry(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.backfill_financeiro_manutencoes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.listar_despesas_manutencao(integer, integer, text, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_resumo_financeiro_manutencoes(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.listar_despesas_manutencao(integer, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_resumo_financeiro_manutencoes(uuid) TO authenticated;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
DO $$
DECLARE
  v_fn regprocedure;
  v_role text;
  v_internal regprocedure[] := ARRAY[
    'public.sync_equipment_maintenance_financial_entry(uuid,uuid)',
    'public.backfill_financeiro_manutencoes(uuid)'
  ]::regprocedure[];
  v_public regprocedure[] := ARRAY[
    'public.listar_despesas_manutencao(integer,integer,text,uuid)',
    'public.obter_resumo_financeiro_manutencoes(uuid)',
    'public.transicionar_ordem_manutencao(uuid,text,uuid,timestamptz,text,timestamptz,uuid)'
  ]::regprocedure[];
BEGIN
  FOREACH v_fn IN ARRAY v_internal LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN130',
          MESSAGE = format('Hardening falhou: %s ainda executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
    RAISE NOTICE 'INTERNO BLOQUEADO | % | PUBLIC=nao anon=nao authenticated=nao service_role=nao', v_fn;
  END LOOP;

  FOREACH v_fn IN ARRAY v_public LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN131',
        MESSAGE = format('RPC publica sem EXECUTE de authenticated: %s.', v_fn);
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.listar_despesas_manutencao(integer,integer,text,uuid)',
    'public.obter_resumo_financeiro_manutencoes(uuid)'
  ]::regprocedure[] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN132',
          MESSAGE = format('Higiene falhou: %s ainda executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'OK: privilegios da integracao financeira de manutencao conferem.';

  -- Idempotência estrutural continua garantida pela mesma UNIQUE de
  -- 20260806090000 - nenhuma tabela nova, só confirma que ela não foi
  -- removida/alterada por engano.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financeiro_lancamentos'::regclass
      AND conname = 'financeiro_lancamentos_origem_unica'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'FN133',
      MESSAGE = 'financeiro_lancamentos_origem_unica ausente - idempotencia estrutural quebrada.';
  END IF;
END;
$$;
