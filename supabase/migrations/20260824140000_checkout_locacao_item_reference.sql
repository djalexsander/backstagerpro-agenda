-- Backstage Pro - fecha no servidor a lacuna que permitia criar uma
-- custódia com finalidade='locacao' sem nenhum vínculo real a uma locação.
--
-- Contexto: a UI do Check-out genérico já não oferece mais 'locacao'
-- ("Locação futura") como opção selecionável (CheckoutDialog.tsx). O fluxo
-- oficial de retirada de locação usa registrar_retirada_locacao_material
-- (20260802200000_material_rentals_stage_four.sql), que resolve e tranca o
-- item da locação e então chama esta própria RPC assim:
--
--   registrar_checkout_material(
--     v_item.material_id, _quantidade, _localizacao_origem_id,
--     _responsavel_tipo, _responsavel_id, 'locacao', _condicao_saida,
--     _client_uuid, v_rental.devolucao_prevista_em, _observacao,
--     'locacao_item', v_item.id, _data_efetiva, v_company_id
--   )
--
-- ou seja: finalidade='locacao', referencia_tipo='locacao_item',
-- referencia_id=<material_locacao_itens.id>, e o material passado sempre é
-- exatamente material_locacao_itens.material_id desse item. Até aqui,
-- porém, registrar_checkout_material nunca validou nada disso além do
-- formato do par referencia_tipo/referencia_id (20260821090000) - uma
-- chamada direta à RPC (fora da UI, fora da fachada de locação) ainda podia
-- forjar finalidade='locacao' sem nenhum item real por trás, produzindo uma
-- custódia indistinguível de uma retirada oficial de locação no histórico.
--
-- Esta migration espelha, para 'locacao', exatamente a mesma checagem
-- bidirecional já aplicada a 'evento' em 20260821090000: finalidade='locacao'
-- passa a exigir referencia_tipo='locacao_item' com um item real de
-- material_locacao_itens desta empresa, para o mesmo material que está
-- saindo - e referencia_tipo='locacao_item' nunca aparece com outra
-- finalidade. A checagem de material (material_locacao_itens.material_id =
-- _material_id) é possível sem novo parâmetro nem nova tabela porque o item
-- já carrega essa coluna e a fachada oficial já garante essa igualdade por
-- construção - logo a checagem é sempre satisfeita no caminho legítimo e só
-- rejeita uma chamada forjada.
--
-- Nenhuma outra finalidade muda de comportamento: cliente, funcionario,
-- manutencao, transferencia_operacional, outro e uso_interno continuam sem
-- exigir referência alguma, exatamente como antes. A validação de 'evento'
-- (bloco anterior, inalterado) e todo o resto do corpo da função permanecem
-- byte-a-byte iguais a 20260821090000_checkout_event_reference.sql - só o
-- novo bloco 'locacao' foi inserido logo depois do bloco 'evento'.
--
-- registrar_retirada_locacao_material NÃO muda nesta migration: ela
-- continua chamando registrar_checkout_material do mesmo jeito, e essa
-- chamada sempre satisfaz a nova checagem (prova: o item que ela passa em
-- referencia_id é o mesmo cujo material_id ela passa como _material_id).
--
-- Novo código de erro CI023 ("Finalidade locação exige um item de locação
-- válido desta empresa para este material."). Ainda sem tradução em
-- src/lib/checkin-checkout-errors.ts - esse arquivo já documenta que um
-- código novo cai no fallbackMessage genérico até alguém adicionar a
-- tradução; como a UI não oferece mais 'locacao' como finalidade
-- selecionável, este código não é alcançável pelo Check-out genérico hoje,
-- só por uma chamada direta à RPC. Ver frontend nesta mesma auditoria
-- (tarefa separada, fora do escopo desta migration).
--
-- GRANT/REVOKE: não redeclarados aqui, seguindo o mesmo padrão já usado
-- pelas duas redefinições anteriores desta função (20260819100000 e
-- 20260821090000, nenhuma das duas reemite GRANT/REVOKE) - a assinatura
-- (mesmos 14 parâmetros, mesma ordem, mesmos tipos, mesmos defaults)
-- permanece idêntica, então o CREATE OR REPLACE preserva os privilégios já
-- concedidos em 20260802160000_material_checkin_checkout_stage_three.sql
-- (REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO
-- authenticated) sem precisar tocar neles de novo.

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
  -- Evento é a única finalidade, por ora, com contexto obrigatório: exige
  -- referencia_tipo='evento' com um evento real desta empresa em
  -- referencia_id, nas duas direções (finalidade sem referência, ou
  -- referência sem a finalidade correspondente, são igualmente rejeitadas).
  IF v_purpose = 'evento' OR nullif(btrim(_referencia_tipo), '') = 'evento' THEN
    IF v_purpose <> 'evento'
       OR nullif(btrim(_referencia_tipo), '') IS DISTINCT FROM 'evento'
       OR _referencia_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.events
         WHERE id = _referencia_id AND empresa_id = v_company_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'CI022',
        MESSAGE = 'Selecione um evento válido desta empresa.';
    END IF;
  END IF;
  -- Locação usa o mesmo par polimórfico (referencia_tipo='locacao_item'),
  -- espelhando a checagem de Evento acima: finalidade='locacao' sempre
  -- exige um item real de material_locacao_itens desta empresa, para o
  -- mesmo material que está saindo - e referencia_tipo='locacao_item' nunca
  -- aparece com outra finalidade. A única chamadora legítima hoje,
  -- registrar_retirada_locacao_material, já resolve e tranca o item antes
  -- de chegar aqui e sempre passa o material desse mesmo item, então esta
  -- checagem é sempre satisfeita nesse caminho - ela só rejeita uma chamada
  -- direta que tente forjar finalidade='locacao' sem um item de locação
  -- real (a UI do Check-out genérico não oferece mais esta finalidade).
  IF v_purpose = 'locacao' OR nullif(btrim(_referencia_tipo), '') = 'locacao_item' THEN
    IF v_purpose <> 'locacao'
       OR nullif(btrim(_referencia_tipo), '') IS DISTINCT FROM 'locacao_item'
       OR _referencia_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.material_locacao_itens
         WHERE id = _referencia_id
           AND empresa_id = v_company_id
           AND material_id = _material_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'CI023',
        MESSAGE = 'Finalidade locação exige um item de locação válido desta empresa para este material.';
    END IF;
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
