-- Backstage Pro - Scanner Remoto: sessão automática ('misto') passa a poder
-- ser aberta com o contexto operacional vazio.
--
-- Etapa E2 do novo fluxo do Scanner Remoto (ler -> identificar -> escolher
-- check-in/check-out -> completar contexto -> confirmar -> gravar). Nesta
-- etapa o operador abre uma sessão automática imediatamente, sem preencher
-- origem/destino/responsável/finalidade/evento/locação/título - esse
-- contexto passará a ser resolvido por leitura, em etapas posteriores.
--
-- Hoje NÃO é possível abrir uma sessão neutra:
--   * o CHECK scanner_remoto_sessoes_checkout_fields exige
--     localizacao_origem_id + responsavel_tipo + responsavel_id + finalidade
--     para tipo_operacao IN ('checkout','misto');
--   * o CHECK scanner_remoto_sessoes_checkin_fields exige
--     localizacao_destino_id para tipo_operacao IN ('checkin','misto');
--   * iniciar_sessao_scanner_remoto repete essas duas exigências no corpo,
--     levantando SR003 para 'misto' vazio.
--
-- Esta migration afrouxa APENAS o caso 'misto'. Sessões explicitamente
-- 'checkout' continuam exigindo origem/responsável/finalidade; sessões
-- explicitamente 'checkin' continuam exigindo destino - nas duas camadas
-- (CHECK da tabela e validação da RPC).
--
-- Não altera: os gates de permissão de iniciar_sessao_scanner_remoto
-- (user_has_module_action por tipo_operacao, inalterados), a checagem de par
-- referencia_tipo/referencia_id, registrar_leitura_scanner_remoto,
-- registrar_checkout_material/registrar_checkin_material, nem qualquer outra
-- RPC. encerrar_sessao_scanner_remoto e listar_sessoes_scanner_remoto
-- continuam idênticas - a sessão neutra é uma sessão 'aberta' normal.
--
-- Backward compatibility: afrouxar um CHECK nunca invalida linha existente.
-- Sessões 'checkout'/'checkin'/'misto' já abertas (com os campos preenchidos)
-- continuam satisfazendo os CHECKs novos, que são estritamente mais
-- permissivos. Nenhum registro é alterado.
--
-- GRANT/REVOKE não são reemitidos para iniciar_sessao_scanner_remoto: a
-- assinatura (mesmos 13 parâmetros, mesma ordem, mesmos tipos, mesmos
-- defaults) permanece idêntica à de
-- 20260819100000_checkin_checkout_granular_write_permissions.sql, então o
-- CREATE OR REPLACE preserva os privilégios já concedidos em
-- 20260818170000_scanner_remoto_realtime.sql (REVOKE ALL FROM PUBLIC, anon;
-- GRANT EXECUTE TO authenticated) - mesmo padrão já usado pelas redefinições
-- de registrar_checkout_material em 20260821090000 e 20260824140000.

-- ============================================================================
-- 1. CHECKs da tabela - só 'checkout'/'checkin' exigem o contexto operacional
-- ============================================================================
--
-- ANTES:
--   scanner_remoto_sessoes_checkout_fields:
--     tipo_operacao = 'checkin'  OR (origem AND responsavel_tipo AND responsavel_id AND finalidade)
--   scanner_remoto_sessoes_checkin_fields:
--     tipo_operacao = 'checkout' OR localizacao_destino_id IS NOT NULL
--
-- DEPOIS:
--   scanner_remoto_sessoes_checkout_fields:
--     tipo_operacao <> 'checkout' OR (origem AND responsavel_tipo AND responsavel_id AND finalidade)
--   scanner_remoto_sessoes_checkin_fields:
--     tipo_operacao <> 'checkin'  OR localizacao_destino_id IS NOT NULL
--
-- Ou seja: 'checkout' => contexto de saída obrigatório; 'checkin' => destino
-- obrigatório; 'misto' => nada obrigatório.

ALTER TABLE public.scanner_remoto_sessoes
  DROP CONSTRAINT scanner_remoto_sessoes_checkout_fields,
  DROP CONSTRAINT scanner_remoto_sessoes_checkin_fields;

ALTER TABLE public.scanner_remoto_sessoes
  ADD CONSTRAINT scanner_remoto_sessoes_checkout_fields CHECK (
    tipo_operacao <> 'checkout'
    OR (
      localizacao_origem_id IS NOT NULL
      AND responsavel_tipo IS NOT NULL
      AND responsavel_id IS NOT NULL
      AND finalidade IS NOT NULL
    )
  ),
  ADD CONSTRAINT scanner_remoto_sessoes_checkin_fields CHECK (
    tipo_operacao <> 'checkin'
    OR localizacao_destino_id IS NOT NULL
  );

-- ============================================================================
-- 2. iniciar_sessao_scanner_remoto - SR003 só para 'checkout'/'checkin'
-- ============================================================================
--
-- Única mudança no corpo: as duas checagens de SR003 trocam
-- `_tipo_operacao IN ('checkout','misto')` por `_tipo_operacao = 'checkout'`
-- e `_tipo_operacao IN ('checkin','misto')` por `_tipo_operacao = 'checkin'`.
-- Todo o resto (gates de permissão, SR004, par referencia, hash, advisory
-- lock, idempotência, INSERT) é byte-a-byte igual a
-- 20260819100000_checkin_checkout_granular_write_permissions.sql.

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
  -- Sessão 'misto' (automática) pode nascer sem contexto operacional - ele
  -- será resolvido por leitura. Somente sessões explicitamente 'checkout' ou
  -- 'checkin' continuam exigindo o contexto na abertura.
  IF _tipo_operacao = 'checkout' AND (
    _localizacao_origem_id IS NULL OR _responsavel_tipo IS NULL
    OR _responsavel_id IS NULL OR _finalidade IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'SR003',
      MESSAGE = 'Origem, responsável e finalidade são obrigatórios para check-out.';
  END IF;
  IF _tipo_operacao = 'checkin' AND _localizacao_destino_id IS NULL THEN
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

COMMENT ON CONSTRAINT scanner_remoto_sessoes_checkout_fields ON public.scanner_remoto_sessoes IS
  'Contexto de saída (origem/responsável/finalidade) obrigatório apenas para sessões explicitamente checkout. Sessões misto (automáticas) resolvem esse contexto por leitura.';
COMMENT ON CONSTRAINT scanner_remoto_sessoes_checkin_fields ON public.scanner_remoto_sessoes IS
  'Localização de destino obrigatória apenas para sessões explicitamente checkin. Sessões misto (automáticas) resolvem o destino por leitura.';
