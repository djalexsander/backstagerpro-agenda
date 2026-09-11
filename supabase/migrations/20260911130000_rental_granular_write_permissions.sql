-- Backstage Pro - Locação de Materiais adopts the granular per-user
-- permission mechanism already proven by RFID, Check-in/Check-out, Controle
-- de Estoque and Manutenção (user_module_permissions/
-- user_has_module_action, 20260810090000_user_module_permissions.sql).
--
-- Locação already had a NARROW slice of this: E5.1
-- (20260902120000_scanner_remoto_locacao_granular_permissions.sql) let a
-- usuario with locacao_materiais create/edit use registrar_retirada/
-- registrar_devolucao_locacao_material ONLY - resolve_material_rental_company
-- itself was deliberately left untouched at the time because loosening its
-- coarse write gate globally would have exposed the ~13 OTHER write RPCs in
-- this module (each still role-only) to any single granular grant.
--
-- This migration finishes the job: every one of those remaining write RPCs
-- now gets its own precise per-action check, which is exactly what makes it
-- safe to loosen the coarse gate below (mirroring Check-in/Checkout's
-- resolve_custody_company exactly - a grant on one action never unlocks
-- another, because each RPC re-checks its own specific action independently
-- of the coarse "may this caller write SOMETHING here" gate).
--
--   criar_locacao_material                -> 'create' (new rental)
--   atualizar_rascunho_locacao_material    -> 'edit'   (draft fields)
--   salvar_item_locacao_material           -> 'edit'   (rental items)
--   remover_item_locacao_material          -> 'edit'   (rental items)
--   confirmar_reserva_locacao_material     -> 'edit'   (progress a draft)
--   marcar_locacao_pronta_retirada         -> 'edit'   (status transition)
--   concluir_locacao_material              -> 'edit'   (status transition)
--   cancelar_locacao_material              -> 'delete' (matches Check-in/
--                                                        Check-out's cancel
--                                                        -> delete precedent)
--   registrar_retirada_locacao_material    -> unchanged (already 'create'
--                                                        via E5.1)
--   registrar_devolucao_locacao_material   -> unchanged (already 'edit'
--                                                        via E5.1)
--
-- salvar_cliente is NOT extended to any locacao_materiais grant, on purpose:
-- it is shared with Clientes.tsx (client-service.ts), gated there by its own
-- role-only client-permissions.ts, a concern entirely unrelated to this
-- migration's scope. It gets a defensive re-check instead, so loosening the
-- coarse gate below cannot let a locacao_materiais grant also unlock client
-- management as an unintended side effect - its behavior is unchanged from
-- before this migration.
--
-- View is deliberately left untouched: can_read_company_module has no role
-- gate at all, and this migration does not change that.

CREATE OR REPLACE FUNCTION public.resolve_material_rental_company(
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
  IF NOT public.company_has_active_module(v_company_id, 'locacao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'controle_estoque')
     OR NOT public.company_has_active_module(v_company_id, 'checkin_checkout') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR009',
      MESSAGE = 'Locação e suas dependências precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (
       _write
       AND NOT (
         public.can_write_company_module(v_company_id, 'locacao_materiais')
         OR public.user_has_module_action(v_company_id, 'locacao_materiais', 'create')
         OR public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit')
         OR public.user_has_module_action(v_company_id, 'locacao_materiais', 'delete')
       )
     )
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'locacao_materiais')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_locacao_material(
  _cliente_id uuid,
  _retirada_prevista_em timestamptz,
  _devolucao_prevista_em timestamptz,
  _responsavel_tipo text,
  _responsavel_id uuid,
  _client_uuid uuid,
  _evento_id uuid DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_locacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_responsible_type public.material_custody_responsible_type;
  v_responsible_name text;
  v_hash text;
  v_existing public.material_locacoes%ROWTYPE;
  v_result public.material_locacoes%ROWTYPE;
  v_number text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para criar locações.';
  END IF;
  IF _cliente_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Cliente e identificador são obrigatórios.';
  END IF;
  IF _retirada_prevista_em IS NULL OR _devolucao_prevista_em IS NULL
     OR _devolucao_prevista_em <= _retirada_prevista_em THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Informe um período de locação válido.';
  END IF;
  BEGIN
    v_responsible_type := _responsavel_tipo::public.material_custody_responsible_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Responsável inválido.';
  END;
  v_responsible_name := public.resolve_custody_responsible_name(
    v_company_id, v_responsible_type, _responsavel_id
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.clientes
    WHERE empresa_id = v_company_id AND id = _cliente_id AND ativo
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Cliente ativo não encontrado na empresa.';
  END IF;
  IF _evento_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events WHERE empresa_id = v_company_id AND id = _evento_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Evento não encontrado na empresa.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'cliente', _cliente_id, 'retirada', _retirada_prevista_em,
    'devolucao', _devolucao_prevista_em, 'responsavel_tipo', v_responsible_type,
    'responsavel', _responsavel_id, 'evento', _evento_id,
    'observacoes', nullif(btrim(_observacoes), '')
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':rental:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013',
        MESSAGE = 'Esta locação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  v_number := public.next_material_rental_number(v_company_id, _retirada_prevista_em);
  INSERT INTO public.material_locacoes (
    empresa_id, cliente_id, evento_id, numero, retirada_prevista_em,
    devolucao_prevista_em, observacoes, responsavel_tipo,
    responsavel_usuario_id, responsavel_funcionario_id, responsavel_nome,
    client_uuid, payload_hash, created_by, updated_by
  ) VALUES (
    v_company_id, _cliente_id, _evento_id, v_number, _retirada_prevista_em,
    _devolucao_prevista_em, nullif(btrim(_observacoes), ''), v_responsible_type,
    CASE WHEN v_responsible_type = 'usuario' THEN _responsavel_id END,
    CASE WHEN v_responsible_type = 'funcionario' THEN _responsavel_id END,
    v_responsible_name, _client_uuid, v_hash, auth.uid(), auth.uid()
  ) RETURNING * INTO v_result;

  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por,
    client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, v_result.id, 'criacao', 'Locação criada em rascunho', auth.uid(),
    _client_uuid, v_hash, jsonb_build_object('numero', v_number, 'cliente_id', _cliente_id)
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_criada', 'Locação criada em rascunho', auth.uid(),
    v_company_id, jsonb_build_object('locacao_id', v_result.id, 'numero', v_number));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_rascunho_locacao_material(
  _locacao_id uuid,
  _cliente_id uuid,
  _retirada_prevista_em timestamptz,
  _devolucao_prevista_em timestamptz,
  _responsavel_tipo text,
  _responsavel_id uuid,
  _client_uuid uuid,
  _evento_id uuid DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_locacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_responsible_type public.material_custody_responsible_type;
  v_responsible_name text;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar esta locação.';
  END IF;
  IF _devolucao_prevista_em <= _retirada_prevista_em OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Período e identificador válidos são obrigatórios.';
  END IF;
  BEGIN
    v_responsible_type := _responsavel_tipo::public.material_custody_responsible_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Responsável inválido.';
  END;
  v_responsible_name := public.resolve_custody_responsible_name(v_company_id, v_responsible_type, _responsavel_id);
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE empresa_id = v_company_id AND id = _cliente_id AND ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Cliente ativo não encontrado na empresa.';
  END IF;
  IF _evento_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events WHERE empresa_id = v_company_id AND id = _evento_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Evento não encontrado na empresa.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'cliente', _cliente_id,
    'retirada', _retirada_prevista_em, 'devolucao', _devolucao_prevista_em,
    'responsavel_tipo', v_responsible_type, 'responsavel', _responsavel_id,
    'evento', _evento_id, 'observacoes', nullif(btrim(_observacoes), '')
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes
    WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;

  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status <> 'rascunho' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Somente rascunhos podem ser editados.';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET cliente_id = _cliente_id, evento_id = _evento_id,
      retirada_prevista_em = _retirada_prevista_em,
      devolucao_prevista_em = _devolucao_prevista_em,
      observacoes = nullif(btrim(_observacoes), ''),
      responsavel_tipo = v_responsible_type,
      responsavel_usuario_id = CASE WHEN v_responsible_type = 'usuario' THEN _responsavel_id END,
      responsavel_funcionario_id = CASE WHEN v_responsible_type = 'funcionario' THEN _responsavel_id END,
      responsavel_nome = v_responsible_name,
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'edicao', 'Dados do rascunho atualizados', auth.uid(),
    _client_uuid, v_hash, jsonb_build_object('cliente_id', _cliente_id)
  );
  RETURN v_rental;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_item_locacao_material(
  _locacao_id uuid,
  _material_id uuid,
  _quantidade integer,
  _modalidade_cobranca text,
  _unidades_cobranca numeric,
  _valor_unitario numeric,
  _desconto numeric,
  _client_uuid uuid,
  _observacoes text DEFAULT NULL,
  _item_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_locacao_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_material public.materiais%ROWTYPE;
  v_mode public.material_rental_billing_mode;
  v_availability record;
  v_result public.material_locacao_itens%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar os itens desta locação.';
  END IF;
  IF _locacao_id IS NULL OR _material_id IS NULL OR _client_uuid IS NULL OR COALESCE(_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Locação, material, quantidade e identificador são obrigatórios.';
  END IF;
  BEGIN
    v_mode := _modalidade_cobranca::public.material_rental_billing_mode;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Modalidade de cobrança inválida.';
  END;
  IF COALESCE(_unidades_cobranca, 0) <= 0 OR COALESCE(_valor_unitario, -1) < 0
     OR COALESCE(_desconto, -1) < 0
     OR _desconto > _quantidade::numeric * _unidades_cobranca * _valor_unitario THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Valores comerciais inválidos.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'item', _item_id, 'material', _material_id,
    'quantidade', _quantidade, 'modalidade', v_mode,
    'unidades', _unidades_cobranca, 'valor', _valor_unitario,
    'desconto', _desconto, 'observacoes', nullif(btrim(_observacoes), '')
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND id = v_existing_event.item_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status <> 'rascunho' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Itens só podem ser alterados no rascunho.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-material:' || _material_id::text, 0));
  SELECT * INTO v_material FROM public.materiais
  WHERE empresa_id = v_company_id AND id = _material_id FOR SHARE;
  IF NOT FOUND OR NOT v_material.ativo OR v_material.status_operacional <> 'disponivel' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR008', MESSAGE = 'Material indisponível para locação.';
  END IF;
  IF v_material.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR002', MESSAGE = 'Material individual deve ter quantidade um.';
  END IF;
  SELECT * INTO v_availability FROM public.material_rental_availability(
    v_company_id, _material_id, v_rental.retirada_prevista_em,
    v_rental.devolucao_prevista_em, v_rental.id
  );
  IF _quantidade > v_availability.disponivel THEN
    RAISE EXCEPTION USING ERRCODE = 'LR012',
      MESSAGE = format('Disponibilidade insuficiente no período. Disponível: %s.', v_availability.disponivel);
  END IF;

  PERFORM set_config('backstage.material_rental_write', 'on', true);
  IF _item_id IS NULL THEN
    INSERT INTO public.material_locacao_itens (
      empresa_id, locacao_id, material_id, quantidade_contratada,
      modalidade_cobranca, unidades_cobranca, valor_unitario, desconto, observacoes
    ) VALUES (
      v_company_id, _locacao_id, _material_id, _quantidade, v_mode,
      _unidades_cobranca, _valor_unitario, _desconto, nullif(btrim(_observacoes), '')
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE public.material_locacao_itens
    SET material_id = _material_id, quantidade_contratada = _quantidade,
        modalidade_cobranca = v_mode, unidades_cobranca = _unidades_cobranca,
        valor_unitario = _valor_unitario, desconto = _desconto,
        observacoes = nullif(btrim(_observacoes), ''), updated_at = clock_timestamp()
    WHERE empresa_id = v_company_id AND locacao_id = _locacao_id AND id = _item_id
    RETURNING * INTO v_result;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Item não encontrado.'; END IF;
  END IF;
  PERFORM public.recalculate_material_rental_totals(v_company_id, _locacao_id);
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, item_id, tipo, descricao, executado_por,
    client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, v_result.id, 'edicao',
    CASE WHEN _item_id IS NULL THEN 'Material adicionado à locação' ELSE 'Item da locação atualizado' END,
    auth.uid(), _client_uuid, v_hash,
    jsonb_build_object('material_id', _material_id, 'quantidade', _quantidade, 'subtotal', v_result.subtotal)
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_item_locacao_material(
  _locacao_id uuid,
  _item_id uuid,
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
  v_rental public.material_locacoes%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar os itens desta locação.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('locacao', _locacao_id, 'item', _item_id)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  IF EXISTS (SELECT 1 FROM public.material_locacao_eventos WHERE empresa_id = v_company_id AND client_uuid = _client_uuid AND payload_hash = v_hash) THEN
    RETURN true;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND OR v_rental.status <> 'rascunho' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Somente itens de rascunho podem ser removidos.';
  END IF;
  SELECT * INTO v_item FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND locacao_id = _locacao_id AND id = _item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Item não encontrado.'; END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  DELETE FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND id = _item_id;
  PERFORM public.recalculate_material_rental_totals(v_company_id, _locacao_id);
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'edicao', 'Item removido do rascunho', auth.uid(),
    _client_uuid, v_hash, jsonb_build_object('item_id', _item_id, 'material_id', v_item.material_id)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_locacao_pronta_retirada(
  _locacao_id uuid,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_locacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar esta locação.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('locacao', _locacao_id, 'acao', 'pronta')::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  IF EXISTS (SELECT 1 FROM public.material_locacao_eventos WHERE empresa_id = v_company_id AND client_uuid = _client_uuid AND payload_hash = v_hash) THEN
    SELECT * INTO v_rental FROM public.material_locacoes WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND OR v_rental.status <> 'reservada' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Somente locação reservada pode ficar pronta para retirada.';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes SET status = 'pronta_retirada', updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash
  ) VALUES (v_company_id, _locacao_id, 'pronta_retirada', 'Locação pronta para retirada', auth.uid(), _client_uuid, v_hash);
  RETURN v_rental;
END;
$$;

CREATE OR REPLACE FUNCTION public.concluir_locacao_material(
  _locacao_id uuid,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_locacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_pending bigint;
  v_all_delivered boolean;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar esta locação.';
  END IF;
  IF _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Identificador idempotente obrigatório.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'acao', 'concluir'
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013',
        MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes
    WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;

  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.';
  END IF;
  IF v_rental.status NOT IN ('em_andamento', 'parcialmente_devolvida') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014',
      MESSAGE = 'A locação não pode ser concluída neste estado.';
  END IF;

  SELECT COALESCE(sum(operational.com_cliente), 0),
         COALESCE(bool_and(operational.retirada >= item.quantidade_contratada), false)
  INTO v_pending, v_all_delivered
  FROM public.material_locacao_itens AS item
  CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
  WHERE item.empresa_id = v_company_id AND item.locacao_id = _locacao_id;
  IF v_pending <> 0 OR NOT v_all_delivered THEN
    RAISE EXCEPTION USING ERRCODE = 'LR017',
      MESSAGE = 'Conclua todas as retiradas e devoluções antes de encerrar a locação.';
  END IF;

  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'concluida', encerrada_em = clock_timestamp(),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por,
    client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'conclusao', 'Locação concluída operacionalmente',
    auth.uid(), _client_uuid, v_hash, '{}'::jsonb
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_concluida', 'Locação concluída sem pendência de custódia',
    auth.uid(), v_company_id, jsonb_build_object('locacao_id', _locacao_id));
  RETURN v_rental;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_cliente(
  _tipo_pessoa text,
  _nome text,
  _nome_fantasia text DEFAULT NULL,
  _cpf_cnpj text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _observacoes text DEFAULT NULL,
  _cliente_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.clientes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_person_type public.customer_person_type;
  v_document text := nullif(regexp_replace(COALESCE(_cpf_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_result public.clientes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  -- Not extended to a granular grant: salvar_cliente is shared with
  -- Clientes.tsx (client-service.ts), gated there by its own role-only
  -- client-permissions.ts, unrelated to this migration's scope. Loosening
  -- resolve_material_rental_company's coarse write gate below must not
  -- let a locacao_materiais grant also unlock client management here.
  IF NOT public.can_write_company_module(v_company_id, 'locacao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  BEGIN
    v_person_type := _tipo_pessoa::public.customer_person_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Tipo de pessoa inválido.';
  END;
  IF nullif(btrim(_nome), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Informe o nome do cliente.';
  END IF;
  IF v_document IS NOT NULL AND length(v_document) NOT IN (11, 14) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'CPF/CNPJ deve ter 11 ou 14 dígitos.';
  END IF;

  IF _cliente_id IS NULL THEN
    INSERT INTO public.clientes (
      empresa_id, tipo_pessoa, nome, nome_fantasia, cpf_cnpj, email,
      telefone, observacoes, created_by, updated_by
    ) VALUES (
      v_company_id, v_person_type, btrim(_nome), nullif(btrim(_nome_fantasia), ''),
      v_document, nullif(btrim(_email), ''), nullif(btrim(_telefone), ''),
      nullif(btrim(_observacoes), ''), auth.uid(), auth.uid()
    ) RETURNING * INTO v_result;
  ELSE
    PERFORM set_config('backstage.material_rental_write', 'on', true);
    UPDATE public.clientes
    SET tipo_pessoa = v_person_type,
        nome = btrim(_nome),
        nome_fantasia = nullif(btrim(_nome_fantasia), ''),
        cpf_cnpj = v_document,
        email = nullif(btrim(_email), ''),
        telefone = nullif(btrim(_telefone), ''),
        observacoes = nullif(btrim(_observacoes), ''),
        updated_by = auth.uid(), updated_at = clock_timestamp()
    WHERE empresa_id = v_company_id AND id = _cliente_id
    RETURNING * INTO v_result;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Cliente não encontrado.';
    END IF;
  END IF;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES (
    'locacao', CASE WHEN _cliente_id IS NULL THEN 'cliente_criado' ELSE 'cliente_atualizado' END,
    'Cadastro canônico de cliente salvo', auth.uid(), v_company_id,
    jsonb_build_object('cliente_id', v_result.id, 'tipo_pessoa', v_result.tipo_pessoa)
  );
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public.confirmar_reserva_locacao_material(
  _locacao_id uuid,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL::uuid,
  _forma_cobranca text DEFAULT 'avista',
  _vencimento date DEFAULT NULL,
  _parcelas jsonb DEFAULT NULL
)
 RETURNS material_locacoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_availability record;
  v_hash text;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para editar esta locação.';
  END IF;

  -- Condição de pagamento é definida NESTE fluxo (não depois) - só exigida
  -- quando o financeiro está de fato ativo para a empresa, para não pedir
  -- vencimento de quem não usa o módulo (o sync abaixo é best-effort e
  -- ignoraria os parâmetros de qualquer forma nesse caso).
  IF public.company_has_active_module(v_company_id, 'financeiro_avancado') THEN
    IF _forma_cobranca NOT IN ('avista', 'parcelado') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN010', MESSAGE = 'Condição de pagamento inválida.';
    END IF;
    IF _forma_cobranca = 'avista' AND _vencimento IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'FN015', MESSAGE = 'Informe o vencimento da cobrança à vista.';
    END IF;
    IF _forma_cobranca = 'parcelado' AND (_parcelas IS NULL OR jsonb_array_length(_parcelas) = 0) THEN
      RAISE EXCEPTION USING ERRCODE = 'FN011', MESSAGE = 'Informe ao menos uma parcela.';
    END IF;
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'acao', 'reservar',
    'forma_cobranca', _forma_cobranca, 'vencimento', _vencimento, 'parcelas', _parcelas
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status <> 'rascunho' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Somente rascunhos podem ser reservados.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.material_locacao_itens WHERE empresa_id = v_company_id AND locacao_id = _locacao_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Adicione ao menos um material antes de reservar.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND locacao_id = _locacao_id
    ORDER BY material_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-material:' || v_item.material_id::text, 0));
    SELECT * INTO v_availability FROM public.material_rental_availability(
      v_company_id, v_item.material_id, v_rental.retirada_prevista_em,
      v_rental.devolucao_prevista_em, v_rental.id
    );
    IF v_item.quantidade_contratada > v_availability.disponivel THEN
      RAISE EXCEPTION USING ERRCODE = 'LR012',
        MESSAGE = format('Disponibilidade insuficiente para o material %s. Disponível: %s.', v_item.material_id, v_availability.disponivel);
    END IF;
  END LOOP;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'reservada', updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'reserva', 'Reserva confirmada para o período',
    auth.uid(), _client_uuid, v_hash,
    jsonb_build_object('retirada_prevista_em', v_rental.retirada_prevista_em, 'devolucao_prevista_em', v_rental.devolucao_prevista_em)
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_reservada', 'Reserva de materiais confirmada', auth.uid(),
    v_company_id, jsonb_build_object('locacao_id', _locacao_id, 'numero', v_rental.numero));

  -- Ponto único de geração do lançamento financeiro, já com a condição de
  -- pagamento definida neste mesmo fluxo: a reserva confirmada é a
  -- primeira obrigação comercial real da locação (rascunho ainda não é).
  PERFORM public.sync_material_rental_financial_entry(v_company_id, _locacao_id, _forma_cobranca, _vencimento, _parcelas);

  RETURN v_rental;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_locacao_material(_locacao_id uuid, _justificativa text, _client_uuid uuid, _empresa_id uuid DEFAULT NULL::uuid)
 RETURNS material_locacoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF NOT public.user_has_module_action(v_company_id, 'locacao_materiais', 'delete') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para cancelar esta locação.';
  END IF;
  IF nullif(btrim(_justificativa), '') IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Justificativa e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'justificativa', btrim(_justificativa)
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status NOT IN ('rascunho', 'reservada', 'pronta_retirada') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não pode ser cancelada neste estado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_custodias AS custody
    JOIN public.material_locacao_itens AS item ON item.id = custody.referencia_id
    WHERE item.empresa_id = v_company_id AND item.locacao_id = _locacao_id
      AND custody.referencia_tipo = 'locacao_item'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR016',
      MESSAGE = 'Locação com retirada registrada não pode ser cancelada administrativamente.';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'cancelada', encerrada_em = clock_timestamp(),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por,
    client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'cancelamento', 'Locação cancelada e reservas liberadas',
    auth.uid(), _client_uuid, v_hash, jsonb_build_object('justificativa', btrim(_justificativa))
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_cancelada', 'Locação cancelada sem apagar histórico',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'numero', v_rental.numero, 'justificativa', btrim(_justificativa)));

  -- Marca o título como cancelado (ou cancelado_pendente_regularizacao, se
  -- já havia valor recebido) - nunca estorna automaticamente, nunca apaga
  -- o que já foi recebido. O estorno, se necessário, é uma decisão
  -- separada e explícita do administrador via estornar_recebimento_locacao.
  PERFORM public.sync_material_rental_financial_entry(v_company_id, _locacao_id);

  RETURN v_rental;
END;
$function$;

COMMENT ON FUNCTION public.resolve_material_rental_company(uuid, boolean) IS
  'Resolves the caller''s company for Locação and confirms module/dependency/subscription state. The write branch admits admin_empresa/master_admin OR a usuario holding any explicit locacao_materiais create/edit/delete grant (user_module_permissions) - the specific action required is checked independently by each write RPC.';
