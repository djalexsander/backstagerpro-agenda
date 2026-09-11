-- Backstage Pro - Controle de Estoque adopts the granular per-user
-- permission mechanism already proven by RFID and Check-in/Check-out
-- (user_module_permissions/user_has_module_action,
-- 20260810090000_user_module_permissions.sql,
-- 20260819100000_checkin_checkout_granular_write_permissions.sql).
--
-- Problem: resolve_stock_company(_empresa_id, _write) gates every write RPC
-- in this module through can_write_company_module, which requires
-- has_role(admin_empresa) OR is_master_admin() unconditionally
-- (20260808100000_enforce_master_tenant_isolation.sql). A plain "usuario"
-- can therefore never register/adjust/reverse a stock movement, even after
-- an admin_empresa explicitly grants create/edit/delete on 'controle_estoque'
-- via "Editar Usuário" (UserModulePermissionsFields.tsx already lists every
-- active module, controle_estoque included - it has had no backend effect
-- until now).
--
-- Fix, mirroring the Check-in/Check-out precedent exactly:
--   1. resolve_stock_company's write branch stops requiring
--      can_write_company_module specifically and instead accepts it OR any
--      of the three granular write grants on 'controle_estoque'.
--   2. Each of the three RPCs that actually perform a write adds its own
--      precise action check right after resolving the company:
--        registrar_movimentacao_estoque  -> 'create' (new movement record)
--        ajustar_estoque_material        -> 'edit'   (correcting a balance)
--        estornar_movimentacao_estoque   -> 'delete' (reversing a movement)
--
-- View is deliberately left untouched: can_read_company_module has no role
-- gate at all, and this migration does not change that.
--
-- Deliberately NOT touched: estoque_localizacoes (stock location) CRUD -
-- that goes through direct RLS policies literally named "Company admins
-- create/update/delete stock locations"
-- (20260806060000_fix_stock_locations_rls_execute_permission.sql), a
-- company-configuration concern, not a day-to-day operational action a
-- "usuario" would be granted. listar_estoque_resumo (read-only) is untouched
-- for the same reason as every other read RPC in this family.

-- ============================================================================
-- 1. resolve_stock_company - loosen the write gate to admit a granular grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_stock_company(
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
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;

  IF NOT public.company_has_active_module(v_company_id, 'controle_estoque') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST009',
      MESSAGE = 'O módulo Controle de Estoque não está ativo para esta empresa.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST009',
      MESSAGE = 'A dependência Gestão de Materiais não está ativa para esta empresa.';
  END IF;

  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;

  IF (
       _write
       AND NOT (
         public.can_write_company_module(v_company_id, 'controle_estoque')
         OR public.user_has_module_action(v_company_id, 'controle_estoque', 'create')
         OR public.user_has_module_action(v_company_id, 'controle_estoque', 'edit')
         OR public.user_has_module_action(v_company_id, 'controle_estoque', 'delete')
       )
     )
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'controle_estoque')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;

  RETURN v_company_id;
END;
$$;

-- ============================================================================
-- 2. registrar_movimentacao_estoque - requires the 'create' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_movimentacao_estoque(
  _material_id uuid,
  _tipo text,
  _quantidade integer,
  _client_uuid uuid,
  _localizacao_origem_id uuid DEFAULT NULL,
  _localizacao_destino_id uuid DEFAULT NULL,
  _motivo text DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _documento_referencia text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _origem_modulo text DEFAULT 'manual',
  _origem_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.estoque_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_type public.estoque_movimentacao_tipo;
  v_source public.estoque_origem_modulo;
  v_hash text;
BEGIN
  v_company_id := public.resolve_stock_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'controle_estoque', 'create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para registrar movimentações de estoque.';
  END IF;
  BEGIN
    v_type := _tipo::public.estoque_movimentacao_tipo;
    v_source := _origem_modulo::public.estoque_origem_modulo;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Tipo de movimentação inválido.';
  END;
  IF v_type IS NULL OR v_source IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Tipo e origem da movimentação são obrigatórios.';
  END IF;
  IF v_type NOT IN ('entrada', 'saida', 'transferencia', 'saldo_inicial') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Use a operação específica para ajustes ou estornos.';
  END IF;
  IF v_type IN ('entrada', 'saida')
     AND nullif(btrim(_motivo), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Informe o motivo da movimentação.';
  END IF;
  IF (v_type IN ('entrada', 'saldo_inicial')
      AND (_localizacao_origem_id IS NOT NULL OR _localizacao_destino_id IS NULL))
     OR (v_type = 'saida'
      AND (_localizacao_origem_id IS NULL OR _localizacao_destino_id IS NOT NULL))
     OR (v_type = 'transferencia'
      AND (_localizacao_origem_id IS NULL OR _localizacao_destino_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST005',
      MESSAGE = 'Informe corretamente as localizações da movimentação.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'material', _material_id, 'tipo', v_type, 'quantidade', _quantidade,
    'origem', _localizacao_origem_id, 'destino', _localizacao_destino_id,
    'motivo', _motivo, 'observacao', _observacao,
    'documento', _documento_referencia, 'data', _data_efetiva,
    'origem_modulo', v_source, 'origem_id', _origem_id
  )::text, 'UTF8')), 'hex');
  RETURN public.apply_stock_movement(
    v_company_id, _material_id, v_type, _quantidade,
    _localizacao_origem_id, _localizacao_destino_id,
    _motivo, NULL, _observacao, _documento_referencia, _data_efetiva,
    v_source, _origem_id, _client_uuid, v_hash, NULL
  );
END;
$$;

-- ============================================================================
-- 3. ajustar_estoque_material - requires the 'edit' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ajustar_estoque_material(
  _material_id uuid,
  _localizacao_id uuid,
  _quantidade_fisica integer,
  _motivo text,
  _justificativa text,
  _client_uuid uuid,
  _observacao text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.estoque_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_current integer;
  v_difference integer;
  v_type public.estoque_movimentacao_tipo;
  v_hash text;
  v_existing public.estoque_movimentacoes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_stock_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'controle_estoque', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para ajustar o estoque.';
  END IF;
  IF _material_id IS NULL OR _localizacao_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Material, localização e identificador da operação são obrigatórios.';
  END IF;
  IF _quantidade_fisica IS NULL OR _quantidade_fisica < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'A quantidade física deve ser um número inteiro não negativo.';
  END IF;
  IF nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Informe a justificativa do ajuste.';
  END IF;
  IF nullif(btrim(_motivo), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Informe o motivo do ajuste.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'material', _material_id, 'localizacao', _localizacao_id,
    'quantidade_fisica', _quantidade_fisica,
    'motivo', _motivo,
    'justificativa', _justificativa, 'observacao', _observacao,
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing FROM public.estoque_movimentacoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'ST013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  PERFORM 1 FROM public.materiais
  WHERE empresa_id = v_company_id AND id = _material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ST005', MESSAGE = 'Material não encontrado.';
  END IF;
  SELECT COALESCE(quantidade, 0) INTO v_current
  FROM public.estoque_saldos
  WHERE empresa_id = v_company_id
    AND material_id = _material_id
    AND localizacao_id = _localizacao_id
  FOR UPDATE;
  v_current := COALESCE(v_current, 0);
  v_difference := _quantidade_fisica - v_current;
  IF v_difference = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'A quantidade informada já corresponde ao saldo atual.';
  END IF;
  v_type := CASE WHEN v_difference > 0
    THEN 'ajuste_positivo'::public.estoque_movimentacao_tipo
    ELSE 'ajuste_negativo'::public.estoque_movimentacao_tipo END;
  RETURN public.apply_stock_movement(
    v_company_id, _material_id, v_type, abs(v_difference),
    CASE WHEN v_difference < 0 THEN _localizacao_id ELSE NULL END,
    CASE WHEN v_difference > 0 THEN _localizacao_id ELSE NULL END,
    _motivo, _justificativa, _observacao, NULL,
    _data_efetiva, 'controle_estoque', NULL, _client_uuid, v_hash, NULL
  );
END;
$$;

-- ============================================================================
-- 4. estornar_movimentacao_estoque - requires the 'delete' grant
-- ============================================================================

CREATE OR REPLACE FUNCTION public.estornar_movimentacao_estoque(
  _movimentacao_id uuid,
  _justificativa text,
  _client_uuid uuid,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.estoque_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_original public.estoque_movimentacoes%ROWTYPE;
  v_existing public.estoque_movimentacoes%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_stock_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'controle_estoque', 'delete') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para estornar movimentações de estoque.';
  END IF;
  IF _movimentacao_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Movimentação e identificador da operação são obrigatórios.';
  END IF;
  IF nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Informe a justificativa do estorno.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'movimentacao', _movimentacao_id,
    'justificativa', _justificativa, 'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing FROM public.estoque_movimentacoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'ST013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_original
  FROM public.estoque_movimentacoes
  WHERE empresa_id = v_company_id AND id = _movimentacao_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ST005',
      MESSAGE = 'Movimentação não encontrada.';
  END IF;
  IF v_original.tipo_movimentacao = 'estorno' THEN
    RAISE EXCEPTION USING ERRCODE = 'ST015',
      MESSAGE = 'Um estorno não pode ser estornado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes
    WHERE movimentacao_estornada_id = v_original.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST014',
      MESSAGE = 'Esta movimentação já foi estornada.';
  END IF;
  RETURN public.apply_stock_movement(
    v_company_id, v_original.material_id, 'estorno',
    v_original.quantidade,
    v_original.localizacao_destino_id,
    v_original.localizacao_origem_id,
    'Estorno de movimentação', _justificativa, NULL, NULL,
    _data_efetiva, 'controle_estoque', v_original.id,
    _client_uuid, v_hash, v_original.id
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_stock_company(uuid, boolean) IS
  'Resolves the caller''s company for Controle de Estoque and confirms module/dependency/subscription state. The write branch admits admin_empresa/master_admin OR a usuario holding any explicit controle_estoque create/edit/delete grant (user_module_permissions) - the specific action required is checked independently by each write RPC.';
