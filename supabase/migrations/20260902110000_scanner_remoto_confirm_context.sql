-- Backstage Pro - Scanner Remoto: a confirmação final da sessão automática
-- passa a executar a movimentação, com o contexto resolvido por leitura.
--
-- Etapa E5 do novo fluxo (ler -> identificar -> escolher check-in/check-out ->
-- completar contexto -> CONFIRMAR -> gravar). Até a E4.5 o contexto da
-- operação era montado só no estado do cliente (pendingRead.operationContext)
-- e nada era gravado. Esta migration liga o botão de confirmação final: o
-- cliente manda o contexto por leitura e registrar_leitura_scanner_remoto
-- delega para a RPC de movimentação correta - continua nunca movimentando
-- custódia por conta própria.
--
-- ============================================================================
-- POR QUE UMA TROCA DE ASSINATURA (e o DROP explícito)
-- ============================================================================
--
-- registrar_leitura_scanner_remoto ganha um único parâmetro novo,
-- _contexto jsonb DEFAULT NULL. Um parâmetro só (e jsonb, não 6 escalares)
-- porque o contexto é uma união discriminada (check-in x check-out, com
-- evento/locação opcionais) que mapeia 1:1 para ScannerOperationContext no
-- cliente, e porque assim a E6/E7 podem estender o contexto sem outra troca
-- de assinatura.
--
-- Adicionar um parâmetro É trocar a assinatura: a versão de 6 argumentos
-- (20260824090000_scanner_remoto_quantity_confirmation.sql) e a nova de 7
-- coexistiriam como overloads e uma chamada por nome (todo chamador usa
-- supabase.rpc com objeto) poderia ficar ambígua ("Could not choose the best
-- candidate function"). Mesmo cuidado já tomado quando _quantidade/_custodia_id
-- foram adicionados em 20260824090000 e em
-- confirmar_reserva_locacao_material (20260806090000). Por isso: DROP
-- explícito da assinatura de 6 args antes do CREATE, e GRANT/REVOKE
-- reemitidos para a assinatura nova de 7 (o DROP leva junto os grants
-- antigos).
--
-- ============================================================================
-- IDEMPOTÊNCIA (revisada antes de tocar na assinatura)
-- ============================================================================
--
-- Modelo atual, preservado: scanner_remoto_leituras tem UNIQUE(empresa_id,
-- client_uuid); _client_uuid é usado tanto na linha de leitura quanto
-- repassado à RPC de movimentação delegada, que tem a PRÓPRIA
-- UNIQUE(empresa_id, client_uuid) na sua tabela-alvo (material_custodias /
-- material_custodia_eventos / material_locacao_eventos). Um mesmo client_uuid
-- em tabelas diferentes não colide - é assim que o fluxo não-locação já
-- funciona hoje. Numa repetição com o MESMO client_uuid e MESMO payload, a
-- checagem de idempotência da própria leitura devolve a linha já gravada
-- antes de qualquer reprocessamento; com payload diferente, CI013.
--
-- As RPCs de locação delegadas (registrar_retirada_locacao_material,
-- registrar_devolucao_locacao_material) repassam _client_uuid adiante e são,
-- elas mesmas, idempotentes por (empresa_id, client_uuid) em
-- material_locacao_eventos + revalidação de item/custódia - então um retry
-- com client_uuid reaproveitado é barrado nas duas camadas, nunca gera
-- movimento duplo. O erro de uma RPC delegada continua sendo um resultado
-- normal registrado (acao_executada='erro'), não uma exceção: o BEGIN..
-- EXCEPTION WHEN OTHERS desfaz o trabalho parcial da delegada (savepoint
-- implícito) e a leitura é gravada como 'erro'. Para um novo retry de
-- verdade o cliente gera um client_uuid novo (o app já faz isso por
-- chamada), preservando "erro mantém para retry".
--
-- O hash de payload passa a incluir _contexto SOMENTE quando ele é informado
-- - quando _contexto IS NULL o hash é byte a byte o de 20260824090000, então
-- toda leitura de sessão configurada (fluxo antigo, sem _contexto) tem
-- idempotência idêntica à de antes.
--
-- ============================================================================
-- COMPATIBILIDADE COM SESSÕES CONFIGURADAS (fluxo antigo)
-- ============================================================================
--
-- _contexto IS NULL => o corpo é exatamente o de 20260824090000: a sessão
-- decide checkout x checkin (explícita, ou 'misto' auto pela custódia aberta)
-- e reaplica responsavel/finalidade/condicao/localizacao da própria sessão.
-- Nenhum chamador atual manda _contexto (o serviço só passa a mandar nesta
-- mesma leva de mudança, e apenas na confirmação da sessão automática
-- neutra). Sessão configurada = zero mudança de comportamento.
--
-- ============================================================================
-- PERMISSÕES DE LOCAÇÃO (não alteradas nesta etapa - só reportadas)
-- ============================================================================
--
-- registrar_retirada_locacao_material e registrar_devolucao_locacao_material
-- chamam resolve_material_rental_company(_empresa_id, true), que exige
-- can_write_company_module('locacao_materiais') -> can_write_company_data ->
-- has_role(auth.uid(), 'admin_empresa') (ou master admin). Um 'usuario'
-- comum com grants granulares de checkin_checkout (create/edit) mas SEM o
-- papel admin_empresa consegue check-in/check-out normal e evento pelo
-- Scanner Remoto (essas rotas usam user_has_module_action, afrouxado para
-- grants granulares em 20260819100000), mas NÃO consegue a rota
-- "Cliente -> Locação" nem a devolução de item de locação: a RPC delegada
-- levanta 42501, que aqui vira uma leitura acao_executada='erro' com a
-- mensagem de permissão (o operador vê e o app mantém a leitura pendente).
-- Afrouxar isso com um grant granular é a etapa E7, deliberadamente fora
-- desta migration.

DROP FUNCTION IF EXISTS public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.registrar_leitura_scanner_remoto(
  _sessao_id uuid,
  _codigo_lido text,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL,
  _quantidade integer DEFAULT 1,
  _custodia_id uuid DEFAULT NULL,
  _contexto jsonb DEFAULT NULL
)
RETURNS public.scanner_remoto_leituras
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_session public.scanner_remoto_sessoes%ROWTYPE;
  v_existing public.scanner_remoto_leituras%ROWTYPE;
  v_result public.scanner_remoto_leituras%ROWTYPE;
  v_material public.materiais%ROWTYPE;
  v_custody public.material_custodias%ROWTYPE;
  v_normalized text;
  v_stripped text;
  v_acao public.scanner_remoto_acao;
  v_custodia_id uuid;
  v_resultado jsonb;
  v_hash text;
  v_checkout_result public.material_custodias%ROWTYPE;
  v_checkin_result public.material_custodias%ROWTYPE;
  v_ctx_operation text;
  v_ctx_finalidade text;
  v_ctx_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);

  IF _sessao_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'SR004',
      MESSAGE = 'Sessão e identificador da leitura são obrigatórios.';
  END IF;
  v_normalized := lower(btrim(coalesce(_codigo_lido, '')));
  IF v_normalized = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'SR004',
      MESSAGE = 'Código lido não pode ser vazio.';
  END IF;

  -- Hash do payload: com _contexto informado ele entra no hash (um retry com
  -- o mesmo client_uuid e contexto diferente = CI013, nunca um retorno
  -- silencioso do errado). Sem _contexto, o hash é byte a byte o de
  -- 20260824090000 - idempotência das sessões configuradas inalterada.
  IF _contexto IS NULL THEN
    v_hash := encode(sha256(convert_to(
      jsonb_build_object(
        'sessao_id', _sessao_id, 'codigo_lido', v_normalized,
        'quantidade', _quantidade, 'custodia_id', _custodia_id
      )::text,
      'UTF8'
    )), 'hex');
  ELSE
    v_hash := encode(sha256(convert_to(
      jsonb_build_object(
        'sessao_id', _sessao_id, 'codigo_lido', v_normalized,
        'quantidade', _quantidade, 'custodia_id', _custodia_id,
        'contexto', _contexto
      )::text,
      'UTF8'
    )), 'hex');
  END IF;

  -- Retry-safe: a leitura repetida com o mesmo client_uuid (ex.: conexão
  -- instável no celular reenviando) devolve a linha já gravada em vez de
  -- processar de novo - mas só se os dados forem os mesmos (mesmo padrão de
  -- registrar_checkout_material/registrar_checkin_material: client_uuid
  -- reaproveitado com payload diferente é um erro, CI013, não um retry).
  SELECT * INTO v_existing
  FROM public.scanner_remoto_leituras
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT * INTO v_session
  FROM public.scanner_remoto_sessoes
  WHERE empresa_id = v_company_id AND id = _sessao_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'SR001', MESSAGE = 'Sessão não encontrada.';
  END IF;
  IF v_session.status <> 'aberta' THEN
    RAISE EXCEPTION USING ERRCODE = 'SR002',
      MESSAGE = 'Esta sessão de scanner remoto já foi encerrada.';
  END IF;

  -- Mesma regra de candidatos que custodyIdentifierCandidates()/
  -- materialMatchesCustodyIdentifier() já usam no cliente hoje
  -- (checkin-checkout-domain.ts), agora como autoridade server-side: match
  -- exato (case-insensitive) contra id, identificador_unico, QR completo,
  -- código de barras, código interno, patrimônio ou série; se o código
  -- vier com o prefixo do QR (BACKSTAGE-PRO:MATERIAL:...), tenta de novo
  -- sem o prefixo. Não replica o fallback "nome contém" do cliente -
  -- resolução remota exige um match exato, não uma busca aproximada.
  IF v_normalized LIKE 'backstage-pro:material:%' THEN
    v_stripped := replace(v_normalized, 'backstage-pro:material:', '');
  ELSE
    v_stripped := NULL;
  END IF;

  SELECT * INTO v_material
  FROM public.materiais
  WHERE empresa_id = v_company_id
    AND (
      lower(id::text) = v_normalized
      OR lower(identificador_unico::text) = v_normalized
      OR lower(coalesce(conteudo_qr_code, '')) = v_normalized
      OR lower(coalesce(codigo_barras, '')) = v_normalized
      OR lower(codigo_interno) = v_normalized
      OR lower(coalesce(numero_patrimonio, '')) = v_normalized
      OR lower(coalesce(numero_serie, '')) = v_normalized
      OR (
        v_stripped IS NOT NULL AND (
          lower(id::text) = v_stripped
          OR lower(identificador_unico::text) = v_stripped
          OR lower(coalesce(codigo_barras, '')) = v_stripped
          OR lower(codigo_interno) = v_stripped
          OR lower(coalesce(numero_patrimonio, '')) = v_stripped
          OR lower(coalesce(numero_serie, '')) = v_stripped
        )
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.scanner_remoto_leituras (
      empresa_id, sessao_id, lido_por, codigo_lido, material_id,
      acao_executada, custodia_id, resultado, client_uuid, payload_hash
    ) VALUES (
      v_company_id, _sessao_id, auth.uid(), _codigo_lido, NULL,
      'nao_encontrado', NULL,
      jsonb_build_object('mensagem', 'Nenhum material corresponde a este código.'),
      _client_uuid, v_hash
    )
    RETURNING * INTO v_result;
    RETURN v_result;
  END IF;

  -- Custódia aberta mais antiga do material (se houver) - usada tanto para
  -- decidir o modo 'misto' quanto para resolver qual custódia um 'checkin'
  -- explícito deve fechar, quando o chamador não informar uma custódia
  -- específica via _custodia_id. v_custody.id permanece NULL se não houver
  -- nenhuma (SELECT INTO sem resultado zera a variável), não depender de
  -- FOUND aqui de propósito - este SELECT sempre roda, então FOUND cobriria
  -- só ele, mas checar a coluna é mais robusto a esta função crescer depois.
  SELECT * INTO v_custody
  FROM public.material_custodias
  WHERE empresa_id = v_company_id
    AND material_id = v_material.id
    AND status IN ('aberta', 'parcial')
  ORDER BY retirada_em ASC
  LIMIT 1;

  -- _custodia_id (opcional): troca QUAL das custódias abertas v_custody
  -- aponta quando há mais de uma - nunca decide sozinha, quem chama já
  -- resolveu isso (resolveCheckinOrigin + pergunta ao usuário quando há
  -- ambiguidade). Revalidado contra empresa/material/status para não
  -- confiar cegamente num id vindo do cliente; se não bater mais (custódia
  -- fechada por outra leitura entre a identificação e a confirmação), vira
  -- um 'erro' registrado normalmente, mesmo padrão do bloco acima.
  IF _custodia_id IS NOT NULL THEN
    SELECT * INTO v_custody
    FROM public.material_custodias
    WHERE empresa_id = v_company_id
      AND id = _custodia_id
      AND material_id = v_material.id
      AND status IN ('aberta', 'parcial');
    IF NOT FOUND THEN
      INSERT INTO public.scanner_remoto_leituras (
        empresa_id, sessao_id, lido_por, codigo_lido, material_id,
        acao_executada, custodia_id, resultado, client_uuid, payload_hash
      ) VALUES (
        v_company_id, _sessao_id, auth.uid(), _codigo_lido, v_material.id,
        'erro', NULL,
        jsonb_build_object(
          'mensagem', 'A custódia selecionada não está mais aberta para este material.',
          'material_nome', v_material.nome
        ),
        _client_uuid, v_hash
      )
      RETURNING * INTO v_result;
      RETURN v_result;
    END IF;
  END IF;

  -- ==========================================================================
  -- E5: _contexto informado => a CONFIRMAÇÃO da sessão automática decide a
  -- operação e carrega o contexto por leitura. Sem _contexto, cai no bloco
  -- legado logo abaixo (a sessão decide), byte a byte o de 20260824090000.
  -- ==========================================================================
  IF _contexto IS NOT NULL THEN
    v_ctx_operation := nullif(btrim(_contexto->>'operation'), '');
    IF v_ctx_operation IS NULL OR v_ctx_operation NOT IN ('checkout', 'checkin') THEN
      RAISE EXCEPTION USING ERRCODE = 'SR004',
        MESSAGE = 'Operação do contexto da leitura é inválida.';
    END IF;

    IF v_ctx_operation = 'checkin' THEN
      IF v_custody.id IS NULL THEN
        INSERT INTO public.scanner_remoto_leituras (
          empresa_id, sessao_id, lido_por, codigo_lido, material_id,
          acao_executada, custodia_id, resultado, client_uuid, payload_hash
        ) VALUES (
          v_company_id, _sessao_id, auth.uid(), _codigo_lido, v_material.id,
          'erro', NULL,
          jsonb_build_object(
            'mensagem', 'Este material não possui check-out em aberto.',
            'material_nome', v_material.nome
          ),
          _client_uuid, v_hash
        )
        RETURNING * INTO v_result;
        RETURN v_result;
      END IF;

      v_acao := 'checkin';
      BEGIN
        IF v_custody.referencia_tipo = 'locacao_item' THEN
          -- Check-in de item de locação => devolução oficial (grava o evento
          -- da locação e recomputa o status da locação). O locacao_id é
          -- derivado da custódia - não confiamos num id vindo do cliente aqui.
          SELECT locacao_id INTO v_ctx_rental_id
          FROM public.material_locacao_itens
          WHERE empresa_id = v_company_id AND id = v_custody.referencia_id;
          IF v_ctx_rental_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'SR004',
              MESSAGE = 'Item de locação da custódia não foi encontrado.';
          END IF;
          v_checkin_result := public.registrar_devolucao_locacao_material(
            _locacao_id => v_ctx_rental_id,
            _custodia_id => v_custody.id,
            _quantidade => _quantidade,
            _localizacao_destino_id => nullif(_contexto->>'localizacao_destino_id', '')::uuid,
            _condicao_retorno => coalesce(nullif(_contexto->>'condicao', ''), v_session.condicao::text),
            _client_uuid => _client_uuid,
            _observacao => nullif(_contexto->>'observacao', ''),
            _empresa_id => v_company_id
          );
        ELSE
          v_checkin_result := public.registrar_checkin_material(
            _custodia_id => v_custody.id,
            _quantidade => _quantidade,
            _localizacao_destino_id => nullif(_contexto->>'localizacao_destino_id', '')::uuid,
            _condicao_retorno => coalesce(nullif(_contexto->>'condicao', ''), v_session.condicao::text),
            _client_uuid => _client_uuid,
            _empresa_id => v_company_id
          );
        END IF;
        v_custodia_id := v_checkin_result.id;
        v_resultado := jsonb_build_object(
          'mensagem', 'Check-in registrado.', 'material_nome', v_material.nome
        );
      EXCEPTION WHEN OTHERS THEN
        v_acao := 'erro';
        v_custodia_id := NULL;
        v_resultado := jsonb_build_object(
          'mensagem', SQLERRM, 'sqlstate', SQLSTATE, 'material_nome', v_material.nome
        );
      END;

    ELSE
      -- v_ctx_operation = 'checkout'
      v_acao := 'checkout';
      v_ctx_finalidade := nullif(btrim(_contexto->>'finalidade'), '');
      BEGIN
        IF v_ctx_finalidade = 'cliente' THEN
          -- "Cliente" => retirada oficial de locação (a custódia final fica
          -- com finalidade='locacao' + referencia_tipo='locacao_item'; o
          -- operador nunca vê 'locacao' no seletor). Exige locação + item.
          IF nullif(_contexto->>'locacao_id', '') IS NULL
             OR nullif(_contexto->>'locacao_item_id', '') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'SR004',
              MESSAGE = 'Finalidade cliente exige uma locação e um item de locação.';
          END IF;
          v_checkout_result := public.registrar_retirada_locacao_material(
            _locacao_id => nullif(_contexto->>'locacao_id', '')::uuid,
            _item_id => nullif(_contexto->>'locacao_item_id', '')::uuid,
            _quantidade => _quantidade,
            _localizacao_origem_id => nullif(_contexto->>'localizacao_origem_id', '')::uuid,
            _responsavel_tipo => nullif(_contexto->>'responsavel_tipo', ''),
            _responsavel_id => nullif(_contexto->>'responsavel_id', '')::uuid,
            _condicao_saida => coalesce(nullif(_contexto->>'condicao', ''), v_session.condicao::text),
            _client_uuid => _client_uuid,
            _observacao => nullif(_contexto->>'observacao', ''),
            _empresa_id => v_company_id
          );
        ELSE
          v_checkout_result := public.registrar_checkout_material(
            _material_id => v_material.id,
            _quantidade => _quantidade,
            _localizacao_origem_id => nullif(_contexto->>'localizacao_origem_id', '')::uuid,
            _responsavel_tipo => nullif(_contexto->>'responsavel_tipo', ''),
            _responsavel_id => nullif(_contexto->>'responsavel_id', '')::uuid,
            _finalidade => coalesce(v_ctx_finalidade, 'uso_interno'),
            _condicao_saida => coalesce(nullif(_contexto->>'condicao', ''), v_session.condicao::text),
            _client_uuid => _client_uuid,
            _referencia_tipo => nullif(btrim(_contexto->>'referencia_tipo'), ''),
            _referencia_id => nullif(_contexto->>'referencia_id', '')::uuid,
            _empresa_id => v_company_id
          );
        END IF;
        v_custodia_id := v_checkout_result.id;
        v_resultado := jsonb_build_object(
          'mensagem', 'Check-out registrado.', 'material_nome', v_material.nome
        );
      EXCEPTION WHEN OTHERS THEN
        v_acao := 'erro';
        v_custodia_id := NULL;
        v_resultado := jsonb_build_object(
          'mensagem', SQLERRM, 'sqlstate', SQLSTATE, 'material_nome', v_material.nome
        );
      END;
    END IF;

  ELSIF v_session.tipo_operacao = 'checkin' AND v_custody.id IS NULL THEN
    INSERT INTO public.scanner_remoto_leituras (
      empresa_id, sessao_id, lido_por, codigo_lido, material_id,
      acao_executada, custodia_id, resultado, client_uuid, payload_hash
    ) VALUES (
      v_company_id, _sessao_id, auth.uid(), _codigo_lido, v_material.id,
      'erro', NULL,
      jsonb_build_object(
        'mensagem', 'Este material não possui check-out em aberto.',
        'material_nome', v_material.nome
      ),
      _client_uuid, v_hash
    )
    RETURNING * INTO v_result;
    RETURN v_result;

  ELSIF v_session.tipo_operacao = 'checkout'
     OR (v_session.tipo_operacao = 'misto' AND v_custody.id IS NULL) THEN
    v_acao := 'checkout';
    BEGIN
      v_checkout_result := public.registrar_checkout_material(
        _material_id => v_material.id,
        _quantidade => _quantidade,
        _localizacao_origem_id => v_session.localizacao_origem_id,
        _responsavel_tipo => v_session.responsavel_tipo::text,
        _responsavel_id => v_session.responsavel_id,
        _finalidade => v_session.finalidade::text,
        _condicao_saida => v_session.condicao::text,
        _client_uuid => _client_uuid,
        _referencia_tipo => v_session.referencia_tipo,
        _referencia_id => v_session.referencia_id,
        _empresa_id => v_company_id
      );
      v_custodia_id := v_checkout_result.id;
      v_resultado := jsonb_build_object(
        'mensagem', 'Check-out registrado.', 'material_nome', v_material.nome
      );
    EXCEPTION WHEN OTHERS THEN
      v_acao := 'erro';
      v_custodia_id := NULL;
      v_resultado := jsonb_build_object(
        'mensagem', SQLERRM, 'sqlstate', SQLSTATE, 'material_nome', v_material.nome
      );
    END;
  ELSE
    v_acao := 'checkin';
    BEGIN
      v_checkin_result := public.registrar_checkin_material(
        _custodia_id => v_custody.id,
        _quantidade => _quantidade,
        _localizacao_destino_id => v_session.localizacao_destino_id,
        _condicao_retorno => v_session.condicao::text,
        _client_uuid => _client_uuid,
        _empresa_id => v_company_id
      );
      v_custodia_id := v_checkin_result.id;
      v_resultado := jsonb_build_object(
        'mensagem', 'Check-in registrado.', 'material_nome', v_material.nome
      );
    EXCEPTION WHEN OTHERS THEN
      v_acao := 'erro';
      v_custodia_id := NULL;
      v_resultado := jsonb_build_object(
        'mensagem', SQLERRM, 'sqlstate', SQLSTATE, 'material_nome', v_material.nome
      );
    END;
  END IF;

  INSERT INTO public.scanner_remoto_leituras (
    empresa_id, sessao_id, lido_por, codigo_lido, material_id,
    acao_executada, custodia_id, resultado, client_uuid, payload_hash
  ) VALUES (
    v_company_id, _sessao_id, auth.uid(), _codigo_lido, v_material.id,
    v_acao, v_custodia_id, v_resultado, _client_uuid, v_hash
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid, jsonb) IS
  'Resolve um código lido para um material e delega a movimentação. Sem _contexto: a sessão decide (fluxo antigo, byte a byte). Com _contexto (confirmação da sessão automática): o contexto por leitura decide - check-in normal -> registrar_checkin_material; check-in de locacao_item -> registrar_devolucao_locacao_material; check-out normal/evento -> registrar_checkout_material; check-out cliente -> registrar_retirada_locacao_material. Nunca move custódia por conta própria; _quantidade/_custodia_id mantêm os defaults de sempre (1 unidade, custódia aberta mais antiga).';
