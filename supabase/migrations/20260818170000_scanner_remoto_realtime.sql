-- Backstage Pro - Scanner Remoto + Realtime multiterminal foundation.
--
-- Scope: (1) a session/read log so a phone/PWA terminal can drive Check-in/
-- Check-out by scanning QR/barcode, and (2) wiring the tables this flow
-- touches into Supabase Realtime (Postgres Changes) so every authenticated
-- terminal of the same company sees changes without a manual refresh. This
-- migration does not create a new commercial module: Scanner Remoto is
-- reached through the existing 'checkin_checkout' entitlement, decided with
-- the user over the RFID precedent (RFID = new addon module) specifically
-- because Scanner Remoto is the same operation on a different device, not a
-- new capability. Every RPC below therefore calls the exact same
-- public.resolve_custody_company(_empresa_id, _write) guard that
-- registrar_checkout_material/registrar_checkin_material already use - a
-- plain 'usuario' can view but not check out/check in from the phone,
-- identical to today's desktop behaviour, by construction rather than by a
-- second, possibly-drifting permission implementation.
--
-- registrar_leitura_scanner_remoto is the only RPC that moves custody, and
-- it does so by calling registrar_checkout_material/registrar_checkin_material
-- directly - the operational movement still happens exclusively inside
-- those pre-existing RPCs (their idempotency, advisory locks, stock/
-- quantity/individual-custody checks all apply unchanged). A single scan
-- resolves to exactly one physical unit (_quantidade := 1), and the
-- session's own responsavel/finalidade/condicao/localizacao are decided once
-- when the session opens and reapplied to every reading, so the operator is
-- never prompted mid-scan-loop. A session with tipo_operacao = 'misto' auto
-- detects checkout vs checkin per material (open custody found -> checkin,
-- else -> checkout), picking the oldest open custody on a tie.
--
-- A rejected/unmatched scan is not an exception - it is a normal outcome
-- recorded on the leitura row (acao_executada 'nao_encontrado'/'erro') so a
-- fast-paced scan loop on a phone never gets interrupted by a modal; only
-- session-level problems (session not found/closed, missing required
-- fields, no auth/permission) actually raise.
--
-- Realtime: Postgres Changes already respects each table's own RLS SELECT
-- policy per subscriber, so adding material_custodias/material_locacoes/
-- materiais (existing, already tenant-scoped by RLS) to the
-- supabase_realtime publication is enough for per-company isolation - no
-- new Realtime-specific authorization scheme is introduced. The two new
-- tables get REPLICA IDENTITY FULL (small, low-volume) so update/delete
-- payloads are always complete; the three existing tables keep their
-- default replica identity and this phase only needs INSERT/UPDATE from
-- them (no hard deletes in these flows today) - handled on the frontend
-- subscription side, not here.

-- ============================================================================
-- TYPES
-- ============================================================================

CREATE TYPE public.scanner_remoto_tipo_operacao AS ENUM (
  'checkout',
  'checkin',
  'misto'
);

CREATE TYPE public.scanner_remoto_sessao_status AS ENUM (
  'aberta',
  'encerrada',
  'cancelada'
);

CREATE TYPE public.scanner_remoto_acao AS ENUM (
  'checkout',
  'checkin',
  'nao_encontrado',
  'erro'
);

-- ============================================================================
-- scanner_remoto_sessoes - uma linha por sessão de scanner remoto
-- ============================================================================
--
-- responsavel_tipo/responsavel_id/finalidade/localizacao_origem_id são
-- obrigatórios quando a sessão pode fazer checkout (tipo_operacao IN
-- ('checkout','misto')); localizacao_destino_id é obrigatório quando pode
-- fazer checkin (tipo_operacao IN ('checkin','misto')); condicao é sempre
-- obrigatória (reaproveitada tanto para condicao_saida quanto para
-- condicao_retorno). referencia_tipo/referencia_id repete o mesmo
-- discriminador polimórfico de material_custodias/rfid_read_sessions.
CREATE TABLE public.scanner_remoto_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_operacao public.scanner_remoto_tipo_operacao NOT NULL,
  responsavel_tipo public.material_custody_responsible_type,
  responsavel_id uuid,
  finalidade public.material_custody_purpose,
  condicao public.material_custody_condition NOT NULL,
  localizacao_origem_id uuid,
  localizacao_destino_id uuid,
  referencia_tipo text,
  referencia_id uuid,
  titulo text,
  observacao text,
  status public.scanner_remoto_sessao_status NOT NULL DEFAULT 'aberta',
  criado_por uuid NOT NULL,
  aberta_em timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz,
  encerrada_por uuid,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanner_remoto_sessoes_referencia_shape CHECK (
    (referencia_tipo IS NULL AND referencia_id IS NULL)
    OR (nullif(btrim(referencia_tipo), '') IS NOT NULL AND referencia_id IS NOT NULL)
  ),
  CONSTRAINT scanner_remoto_sessoes_checkout_fields CHECK (
    tipo_operacao = 'checkin'
    OR (
      localizacao_origem_id IS NOT NULL
      AND responsavel_tipo IS NOT NULL
      AND responsavel_id IS NOT NULL
      AND finalidade IS NOT NULL
    )
  ),
  CONSTRAINT scanner_remoto_sessoes_checkin_fields CHECK (
    tipo_operacao = 'checkout'
    OR localizacao_destino_id IS NOT NULL
  ),
  CONSTRAINT scanner_remoto_sessoes_responsavel_shape CHECK (
    responsavel_tipo IS NULL OR responsavel_id IS NOT NULL
  ),
  CONSTRAINT scanner_remoto_sessoes_finished_shape CHECK (
    (status = 'aberta' AND encerrada_em IS NULL AND encerrada_por IS NULL)
    OR (status IN ('encerrada', 'cancelada') AND encerrada_em IS NOT NULL)
  ),
  CONSTRAINT scanner_remoto_sessoes_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT scanner_remoto_sessoes_empresa_id_unique
    UNIQUE (empresa_id, id),
  CONSTRAINT scanner_remoto_sessoes_empresa_client_unique
    UNIQUE (empresa_id, client_uuid),
  CONSTRAINT scanner_remoto_sessoes_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT scanner_remoto_sessoes_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT
);

CREATE INDEX scanner_remoto_sessoes_empresa_idx
  ON public.scanner_remoto_sessoes (empresa_id);
CREATE INDEX scanner_remoto_sessoes_empresa_status_idx
  ON public.scanner_remoto_sessoes (empresa_id, status);
CREATE INDEX scanner_remoto_sessoes_empresa_referencia_idx
  ON public.scanner_remoto_sessoes (empresa_id, referencia_tipo, referencia_id)
  WHERE referencia_tipo IS NOT NULL;

-- ============================================================================
-- scanner_remoto_leituras - uma linha por scan, inclusive scans rejeitados
-- ============================================================================
--
-- Ao contrário de rfid_read_sessions (que só grava um resumo final), aqui
-- cada leitura individual é persistida - é o feed de atividade que a tela do
-- desktop lista ao vivo, e cada linha já é o resultado final e auditável de
-- um scan (não há "leitura bruta" intermediária como no RFID, porque um
-- código de barras/QR já identifica um material de forma exata, sem
-- deduplicação de RF necessária).
CREATE TABLE public.scanner_remoto_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  sessao_id uuid NOT NULL,
  lido_por uuid NOT NULL,
  codigo_lido text NOT NULL,
  material_id uuid,
  acao_executada public.scanner_remoto_acao NOT NULL,
  custodia_id uuid,
  resultado jsonb,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanner_remoto_leituras_codigo_not_blank
    CHECK (btrim(codigo_lido) <> ''),
  CONSTRAINT scanner_remoto_leituras_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT scanner_remoto_leituras_material_shape CHECK (
    (acao_executada = 'nao_encontrado') = (material_id IS NULL)
  ),
  CONSTRAINT scanner_remoto_leituras_custodia_shape CHECK (
    (acao_executada IN ('checkout', 'checkin')) = (custodia_id IS NOT NULL)
  ),
  CONSTRAINT scanner_remoto_leituras_empresa_client_unique
    UNIQUE (empresa_id, client_uuid),
  CONSTRAINT scanner_remoto_leituras_empresa_sessao_fkey
    FOREIGN KEY (empresa_id, sessao_id)
    REFERENCES public.scanner_remoto_sessoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT scanner_remoto_leituras_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT scanner_remoto_leituras_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id) ON DELETE RESTRICT
);

CREATE INDEX scanner_remoto_leituras_empresa_sessao_idx
  ON public.scanner_remoto_leituras (empresa_id, sessao_id, created_at DESC);

-- ============================================================================
-- RPCs
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

CREATE OR REPLACE FUNCTION public.registrar_leitura_scanner_remoto(
  _sessao_id uuid,
  _codigo_lido text,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL
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
    jsonb_build_object('sessao_id', _sessao_id, 'codigo_lido', v_normalized)::text,
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
  -- explícito deve fechar. v_custody.id permanece NULL se não houver
  -- nenhuma (SELECT INTO sem resultado zera a variável), não depender de
  -- FOUND aqui de propósito - este SELECT sempre roda, então FOUND coberia
  -- só ele, mas checar a coluna é mais robusto a esta função crescer depois.
  SELECT * INTO v_custody
  FROM public.material_custodias
  WHERE empresa_id = v_company_id
    AND material_id = v_material.id
    AND status IN ('aberta', 'parcial')
  ORDER BY retirada_em ASC
  LIMIT 1;

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
        _quantidade => 1,
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
        _quantidade => 1,
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

CREATE OR REPLACE FUNCTION public.encerrar_sessao_scanner_remoto(
  _sessao_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.scanner_remoto_sessoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_result public.scanner_remoto_sessoes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);

  UPDATE public.scanner_remoto_sessoes
  SET status = 'encerrada',
      encerrada_em = clock_timestamp(),
      encerrada_por = auth.uid(),
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _sessao_id AND status = 'aberta'
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'SR001',
      MESSAGE = 'Sessão não encontrada ou já encerrada.';
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_sessoes_scanner_remoto(
  _somente_abertas boolean DEFAULT true,
  _empresa_id uuid DEFAULT NULL
)
RETURNS SETOF public.scanner_remoto_sessoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);

  RETURN QUERY
    SELECT *
    FROM public.scanner_remoto_sessoes
    WHERE empresa_id = v_company_id
      AND (NOT _somente_abertas OR status = 'aberta')
    ORDER BY aberta_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_leituras_scanner_remoto(
  _sessao_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  sessao_id uuid,
  lido_por uuid,
  codigo_lido text,
  material_id uuid,
  material_nome text,
  acao_executada public.scanner_remoto_acao,
  custodia_id uuid,
  resultado jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);

  RETURN QUERY
    SELECT l.id, l.sessao_id, l.lido_por, l.codigo_lido, l.material_id,
           m.nome, l.acao_executada, l.custodia_id, l.resultado, l.created_at
    FROM public.scanner_remoto_leituras AS l
    LEFT JOIN public.materiais AS m ON m.id = l.material_id
    WHERE l.empresa_id = v_company_id AND l.sessao_id = _sessao_id
    ORDER BY l.created_at DESC;
END;
$$;

-- ============================================================================
-- RLS
-- ============================================================================
--
-- Leitura: qualquer usuário com acesso ao módulo checkin_checkout (mesma
-- regra de can_read_company_module que material_custodias/material_locacoes
-- já usam) - necessário para o Postgres Changes conseguir entregar eventos
-- via RLS, não é uma escolha nova de exposição.
-- Escrita: nenhuma policy, nenhum GRANT de INSERT/UPDATE/DELETE direto - só
-- as RPCs acima (SECURITY DEFINER) escrevem, mesmo padrão de
-- rfid_tags/rfid_read_sessions.

ALTER TABLE public.scanner_remoto_sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanner_remoto_leituras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users read scanner remoto sessions"
ON public.scanner_remoto_sessoes
FOR SELECT TO authenticated
USING (public.can_read_company_module(empresa_id, 'checkin_checkout'));

CREATE POLICY "Company users read scanner remoto reads"
ON public.scanner_remoto_leituras
FOR SELECT TO authenticated
USING (public.can_read_company_module(empresa_id, 'checkin_checkout'));

REVOKE ALL ON public.scanner_remoto_sessoes FROM anon;
REVOKE ALL ON public.scanner_remoto_leituras FROM anon;
GRANT SELECT ON public.scanner_remoto_sessoes TO authenticated;
GRANT SELECT ON public.scanner_remoto_leituras TO authenticated;

REVOKE ALL ON FUNCTION public.iniciar_sessao_scanner_remoto(
  public.scanner_remoto_tipo_operacao, public.material_custody_condition, uuid,
  public.material_custody_responsible_type, uuid, public.material_custody_purpose,
  uuid, uuid, text, uuid, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_sessao_scanner_remoto(
  public.scanner_remoto_tipo_operacao, public.material_custody_condition, uuid,
  public.material_custody_responsible_type, uuid, public.material_custody_purpose,
  uuid, uuid, text, uuid, text, text, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.encerrar_sessao_scanner_remoto(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_sessao_scanner_remoto(uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.listar_sessoes_scanner_remoto(boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_sessoes_scanner_remoto(boolean, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.listar_leituras_scanner_remoto(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_leituras_scanner_remoto(uuid, uuid)
  TO authenticated;

COMMENT ON TABLE public.scanner_remoto_sessoes IS
  'Tenant-scoped Scanner Remoto sessions. Operational defaults (responsavel/finalidade/condicao/localizacao) are chosen once per session and reapplied to every reading.';
COMMENT ON TABLE public.scanner_remoto_leituras IS
  'Tenant-scoped Scanner Remoto reading log. One row per scan attempt, including unmatched/rejected ones - never just a summary.';
COMMENT ON FUNCTION public.registrar_leitura_scanner_remoto(uuid, text, uuid, uuid) IS
  'Resolves a scanned code to a material and delegates the actual custody movement to registrar_checkout_material/registrar_checkin_material - never moves custody itself.';

-- ============================================================================
-- REALTIME (Postgres Changes via supabase_realtime publication)
-- ============================================================================
--
-- material_custodias/material_locacoes/materiais já têm RLS SELECT
-- tenant-scoped (can_read_company_module) - só entrar na publicação já basta
-- para o Postgres Changes respeitar isolamento por empresa nativamente,
-- nenhuma policy nova é necessária nelas. Guardado em bloco DO/EXCEPTION
-- para a migration poder ser reaplicada sem falhar caso a tabela já esteja
-- na publicação (ERRCODE 42710/duplicate_object).

ALTER TABLE public.scanner_remoto_sessoes REPLICA IDENTITY FULL;
ALTER TABLE public.scanner_remoto_leituras REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.material_custodias;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.material_locacoes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.materiais;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.scanner_remoto_sessoes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.scanner_remoto_leituras;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
