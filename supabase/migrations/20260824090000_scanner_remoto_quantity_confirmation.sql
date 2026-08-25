-- registrar_leitura_scanner_remoto ganha dois parâmetros opcionais:
-- _quantidade (antes sempre hardcoded em 1 nas duas chamadas internas -
-- registrar_checkout_material/registrar_checkin_material - mesmo para
-- materiais controlados por quantidade, que podem sair/voltar em lote) e
-- _custodia_id (permite ao cliente informar qual das custódias abertas de
-- um material fechar no check-in, quando há mais de uma - mesmo cenário que
-- resolveCheckinOrigin()/CheckinOriginDialog já resolvem no desktop
-- perguntando ao usuário em vez de escolher sozinhos; sem essa informação,
-- o auto-pick "mais antiga primeiro" já existente continua sendo usado,
-- byte a byte igual a antes). Troca de assinatura, não só de corpo -
-- precisa do DROP explícito antes do CREATE, senão a versão de 4
-- argumentos e a de 6 coexistiriam como overloads e uma chamada antiga
-- (sempre com só 4) poderia resolver para a errada - mesmo cuidado já
-- tomado em confirmar_reserva_locacao_material
-- (20260806090000_material_rental_financial_integration.sql).
--
-- Ambos os parâmetros são opcionais com default igual ao comportamento de
-- hoje (_quantidade DEFAULT 1, _custodia_id DEFAULT NULL) - todo chamador
-- existente, incluindo o próprio app sem esta mudança de cliente ainda
-- implantada, continua funcionando idêntico.
DROP FUNCTION IF EXISTS public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.registrar_leitura_scanner_remoto(
  _sessao_id uuid,
  _codigo_lido text,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL,
  _quantidade integer DEFAULT 1,
  _custodia_id uuid DEFAULT NULL
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
  v_hash := encode(sha256(convert_to(
    jsonb_build_object(
      'sessao_id', _sessao_id, 'codigo_lido', v_normalized,
      'quantidade', _quantidade, 'custodia_id', _custodia_id
    )::text,
    'UTF8'
  )), 'hex');

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

  IF v_session.tipo_operacao = 'checkin' AND v_custody.id IS NULL THEN
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

  IF v_session.tipo_operacao = 'checkout'
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

REVOKE ALL ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid, integer, uuid) IS
  'Resolves a scanned code to a material and delegates the actual custody movement to registrar_checkout_material/registrar_checkin_material - never moves custody itself. _quantidade/_custodia_id default to the pre-existing behavior (1 unit, oldest open custody) for every caller that omits them.';
