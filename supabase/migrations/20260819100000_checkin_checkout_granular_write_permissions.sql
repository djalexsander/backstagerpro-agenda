-- Backstage Pro - Check-in/Check-out (and, by delegation, Scanner Remoto)
-- adopts the granular per-user permission mechanism already proven by RFID
-- (user_module_permissions/user_has_module_action,
-- 20260810090000_user_module_permissions.sql).
--
-- Problem: resolve_custody_company(_empresa_id, _write) gates every write
-- RPC in this module through can_write_company_module, which requires
-- has_role(admin_empresa) OR is_master_admin() unconditionally
-- (20260808100000_enforce_master_tenant_isolation.sql). A plain "usuario"
-- can therefore NEVER check out/check in/cancel/write off material - not
-- even after an admin_empresa explicitly grants them can_create/can_edit/
-- can_delete on 'checkin_checkout' via the existing, fully generic "Editar
-- Usuário" screen (UserModulePermissionsFields.tsx already lists every
-- active module, checkin_checkout included - it has simply had no backend
-- effect until now). That is a real frontend/backend divergence: the admin
-- UI already promises a capability the database silently ignores.
--
-- Fix, mirroring the RFID precedent exactly:
--   1. resolve_custody_company's write branch stops requiring
--      can_write_company_module specifically and instead accepts it OR any
--      of the three granular write grants - a plain "usuario" holding ANY
--      explicit create/edit/delete grant on checkin_checkout can now get
--      past this coarse gate (unchanged for admin_empresa/master_admin:
--      user_has_module_action already short-circuits true for them, same
--      as can_write_company_module always did).
--   2. Each of the four RPCs that actually perform a write adds its own
--      precise action check right after resolving the company, so a grant
--      for one action never silently unlocks another:
--        registrar_checkout_material        -> 'create'
--        registrar_checkin_material         -> 'edit'
--        cancelar_checkout_material         -> 'delete'
--        registrar_baixa_custodia_material  -> 'delete'
--      (cancel and write-off already share one frontend permission slot -
--      CheckinCheckout.tsx gates both the "Cancelar com estorno" and
--      "Baixa" buttons on the same permissions.cancelar - so sharing
--      'delete' on the backend matches, not invents, that grouping.)
--      iniciar_sessao_scanner_remoto gets an analogous check keyed off
--      _tipo_operacao, so a phone session can't be opened for an action the
--      operator doesn't hold. registrar_leitura_scanner_remoto needs no
--      change: it delegates the actual movement to
--      registrar_checkout_material/registrar_checkin_material, which now
--      enforce the specific action themselves, and a permission failure
--      there is already caught by that function's own
--      BEGIN/EXCEPTION WHEN OTHERS block and recorded as a normal 'erro'
--      reading instead of aborting the scan loop.
--
-- View is deliberately left untouched: can_read_company_module has no role
-- gate at all (any company member with the module reads), and this
-- migration does not change that. Extending view to require its own
-- explicit can_view grant - like RFID does, as a brand-new module with no
-- installed base - would regress every existing "usuario" who can see
-- Check-in/Check-out today; nothing in this task asks for that, and
-- "usuário comum só vê módulos permitidos" already describes the current
-- module-level gate, not a per-user one.
--
-- Not touched: buscar_materiais_custodia, listar_custodias_materiais,
-- listar_responsaveis_custodia, listar_eventos_custodia,
-- obter_indicadores_custodia (read-only, resolve_custody_company's
-- unmodified _write=false branch already covers them), and
-- encerrar_sessao_scanner_remoto (closing a session you already hold is not
-- itself checkout- or checkin-specific; the loosened resolve_custody_company
-- write gate alone is enough here, same as before this migration for any
-- admin/master caller).

-- ============================================================================
-- 1. resolve_custody_company - loosen the write gate to admit a granular grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_custody_company(
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
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;

  IF NOT public.company_has_active_module(v_company_id, 'checkin_checkout') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI009',
      MESSAGE = 'O módulo Check-in e Check-out não está ativo para esta empresa.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'gestao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'controle_estoque') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI009',
      MESSAGE = 'As dependências de Materiais e Estoque precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'CI010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  -- Coarse "can write SOMETHING here at all" gate: admin_empresa/master_admin
  -- via can_write_company_module (unchanged), or a plain usuario holding ANY
  -- explicit create/edit/delete grant on checkin_checkout. Which SPECIFIC
  -- action is actually allowed is checked independently by each write RPC
  -- below via user_has_module_action - this function only decides whether
  -- the caller may proceed past company/module/subscription resolution at
  -- all, same responsibility it always had.
  IF (
       _write
       AND NOT (
         public.can_write_company_module(v_company_id, 'checkin_checkout')
         OR public.user_has_module_action(v_company_id, 'checkin_checkout', 'create')
         OR public.user_has_module_action(v_company_id, 'checkin_checkout', 'edit')
         OR public.user_has_module_action(v_company_id, 'checkin_checkout', 'delete')
       )
     )
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'checkin_checkout')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

-- ============================================================================
-- 2. registrar_checkout_material - requires the 'create' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_checkout_material(
  _material_id uuid,
  _quantidade integer,
  _localizacao_origem_id uuid,
  _responsavel_tipo text,
  _responsavel_id uuid,
  _finalidade text,
  _condicao_saida text,
  _client_uuid uuid,
  _previsao_retorno timestamptz DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
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
  v_material public.materiais%ROWTYPE;
  v_existing public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_movement public.estoque_movimentacoes%ROWTYPE;
  v_custody_id uuid := gen_random_uuid();
  v_responsible_type public.material_custody_responsible_type;
  v_purpose public.material_custody_purpose;
  v_condition public.material_custody_condition;
  v_responsible_name text;
  v_hash text;
  v_stock_hash text;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
  v_origin_active boolean;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para registrar check-out.';
  END IF;
  IF _material_id IS NULL OR _localizacao_origem_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Material, localização e identificador da operação são obrigatórios.';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Informe uma quantidade inteira maior que zero.';
  END IF;
  BEGIN
    v_responsible_type := _responsavel_tipo::public.material_custody_responsible_type;
    v_purpose := _finalidade::public.material_custody_purpose;
    v_condition := _condicao_saida::public.material_custody_condition;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Responsável, finalidade ou condição inválida.';
  END;
  IF v_responsible_type IS NULL OR v_purpose IS NULL OR v_condition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Responsável, finalidade e condição são obrigatórios.';
  END IF;
  IF (_referencia_tipo IS NULL) <> (_referencia_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Tipo e identificador da referência devem ser informados juntos.';
  END IF;
  IF _previsao_retorno IS NOT NULL AND _previsao_retorno < v_effective_at THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'A previsão de retorno não pode ser anterior à retirada.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'material', _material_id,
    'quantidade', _quantidade,
    'origem', _localizacao_origem_id,
    'responsavel_tipo', v_responsible_type,
    'responsavel_id', _responsavel_id,
    'finalidade', v_purpose,
    'condicao', v_condition,
    'previsao', _previsao_retorno,
    'observacao', nullif(btrim(_observacao), ''),
    'referencia_tipo', nullif(btrim(_referencia_tipo), ''),
    'referencia_id', _referencia_id,
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing
  FROM public.material_custodias
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT * INTO v_material
  FROM public.materiais
  WHERE empresa_id = v_company_id AND id = _material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005', MESSAGE = 'Material não encontrado.';
  END IF;
  IF NOT v_material.ativo THEN
    RAISE EXCEPTION USING ERRCODE = 'CI008',
      MESSAGE = 'Material inativo não pode sair em custódia.';
  END IF;
  IF v_material.status_operacional <> 'disponivel' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI008',
      MESSAGE = 'Somente materiais operacionalmente disponíveis podem sair.';
  END IF;
  IF v_material.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI002',
      MESSAGE = 'Material individual deve sair com quantidade um.';
  END IF;
  IF v_material.tipo_controle = 'individual' AND EXISTS (
    SELECT 1 FROM public.material_custodias
    WHERE empresa_id = v_company_id
      AND material_id = _material_id
      AND status IN ('aberta', 'parcial')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'CI012',
      MESSAGE = 'Este material individual já possui check-out ativo.';
  END IF;

  SELECT location.ativa INTO v_origin_active
  FROM public.estoque_localizacoes AS location
  WHERE location.empresa_id = v_company_id
    AND location.id = _localizacao_origem_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005',
      MESSAGE = 'Localização de origem inválida.';
  END IF;
  IF NOT v_origin_active THEN
    RAISE EXCEPTION USING ERRCODE = 'CI006',
      MESSAGE = 'Localização inativa não pode originar um novo check-out.';
  END IF;

  v_responsible_name := public.resolve_custody_responsible_name(
    v_company_id, v_responsible_type, _responsavel_id
  );
  v_stock_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', v_custody_id,
    'material', _material_id,
    'quantidade', _quantidade,
    'origem', _localizacao_origem_id,
    'data', _data_efetiva,
    'operacao', 'checkout'
  )::text, 'UTF8')), 'hex');

  v_movement := public.apply_stock_movement(
    v_company_id, _material_id, 'saida', _quantidade,
    _localizacao_origem_id, NULL,
    'Check-out de material', NULL, _observacao, NULL,
    _data_efetiva, 'checkin_checkout', v_custody_id,
    _client_uuid, v_stock_hash, NULL
  );

  INSERT INTO public.material_custodias (
    id, empresa_id, material_id, tipo_controle,
    quantidade_retirada, quantidade_devolvida, localizacao_origem_id,
    retirada_em, previsao_retorno, executado_por,
    responsavel_tipo, responsavel_usuario_id, responsavel_funcionario_id,
    responsavel_nome, finalidade, referencia_tipo, referencia_id,
    observacao_saida, condicao_saida, status, movimento_saida_id,
    client_uuid, payload_hash
  ) VALUES (
    v_custody_id, v_company_id, _material_id, v_material.tipo_controle,
    _quantidade, 0, _localizacao_origem_id,
    v_effective_at, _previsao_retorno, auth.uid(),
    v_responsible_type,
    CASE WHEN v_responsible_type = 'usuario' THEN _responsavel_id END,
    CASE WHEN v_responsible_type = 'funcionario' THEN _responsavel_id END,
    v_responsible_name, v_purpose,
    nullif(btrim(_referencia_tipo), ''), _referencia_id,
    nullif(btrim(_observacao), ''), v_condition, 'aberta', v_movement.id,
    _client_uuid, v_hash
  ) RETURNING * INTO v_result;

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade,
    localizacao_origem_id, condicao, observacao, data_efetiva,
    executado_por, movimento_estoque_id, client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_result.id, _material_id, 'checkout', _quantidade,
    _localizacao_origem_id, v_condition, nullif(btrim(_observacao), ''),
    v_effective_at, auth.uid(), v_movement.id, _client_uuid, v_hash
  );

  INSERT INTO public.system_logs (
    tipo, acao, descricao, user_id, empresa_id, dados
  ) VALUES (
    'custodia', 'material_checkout',
    'Check-out de material registrado para ' || v_responsible_name,
    auth.uid(), v_company_id,
    jsonb_build_object(
      'custodia_id', v_result.id,
      'material_id', _material_id,
      'quantidade', _quantidade,
      'movimento_estoque_id', v_movement.id
    )
  );
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. registrar_checkin_material - requires the 'edit' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_checkin_material(_custodia_id uuid, _quantidade integer, _localizacao_destino_id uuid, _condicao_retorno text, _client_uuid uuid, _observacao text DEFAULT NULL::text, _ocorrencia text DEFAULT NULL::text, _data_efetiva timestamp with time zone DEFAULT NULL::timestamp with time zone, _empresa_id uuid DEFAULT NULL::uuid)
RETURNS material_custodias LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_company_id uuid; v_custody public.material_custodias%ROWTYPE; v_result public.material_custodias%ROWTYPE;
  v_existing_event public.material_custodia_eventos%ROWTYPE; v_movement public.estoque_movimentacoes%ROWTYPE;
  v_condition public.material_custody_condition; v_hash text; v_stock_hash text; v_pending integer;
  v_new_returned integer; v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp()); v_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'edit') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Você não tem permissão para registrar check-in.'; END IF;
  IF _custodia_id IS NULL OR _localizacao_destino_id IS NULL OR _client_uuid IS NULL THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Operacao, localizacao de retorno e identificador sao obrigatorios.'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Informe uma quantidade devolvida maior que zero.'; END IF;
  BEGIN v_condition := _condicao_retorno::public.material_custody_condition; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Condicao de retorno invalida.'; END;
  IF v_condition IS NULL THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Informe a condicao de retorno.'; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('custodia',_custodia_id,'quantidade',_quantidade,'destino',_localizacao_destino_id,'condicao',v_condition,'observacao',nullif(btrim(_observacao),''),'ocorrencia',nullif(btrim(_ocorrencia),''),'data',_data_efetiva)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text,0));
  SELECT * INTO v_existing_event FROM public.material_custodia_eventos WHERE empresa_id=v_company_id AND client_uuid=_client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash<>v_hash OR v_existing_event.tipo<>'checkin' THEN RAISE EXCEPTION USING ERRCODE='CI013', MESSAGE='Esta operacao ja foi enviada com dados diferentes.'; END IF;
    SELECT * INTO v_result FROM public.material_custodias WHERE empresa_id=v_company_id AND id=v_existing_event.custodia_id; RETURN v_result;
  END IF;
  SELECT * INTO v_custody FROM public.material_custodias WHERE empresa_id=v_company_id AND id=_custodia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='CI005', MESSAGE='Operacao de custodia nao encontrada.'; END IF;
  IF v_custody.status NOT IN ('aberta','parcial') THEN RAISE EXCEPTION USING ERRCODE='CI014', MESSAGE='Esta operacao nao possui quantidade pendente para retorno.'; END IF;
  v_pending := v_custody.quantidade_retirada-v_custody.quantidade_devolvida-v_custody.quantidade_baixada;
  IF _quantidade>v_pending THEN RAISE EXCEPTION USING ERRCODE='CI001', MESSAGE='A quantidade devolvida supera a quantidade ainda em custodia.'; END IF;
  IF v_custody.tipo_controle='individual' AND _quantidade<>1 THEN RAISE EXCEPTION USING ERRCODE='CI002', MESSAGE='Material individual deve retornar com quantidade um.'; END IF;
  v_stock_hash := encode(sha256(convert_to(jsonb_build_object('custodia',v_custody.id,'material',v_custody.material_id,'quantidade',_quantidade,'destino',_localizacao_destino_id,'data',_data_efetiva,'operacao','checkin')::text,'UTF8')),'hex');
  v_movement := public.apply_stock_movement(v_company_id,v_custody.material_id,'entrada',_quantidade,NULL,_localizacao_destino_id,'Check-in de material',NULL,_observacao,NULL,_data_efetiva,'checkin_checkout',v_custody.id,_client_uuid,v_stock_hash,NULL);
  v_new_returned := v_custody.quantidade_devolvida+_quantidade;
  PERFORM set_config('backstage.custody_projection_write','on',true);
  UPDATE public.material_custodias SET quantidade_devolvida=v_new_returned,
    status=CASE WHEN v_new_returned+quantidade_baixada=quantidade_retirada THEN 'concluida'::public.material_custody_status ELSE 'parcial'::public.material_custody_status END,
    encerrada_em=CASE WHEN v_new_returned+quantidade_baixada=quantidade_retirada THEN v_effective_at ELSE NULL END, updated_at=clock_timestamp()
  WHERE empresa_id=v_company_id AND id=v_custody.id RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write','off',true);
  INSERT INTO public.material_custodia_eventos(empresa_id,custodia_id,material_id,tipo,quantidade,localizacao_destino_id,condicao,ocorrencia,observacao,data_efetiva,executado_por,movimento_estoque_id,client_uuid,payload_hash)
  VALUES(v_company_id,v_custody.id,v_custody.material_id,'checkin',_quantidade,_localizacao_destino_id,v_condition,nullif(btrim(_ocorrencia),''),nullif(btrim(_observacao),''),v_effective_at,auth.uid(),v_movement.id,_client_uuid,v_hash);
  INSERT INTO public.system_logs(tipo,acao,descricao,user_id,empresa_id,dados) VALUES('custodia',CASE WHEN v_result.status='concluida' THEN 'material_checkin_total' ELSE 'material_checkin_parcial' END,CASE WHEN v_result.status='concluida' THEN 'Retorno total de material registrado' ELSE 'Retorno parcial de material registrado' END,auth.uid(),v_company_id,jsonb_build_object('custodia_id',v_result.id,'material_id',v_result.material_id,'quantidade',_quantidade,'condicao',v_condition,'ocorrencia',nullif(btrim(_ocorrencia),''),'movimento_estoque_id',v_movement.id));
  IF v_result.referencia_tipo='locacao_item' THEN SELECT locacao_id INTO v_rental_id FROM public.material_locacao_itens WHERE empresa_id=v_company_id AND id=v_result.referencia_id; IF v_rental_id IS NOT NULL THEN PERFORM public.sync_material_rental_status(v_company_id,v_rental_id); END IF; END IF;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 4. cancelar_checkout_material - requires the 'delete' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancelar_checkout_material(
  _custodia_id uuid,
  _justificativa text,
  _client_uuid uuid,
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
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_existing_event public.material_custodia_eventos%ROWTYPE;
  v_original public.estoque_movimentacoes%ROWTYPE;
  v_reversal public.estoque_movimentacoes%ROWTYPE;
  v_hash text;
  v_stock_hash text;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'delete') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para cancelar este check-out.';
  END IF;
  IF _custodia_id IS NULL OR _client_uuid IS NULL
     OR nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Operação, justificativa e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', _custodia_id,
    'justificativa', btrim(_justificativa),
    'data', _data_efetiva,
    'operacao', 'cancelamento'
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing_event
  FROM public.material_custodia_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash
       OR v_existing_event.tipo <> 'cancelamento' THEN
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
  IF v_custody.status <> 'aberta' OR v_custody.quantidade_devolvida <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI015',
      MESSAGE = 'Somente um check-out sem devoluções pode ser cancelado.';
  END IF;

  SELECT * INTO v_original
  FROM public.estoque_movimentacoes
  WHERE empresa_id = v_company_id
    AND material_id = v_custody.material_id
    AND id = v_custody.movimento_saida_id
  FOR UPDATE;
  IF NOT FOUND OR v_original.tipo_movimentacao <> 'saida'
     OR v_original.origem_modulo <> 'checkin_checkout' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI020',
      MESSAGE = 'O movimento original do check-out é inválido.';
  END IF;

  v_stock_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', v_custody.id,
    'movimento_original', v_original.id,
    'justificativa', btrim(_justificativa),
    'data', _data_efetiva,
    'operacao', 'cancelamento'
  )::text, 'UTF8')), 'hex');
  v_reversal := public.apply_stock_movement(
    v_company_id, v_custody.material_id, 'estorno',
    v_custody.quantidade_retirada,
    v_original.localizacao_destino_id,
    v_original.localizacao_origem_id,
    'Cancelamento de check-out', btrim(_justificativa), NULL, NULL,
    _data_efetiva, 'checkin_checkout', v_custody.id,
    _client_uuid, v_stock_hash, v_original.id
  );

  PERFORM set_config('backstage.custody_projection_write', 'on', true);
  UPDATE public.material_custodias
  SET status = 'cancelada',
      encerrada_em = v_effective_at,
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = v_custody.id
  RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write', 'off', true);

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade,
    localizacao_destino_id, justificativa, data_efetiva,
    executado_por, movimento_estoque_id, client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_custody.id, v_custody.material_id, 'cancelamento',
    v_custody.quantidade_retirada, v_original.localizacao_origem_id,
    btrim(_justificativa), v_effective_at, auth.uid(), v_reversal.id,
    _client_uuid, v_hash
  );

  INSERT INTO public.system_logs (
    tipo, acao, descricao, user_id, empresa_id, dados
  ) VALUES (
    'custodia', 'material_checkout_cancelado',
    'Check-out de material cancelado com estorno explícito',
    auth.uid(), v_company_id,
    jsonb_build_object(
      'custodia_id', v_result.id,
      'material_id', v_result.material_id,
      'movimento_estorno_id', v_reversal.id,
      'justificativa', btrim(_justificativa)
    )
  );
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. registrar_baixa_custodia_material - requires the 'delete' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_baixa_custodia_material(
  _custodia_id uuid,
  _quantidade integer,
  _classificacao text,
  _justificativa text,
  _client_uuid uuid,
  _observacao text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_custodias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_existing public.material_custodia_eventos%ROWTYPE;
  v_material public.materiais%ROWTYPE;
  v_status public.material_operational_status;
  v_hash text;
  v_pending integer;
  v_new_written_off integer;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
  v_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'delete') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para registrar esta baixa.';
  END IF;
  IF _custodia_id IS NULL OR _client_uuid IS NULL OR nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Custodia, justificativa e identificador sao obrigatorios.';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Informe uma quantidade baixada maior que zero.';
  END IF;
  BEGIN v_status := _classificacao::public.material_operational_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Classificacao de baixa invalida.';
  END;
  IF v_status NOT IN ('extraviado', 'avariado', 'baixado') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Classificacao de baixa invalida.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', _custodia_id, 'quantidade', _quantidade, 'classificacao', v_status,
    'justificativa', btrim(_justificativa), 'observacao', nullif(btrim(_observacao), ''),
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0));

  SELECT * INTO v_existing FROM public.material_custodia_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.tipo <> 'correcao' OR v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013', MESSAGE = 'Esta operacao ja foi enviada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = v_existing.custodia_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_custody FROM public.material_custodias
  WHERE empresa_id = v_company_id AND id = _custodia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005', MESSAGE = 'Operacao de custodia nao encontrada.';
  END IF;
  IF v_custody.status NOT IN ('aberta', 'parcial') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI014', MESSAGE = 'Esta operacao nao possui quantidade pendente.';
  END IF;
  v_pending := v_custody.quantidade_retirada - v_custody.quantidade_devolvida - v_custody.quantidade_baixada;
  IF _quantidade > v_pending THEN
    RAISE EXCEPTION USING ERRCODE = 'CI021', MESSAGE = 'A quantidade baixada supera a quantidade ainda em custodia.';
  END IF;
  IF v_custody.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI002', MESSAGE = 'Material individual deve usar quantidade um.';
  END IF;

  SELECT * INTO v_material FROM public.materiais
  WHERE empresa_id = v_company_id AND id = v_custody.material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'CI005', MESSAGE = 'Material nao encontrado.'; END IF;

  v_new_written_off := v_custody.quantidade_baixada + _quantidade;
  PERFORM set_config('backstage.custody_projection_write', 'on', true);
  UPDATE public.material_custodias
  SET quantidade_baixada = v_new_written_off,
      status = CASE WHEN quantidade_devolvida + v_new_written_off = quantidade_retirada
        THEN 'concluida'::public.material_custody_status ELSE 'parcial'::public.material_custody_status END,
      encerrada_em = CASE WHEN quantidade_devolvida + v_new_written_off = quantidade_retirada THEN v_effective_at ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = v_custody.id RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write', 'off', true);

  IF v_material.tipo_controle = 'individual' THEN
    UPDATE public.materiais SET status_operacional = v_status,
      justificativa_status = btrim(_justificativa), updated_at = clock_timestamp()
    WHERE empresa_id = v_company_id AND id = v_material.id;
  END IF;

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade, condicao,
    observacao, justificativa, data_efetiva, executado_por,
    movimento_estoque_id, status_operacional_resultante, client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_custody.id, v_custody.material_id, 'correcao', _quantidade,
    CASE WHEN v_status = 'avariado' THEN 'danificado'::public.material_custody_condition ELSE NULL END,
    nullif(btrim(_observacao), ''), btrim(_justificativa), v_effective_at, auth.uid(),
    NULL, v_status, _client_uuid, v_hash
  );

  INSERT INTO public.system_logs(tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('custodia', 'material_custodia_baixa', 'Baixa definitiva de custodia registrada', auth.uid(), v_company_id,
    jsonb_build_object('custodia_id', v_result.id, 'material_id', v_result.material_id,
      'quantidade', _quantidade, 'classificacao', v_status, 'justificativa', btrim(_justificativa)));

  IF v_result.referencia_tipo = 'locacao_item' THEN
    SELECT locacao_id INTO v_rental_id FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND id = v_result.referencia_id;
    IF v_rental_id IS NOT NULL THEN
      INSERT INTO public.material_locacao_eventos(
        empresa_id, locacao_id, item_id, custodia_id, tipo, descricao, dados,
        executado_por, data_efetiva, client_uuid, payload_hash
      ) VALUES (
        v_company_id, v_rental_id, v_result.referencia_id, v_result.id, 'correcao',
        'Baixa de custodia: ' || btrim(_justificativa),
        jsonb_build_object('quantidade', _quantidade, 'classificacao', v_status, 'justificativa', btrim(_justificativa)),
        auth.uid(), v_effective_at, _client_uuid, v_hash
      );
      PERFORM public.sync_material_rental_status(v_company_id, v_rental_id);
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 6. iniciar_sessao_scanner_remoto - requires 'create'/'edit' per tipo_operacao
-- ============================================================================

CREATE OR REPLACE FUNCTION public.iniciar_sessao_scanner_remoto(
  _tipo_operacao public.scanner_remoto_tipo_operacao,
  _condicao public.material_custody_condition,
  _client_uuid uuid,
  _responsavel_tipo public.material_custody_responsible_type DEFAULT NULL,
  _responsavel_id uuid DEFAULT NULL,
  _finalidade public.material_custody_purpose DEFAULT NULL,
  _localizacao_origem_id uuid DEFAULT NULL,
  _localizacao_destino_id uuid DEFAULT NULL,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _titulo text DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.scanner_remoto_sessoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_existing public.scanner_remoto_sessoes%ROWTYPE;
  v_result public.scanner_remoto_sessoes%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);

  -- Same per-action grant a desktop check-out/check-in would need - opening
  -- a session is the phone's equivalent of clicking the Check-out/Check-in
  -- button, so it should fail fast here rather than let the operator scan
  -- into a session every reading of which would then be rejected one by one
  -- by registrar_checkout_material/registrar_checkin_material.
  IF _tipo_operacao = 'checkout'
     AND NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para check-out.';
  END IF;
  IF _tipo_operacao = 'checkin'
     AND NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para check-in.';
  END IF;
  IF _tipo_operacao = 'misto'
     AND NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'create')
     AND NOT public.user_has_module_action(v_company_id, 'checkin_checkout', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para check-out nem check-in.';
  END IF;

  IF _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'SR004',
      MESSAGE = 'Identificador da operação é obrigatório.';
  END IF;
  IF _tipo_operacao IN ('checkout', 'misto') AND (
    _localizacao_origem_id IS NULL OR _responsavel_tipo IS NULL
    OR _responsavel_id IS NULL OR _finalidade IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'SR003',
      MESSAGE = 'Origem, responsável e finalidade são obrigatórios para check-out.';
  END IF;
  IF _tipo_operacao IN ('checkin', 'misto') AND _localizacao_destino_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'SR003',
      MESSAGE = 'Localização de destino é obrigatória para check-in.';
  END IF;
  IF (_referencia_tipo IS NULL) <> (_referencia_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'SR003',
      MESSAGE = 'Tipo e identificador da referência devem ser informados juntos.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'tipo_operacao', _tipo_operacao,
    'responsavel_tipo', _responsavel_tipo,
    'responsavel_id', _responsavel_id,
    'finalidade', _finalidade,
    'condicao', _condicao,
    'localizacao_origem_id', _localizacao_origem_id,
    'localizacao_destino_id', _localizacao_destino_id,
    'referencia_tipo', nullif(btrim(_referencia_tipo), ''),
    'referencia_id', _referencia_id,
    'observacao', nullif(btrim(_observacao), ''),
    'titulo', nullif(btrim(_titulo), '')
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':scanner-remoto-sessao:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing
  FROM public.scanner_remoto_sessoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.scanner_remoto_sessoes (
    empresa_id, tipo_operacao, responsavel_tipo, responsavel_id, finalidade,
    condicao, localizacao_origem_id, localizacao_destino_id, referencia_tipo,
    referencia_id, titulo, observacao, criado_por, client_uuid, payload_hash
  ) VALUES (
    v_company_id, _tipo_operacao, _responsavel_tipo, _responsavel_id, _finalidade,
    _condicao, _localizacao_origem_id, _localizacao_destino_id,
    nullif(btrim(_referencia_tipo), ''), _referencia_id,
    nullif(btrim(_titulo), ''), nullif(btrim(_observacao), ''),
    auth.uid(), _client_uuid, v_hash
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_custody_company(uuid, boolean) IS
  'Resolves the caller''s company for Check-in/Check-out and Scanner Remoto and confirms module/dependency/subscription state. The write branch admits admin_empresa/master_admin OR a usuario holding any explicit checkin_checkout create/edit/delete grant (user_module_permissions) - the specific action required is checked independently by each write RPC.';
