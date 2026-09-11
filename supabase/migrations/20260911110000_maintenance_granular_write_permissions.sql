-- Backstage Pro - Manutenção adopts the granular per-user permission
-- mechanism already proven by RFID, Check-in/Check-out and Controle de
-- Estoque (user_module_permissions/user_has_module_action,
-- 20260810090000_user_module_permissions.sql,
-- 20260819100000_checkin_checkout_granular_write_permissions.sql,
-- 20260911100000_stock_granular_write_permissions.sql).
--
-- Problem: resolve_equipment_maintenance_company(_empresa_id, _write) gates
-- every write RPC in this module through can_write_company_module, which
-- requires has_role(admin_empresa) OR is_master_admin() unconditionally
-- (20260808100000_enforce_master_tenant_isolation.sql). A plain "usuario"
-- can therefore never open/edit/transition a maintenance order or manage its
-- supplies, even after an admin_empresa explicitly grants create/edit on
-- 'manutencao_equipamentos' via "Editar Usuário".
--
-- Fix, mirroring the precedent exactly:
--   1. resolve_equipment_maintenance_company's write branch stops requiring
--      can_write_company_module specifically and instead accepts it OR any
--      of the three granular write grants on 'manutencao_equipamentos'.
--   2. Each write RPC adds its own precise action check right after
--      resolving the company:
--        criar_ordem_manutencao             -> 'create' (opens a new order)
--        atualizar_ordem_manutencao         -> 'edit'   (edits an open order)
--        transicionar_ordem_manutencao      -> 'edit'   (status transition,
--                                                          including cancel -
--                                                          the frontend has no
--                                                          separate delete
--                                                          action for this
--                                                          module, so 'delete'
--                                                          is unused here)
--        salvar_insumo_ordem_manutencao     -> 'edit'   (gerenciarInsumos)
--        remover_insumo_ordem_manutencao    -> 'edit'   (gerenciarInsumos)
--   transicionar_ordem_manutencao is redefined here from its latest prior
--   shape (20260808120000_equipment_maintenance_financial_integration.sql,
--   which added the financial-entry sync on conclusion) - that behavior is
--   preserved verbatim, only the permission check is added.
--
-- View is deliberately left untouched: can_read_company_module has no role
-- gate at all, and this migration does not change that. Read-only RPCs
-- (listar_ordens_manutencao, obter_ordem_manutencao,
-- obter_indicadores_manutencao, buscar_materiais_manutencao,
-- obter_sugestao_manutencao_checkin, obter_resumo_manutencao_material,
-- listar_despesas_manutencao, obter_resumo_financeiro_manutencoes) are
-- untouched for the same reason as every other read RPC in this family.

CREATE OR REPLACE FUNCTION public.resolve_equipment_maintenance_company(
  _requested_company_id uuid,
  _write boolean
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'manutencao_equipamentos')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT009', MESSAGE = 'Manutenção e Gestão de Materiais precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT010', MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (
       _write
       AND NOT (
         public.can_write_company_module(v_company_id, 'manutencao_equipamentos')
         OR public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'create')
         OR public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'edit')
         OR public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'delete')
       )
     )
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'manutencao_equipamentos')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_ordem_manutencao(
  _material_id uuid,
  _tipo text,
  _prioridade text,
  _origem text,
  _defeito_relatado text,
  _client_uuid uuid,
  _quantidade_afetada integer DEFAULT 1,
  _responsavel_tipo text DEFAULT NULL,
  _responsavel_id uuid DEFAULT NULL,
  _previsao_conclusao_em timestamptz DEFAULT NULL,
  _condicao_entrada text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _modalidade_execucao text DEFAULT 'interna',
  _fornecedor_externo text DEFAULT NULL,
  _intervalo_preventivo_dias integer DEFAULT NULL,
  _custodia_evento_origem_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.manutencao_ordens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_material public.materiais%ROWTYPE;
  v_type public.equipment_maintenance_type;
  v_priority public.equipment_maintenance_priority;
  v_origin public.equipment_maintenance_origin;
  v_execution public.equipment_maintenance_execution;
  v_responsible_type public.material_custody_responsible_type;
  v_responsible_name text;
  v_checkin public.material_custodia_eventos%ROWTYPE;
  v_existing public.manutencao_ordens%ROWTYPE;
  v_result public.manutencao_ordens%ROWTYPE;
  v_hash text;
  v_physical bigint;
  v_reserved bigint;
  v_maintenance bigint;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para criar ordens de manutenção.';
  END IF;
  IF _material_id IS NULL OR _client_uuid IS NULL OR nullif(btrim(_defeito_relatado), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Material, motivo/defeito e identificador são obrigatórios.';
  END IF;
  BEGIN
    v_type := _tipo::public.equipment_maintenance_type;
    v_priority := _prioridade::public.equipment_maintenance_priority;
    v_origin := _origem::public.equipment_maintenance_origin;
    v_execution := _modalidade_execucao::public.equipment_maintenance_execution;
    IF _responsavel_tipo IS NOT NULL THEN
      v_responsible_type := _responsavel_tipo::public.material_custody_responsible_type;
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Tipo, prioridade, origem, execução ou responsável inválido.';
  END;
  IF v_type IS NULL OR v_priority IS NULL OR v_origin IS NULL OR v_execution IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Tipo, prioridade, origem e execução são obrigatórios.';
  END IF;
  IF COALESCE(_quantidade_afetada, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'A quantidade afetada deve ser maior que zero.';
  END IF;
  IF _intervalo_preventivo_dias IS NOT NULL AND (_intervalo_preventivo_dias < 1 OR _intervalo_preventivo_dias > 3650) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'O intervalo preventivo deve ficar entre 1 e 3650 dias.';
  END IF;
  IF v_origin = 'checkin' AND _custodia_evento_origem_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'A origem Check-in exige o evento de retorno.';
  END IF;
  IF v_origin <> 'checkin' AND _custodia_evento_origem_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Evento de Check-in só pode ser usado com origem Check-in.';
  END IF;
  IF v_execution = 'externa' AND nullif(btrim(_fornecedor_externo), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Informe o fornecedor externo.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'material', _material_id, 'tipo', v_type, 'prioridade', v_priority,
    'origem', v_origin, 'defeito', btrim(_defeito_relatado),
    'quantidade', _quantidade_afetada, 'responsavel_tipo', v_responsible_type,
    'responsavel_id', _responsavel_id, 'previsao', _previsao_conclusao_em,
    'condicao', nullif(btrim(_condicao_entrada), ''),
    'observacoes', nullif(btrim(_observacoes), ''), 'execucao', v_execution,
    'fornecedor', nullif(btrim(_fornecedor_externo), ''),
    'intervalo', _intervalo_preventivo_dias, 'checkin_evento', _custodia_evento_origem_id
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':maintenance-client:' || _client_uuid::text, 0));
  SELECT * INTO v_existing FROM public.manutencao_ordens
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'MT013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  -- Same lock used by Stage 4 reservation integration and the custody guard.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-material:' || _material_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':operational-material:' || _material_id::text, 0));

  SELECT * INTO v_material FROM public.materiais
  WHERE empresa_id = v_company_id AND id = _material_id;
  IF NOT FOUND OR NOT v_material.ativo THEN
    RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Material ativo não encontrado na empresa.';
  END IF;
  IF v_material.tipo_controle = 'individual' AND _quantidade_afetada <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Material individual deve ter quantidade afetada igual a um.';
  END IF;
  IF v_material.status_operacional NOT IN ('disponivel', 'avariado', 'em_manutencao') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'O estado operacional atual não permite abrir manutenção.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_custodias AS c
    WHERE c.empresa_id = v_company_id AND c.material_id = _material_id
      AND c.status IN ('aberta', 'parcial')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'Material em custódia deve retornar antes da manutenção.';
  END IF;

  IF v_origin = 'checkin' THEN
    SELECT * INTO v_checkin FROM public.material_custodia_eventos
    WHERE empresa_id = v_company_id AND id = _custodia_evento_origem_id;
    IF NOT FOUND OR v_checkin.tipo <> 'checkin' OR v_checkin.material_id <> _material_id
       OR v_checkin.condicao NOT IN ('com_avaria', 'danificado', 'manutencao_necessaria') THEN
      RAISE EXCEPTION USING ERRCODE = 'MT006', MESSAGE = 'Evento de Check-in incompatível com a manutenção.';
    END IF;
    IF _quantidade_afetada > v_checkin.quantidade THEN
      RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'A quantidade afetada supera a devolvida no evento.';
    END IF;
  END IF;

  v_maintenance := public.equipment_active_maintenance_quantity(v_company_id, _material_id);
  IF v_material.tipo_controle = 'individual' AND v_maintenance > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'Já existe manutenção ativa para este equipamento.';
  END IF;
  IF public.company_has_active_module(v_company_id, 'controle_estoque') THEN
    SELECT COALESCE(sum(s.quantidade), 0)::bigint INTO v_physical
    FROM public.estoque_saldos AS s
    JOIN public.estoque_localizacoes AS l ON l.empresa_id = s.empresa_id AND l.id = s.localizacao_id AND l.ativa
    WHERE s.empresa_id = v_company_id AND s.material_id = _material_id;
    IF v_maintenance + _quantidade_afetada > v_physical THEN
      RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'A quantidade em manutenção supera o saldo físico disponível.';
    END IF;
    IF public.company_has_active_module(v_company_id, 'locacao_materiais') THEN
      SELECT COALESCE(sum(greatest(i.quantidade_contratada - op.retirada::integer, 0)), 0)::bigint
      INTO v_reserved
      FROM public.material_locacao_itens AS i
      JOIN public.material_locacoes AS r ON r.empresa_id = i.empresa_id AND r.id = i.locacao_id
      CROSS JOIN LATERAL public.material_rental_item_operational_totals(i.id) AS op
      WHERE i.empresa_id = v_company_id AND i.material_id = _material_id
        AND r.status IN ('reservada', 'pronta_retirada', 'em_andamento', 'parcialmente_devolvida');
      IF v_reserved + v_maintenance + _quantidade_afetada > v_physical THEN
        RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'Material possui reserva ou operação incompatível com a manutenção.';
      END IF;
    END IF;
  ELSIF v_material.tipo_controle = 'quantidade'
        AND v_maintenance + _quantidade_afetada > v_material.quantidade THEN
    RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'A quantidade em manutenção supera a quantidade cadastrada.';
  END IF;

  v_responsible_name := public.resolve_equipment_maintenance_responsible(v_company_id, v_responsible_type, _responsavel_id);
  PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
  INSERT INTO public.manutencao_ordens (
    empresa_id, material_id, numero, tipo, prioridade, origem, tipo_controle,
    quantidade_afetada, defeito_relatado, condicao_entrada, observacoes,
    modalidade_execucao, responsavel_tipo, responsavel_usuario_id,
    responsavel_funcionario_id, responsavel_nome, fornecedor_externo,
    previsao_conclusao_em, intervalo_preventivo_dias,
    custodia_evento_origem_id, client_uuid, payload_hash,
    created_by, updated_by
  ) VALUES (
    v_company_id, _material_id, public.next_equipment_maintenance_number(v_company_id),
    v_type, v_priority, v_origin, v_material.tipo_controle,
    _quantidade_afetada, btrim(_defeito_relatado), nullif(btrim(_condicao_entrada), ''),
    nullif(btrim(_observacoes), ''), v_execution, v_responsible_type,
    CASE WHEN v_responsible_type = 'usuario' THEN _responsavel_id END,
    CASE WHEN v_responsible_type = 'funcionario' THEN _responsavel_id END,
    v_responsible_name, nullif(btrim(_fornecedor_externo), ''),
    _previsao_conclusao_em, _intervalo_preventivo_dias,
    _custodia_evento_origem_id, _client_uuid, v_hash, auth.uid(), auth.uid()
  ) RETURNING * INTO v_result;
  INSERT INTO public.manutencao_ordem_eventos (
    empresa_id, ordem_id, tipo, descricao, dados, executado_por, client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_result.id, 'criacao', 'Ordem de manutenção criada',
    jsonb_build_object('numero', v_result.numero, 'material_id', _material_id, 'origem', v_origin, 'quantidade_afetada', _quantidade_afetada),
    auth.uid(), _client_uuid, v_hash
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('manutencao', 'ordem_criada', 'Ordem de manutenção criada', auth.uid(), v_company_id,
    jsonb_build_object('ordem_id', v_result.id, 'numero', v_result.numero, 'material_id', _material_id));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_ordem_manutencao(
  _ordem_id uuid,
  _client_uuid uuid,
  _expected_updated_at timestamptz,
  _prioridade text DEFAULT NULL,
  _diagnostico text DEFAULT NULL,
  _servico_executado text DEFAULT NULL,
  _responsavel_tipo text DEFAULT NULL,
  _responsavel_id uuid DEFAULT NULL,
  _previsao_conclusao_em timestamptz DEFAULT NULL,
  _condicao_saida text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _modalidade_execucao text DEFAULT NULL,
  _fornecedor_externo text DEFAULT NULL,
  _intervalo_preventivo_dias integer DEFAULT NULL,
  _custo_mao_obra numeric DEFAULT 0,
  _custo_pecas numeric DEFAULT 0,
  _custo_outros numeric DEFAULT 0,
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
  v_priority public.equipment_maintenance_priority;
  v_execution public.equipment_maintenance_execution;
  v_responsible_type public.material_custody_responsible_type;
  v_responsible_name text;
  v_hash text;
  v_event_type public.equipment_maintenance_event_type := 'edicao'::public.equipment_maintenance_event_type;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar esta ordem de manutenção.';
  END IF;
  IF _ordem_id IS NULL OR _client_uuid IS NULL OR _expected_updated_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Ordem, versão e identificador são obrigatórios.';
  END IF;
  BEGIN
    IF _prioridade IS NOT NULL THEN v_priority := _prioridade::public.equipment_maintenance_priority; END IF;
    IF _modalidade_execucao IS NOT NULL THEN v_execution := _modalidade_execucao::public.equipment_maintenance_execution; END IF;
    IF _responsavel_tipo IS NOT NULL THEN v_responsible_type := _responsavel_tipo::public.material_custody_responsible_type; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Prioridade, execução ou responsável inválido.';
  END;
  IF COALESCE(_custo_mao_obra, 0) < 0 OR COALESCE(_custo_pecas, 0) < 0 OR COALESCE(_custo_outros, 0) < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Custos não podem ser negativos.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'ordem', _ordem_id, 'prioridade', _prioridade, 'diagnostico', nullif(btrim(_diagnostico), ''),
    'servico', nullif(btrim(_servico_executado), ''), 'responsavel_tipo', _responsavel_tipo,
    'responsavel_id', _responsavel_id, 'previsao', _previsao_conclusao_em,
    'condicao_saida', nullif(btrim(_condicao_saida), ''), 'observacoes', nullif(btrim(_observacoes), ''),
    'execucao', _modalidade_execucao, 'fornecedor', nullif(btrim(_fornecedor_externo), ''),
    'intervalo', _intervalo_preventivo_dias, 'mao_obra', _custo_mao_obra,
    'pecas', _custo_pecas, 'outros', _custo_outros
  )::text, 'UTF8')), 'hex');
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
  IF v_order.status IN ('concluida', 'cancelada') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT014', MESSAGE = 'Ordem encerrada não pode ser editada.';
  END IF;
  IF v_order.updated_at <> _expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'MT015', MESSAGE = 'A ordem foi alterada por outra sessão. Recarregue os dados.';
  END IF;
  v_priority := COALESCE(v_priority, v_order.prioridade);
  v_execution := COALESCE(v_execution, v_order.modalidade_execucao);
  v_responsible_type := COALESCE(v_responsible_type, v_order.responsavel_tipo);
  v_responsible_name := public.resolve_equipment_maintenance_responsible(v_company_id, v_responsible_type, COALESCE(_responsavel_id, v_order.responsavel_usuario_id, v_order.responsavel_funcionario_id));
  IF v_execution = 'externa' AND nullif(btrim(COALESCE(_fornecedor_externo, v_order.fornecedor_externo)), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Informe o fornecedor externo.';
  END IF;
  IF nullif(btrim(_diagnostico), '') IS DISTINCT FROM v_order.diagnostico AND nullif(btrim(_diagnostico), '') IS NOT NULL THEN
    v_event_type := 'diagnostico'::public.equipment_maintenance_event_type;
  END IF;
  PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
  UPDATE public.manutencao_ordens SET
    prioridade = v_priority,
    diagnostico = nullif(btrim(_diagnostico), ''),
    servico_executado = nullif(btrim(_servico_executado), ''),
    responsavel_tipo = v_responsible_type,
    responsavel_usuario_id = CASE WHEN v_responsible_type = 'usuario' THEN COALESCE(_responsavel_id, v_order.responsavel_usuario_id) END,
    responsavel_funcionario_id = CASE WHEN v_responsible_type = 'funcionario' THEN COALESCE(_responsavel_id, v_order.responsavel_funcionario_id) END,
    responsavel_nome = v_responsible_name,
    previsao_conclusao_em = _previsao_conclusao_em,
    condicao_saida = nullif(btrim(_condicao_saida), ''),
    observacoes = nullif(btrim(_observacoes), ''),
    modalidade_execucao = v_execution,
    fornecedor_externo = CASE WHEN v_execution = 'externa' THEN nullif(btrim(COALESCE(_fornecedor_externo, v_order.fornecedor_externo)), '') END,
    intervalo_preventivo_dias = _intervalo_preventivo_dias,
    custo_mao_obra = COALESCE(_custo_mao_obra, 0),
    custo_pecas = COALESCE(_custo_pecas, 0),
    custo_outros = COALESCE(_custo_outros, 0),
    updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _ordem_id RETURNING * INTO v_result;
  INSERT INTO public.manutencao_ordem_eventos (empresa_id, ordem_id, tipo, descricao, dados, executado_por, client_uuid, payload_hash)
  VALUES (v_company_id, _ordem_id, v_event_type, CASE WHEN v_event_type = 'diagnostico' THEN 'Diagnóstico atualizado' ELSE 'Dados relevantes da ordem atualizados' END,
    jsonb_build_object('prioridade', v_result.prioridade, 'custo_total', v_result.custo_total), auth.uid(), _client_uuid, v_hash);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_insumo_ordem_manutencao(
  _ordem_id uuid,
  _descricao text,
  _quantidade numeric,
  _unidade text,
  _custo_unitario numeric,
  _client_uuid uuid,
  _material_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.manutencao_ordem_insumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_order public.manutencao_ordens%ROWTYPE;
  v_result public.manutencao_ordem_insumos%ROWTYPE;
  v_existing public.manutencao_ordem_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para gerenciar insumos desta ordem.';
  END IF;
  IF _ordem_id IS NULL OR _client_uuid IS NULL OR nullif(btrim(_descricao), '') IS NULL
     OR COALESCE(_quantidade, 0) <= 0 OR COALESCE(_custo_unitario, 0) < 0 OR nullif(btrim(_unidade), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Dados do insumo são inválidos.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('ordem', _ordem_id, 'descricao', btrim(_descricao),
    'quantidade', _quantidade, 'unidade', btrim(_unidade), 'custo', _custo_unitario,
    'material', _material_id)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':maintenance-client:' || _client_uuid::text, 0));
  SELECT * INTO v_existing FROM public.manutencao_ordem_eventos WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash OR v_existing.ordem_id <> _ordem_id THEN
      RAISE EXCEPTION USING ERRCODE = 'MT013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.manutencao_ordem_insumos
    WHERE empresa_id = v_company_id AND id = (v_existing.dados->>'insumo_id')::uuid;
    RETURN v_result;
  END IF;
  SELECT * INTO v_order FROM public.manutencao_ordens WHERE empresa_id = v_company_id AND id = _ordem_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Ordem de manutenção não encontrada.'; END IF;
  IF v_order.status IN ('concluida', 'cancelada') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT014', MESSAGE = 'Ordem encerrada não aceita novos insumos.';
  END IF;
  IF _material_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.materiais WHERE empresa_id = v_company_id AND id = _material_id
  ) THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Material de estoque não encontrado na empresa.'; END IF;
  PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
  INSERT INTO public.manutencao_ordem_insumos (
    empresa_id, ordem_id, material_id, descricao, quantidade, unidade, custo_unitario, created_by
  ) VALUES (v_company_id, _ordem_id, _material_id, btrim(_descricao), _quantidade, btrim(_unidade), _custo_unitario, auth.uid())
  RETURNING * INTO v_result;
  UPDATE public.manutencao_ordens SET custo_pecas = (
    SELECT COALESCE(sum(i.custo_total), 0) FROM public.manutencao_ordem_insumos AS i
    WHERE i.empresa_id = v_company_id AND i.ordem_id = _ordem_id
  ), updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _ordem_id;
  INSERT INTO public.manutencao_ordem_eventos (empresa_id, ordem_id, tipo, descricao, dados, executado_por, client_uuid, payload_hash)
  VALUES (v_company_id, _ordem_id, 'insumo_adicionado', 'Peça ou insumo registrado',
    jsonb_build_object('insumo_id', v_result.id, 'descricao', v_result.descricao, 'quantidade', v_result.quantidade, 'custo_total', v_result.custo_total, 'movimenta_estoque', false),
    auth.uid(), _client_uuid, v_hash);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_insumo_ordem_manutencao(
  _ordem_id uuid,
  _insumo_id uuid,
  _justificativa text,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_order public.manutencao_ordens%ROWTYPE;
  v_supply public.manutencao_ordem_insumos%ROWTYPE;
  v_existing public.manutencao_ordem_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para gerenciar insumos desta ordem.';
  END IF;
  IF _ordem_id IS NULL OR _insumo_id IS NULL OR _client_uuid IS NULL OR nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Ordem, insumo, justificativa e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('ordem', _ordem_id, 'insumo', _insumo_id,
    'justificativa', btrim(_justificativa))::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':maintenance-client:' || _client_uuid::text, 0));
  SELECT * INTO v_existing FROM public.manutencao_ordem_eventos WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash OR v_existing.ordem_id <> _ordem_id THEN
      RAISE EXCEPTION USING ERRCODE = 'MT013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    RETURN true;
  END IF;
  SELECT * INTO v_order FROM public.manutencao_ordens WHERE empresa_id = v_company_id AND id = _ordem_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Ordem de manutenção não encontrada.'; END IF;
  IF v_order.status IN ('concluida', 'cancelada') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT014', MESSAGE = 'Ordem encerrada não permite remover insumos.';
  END IF;
  SELECT * INTO v_supply FROM public.manutencao_ordem_insumos
  WHERE empresa_id = v_company_id AND ordem_id = _ordem_id AND id = _insumo_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Insumo não encontrado.'; END IF;
  PERFORM set_config('backstage.equipment_maintenance_write', 'on', true);
  DELETE FROM public.manutencao_ordem_insumos WHERE empresa_id = v_company_id AND id = _insumo_id;
  UPDATE public.manutencao_ordens SET custo_pecas = (
    SELECT COALESCE(sum(i.custo_total), 0) FROM public.manutencao_ordem_insumos AS i
    WHERE i.empresa_id = v_company_id AND i.ordem_id = _ordem_id
  ), updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _ordem_id;
  INSERT INTO public.manutencao_ordem_eventos (empresa_id, ordem_id, tipo, descricao, dados, executado_por, client_uuid, payload_hash)
  VALUES (v_company_id, _ordem_id, 'insumo_removido', 'Peça ou insumo removido por reversão explícita',
    jsonb_build_object('insumo_id', v_supply.id, 'descricao', v_supply.descricao, 'quantidade', v_supply.quantidade,
      'custo_total', v_supply.custo_total, 'justificativa', btrim(_justificativa), 'movimenta_estoque', false),
    auth.uid(), _client_uuid, v_hash);
  RETURN true;
END;
$$;

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
  IF NOT public.user_has_module_action(v_company_id, 'manutencao_equipamentos', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para transicionar esta ordem de manutenção.';
  END IF;
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

COMMENT ON FUNCTION public.resolve_equipment_maintenance_company(uuid, boolean) IS
  'Resolves the caller''s company for Manutenção and confirms module/dependency/subscription state. The write branch admits admin_empresa/master_admin OR a usuario holding any explicit manutencao_equipamentos create/edit/delete grant (user_module_permissions) - the specific action required is checked independently by each write RPC.';
