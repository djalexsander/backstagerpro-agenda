-- Backstage Pro - Stage 3: material check-in/check-out and physical custody.
-- Custody is a distinct operational domain, while every physical balance
-- change remains atomic in the canonical Stage 2 stock ledger.

UPDATE public.module_catalog
SET nome = 'Check-in e Check-out',
    descricao = 'Custódia, retirada, devolução parcial ou total e histórico operacional de materiais.',
    ativo = true,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'planned')
      || '{"area":"materiais","stage":3,"operational":true}'::jsonb,
    texto_venda = 'Controle quem retirou, quem está responsável e quando cada material retornou.',
    updated_at = clock_timestamp()
WHERE feature_key = 'checkin_checkout';

-- Stage 1 already declared checkin_checkout -> gestao_materiais. Stage 3 also
-- requires controle_estoque because checkout/checkin physically debit/credit
-- the official balance and must never maintain a parallel stock projection.
INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT custody.id, stock.id
FROM public.module_catalog AS custody
JOIN public.module_catalog AS stock
  ON stock.feature_key = 'controle_estoque'
WHERE custody.feature_key = 'checkin_checkout'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

CREATE TYPE public.material_custody_condition AS ENUM (
  'bom',
  'com_avaria',
  'danificado',
  'manutencao_necessaria',
  'incompleto'
);

CREATE TYPE public.material_custody_purpose AS ENUM (
  'uso_interno',
  'funcionario',
  'evento',
  'cliente',
  'locacao',
  'manutencao',
  'transferencia_operacional',
  'outro'
);

CREATE TYPE public.material_custody_responsible_type AS ENUM (
  'usuario',
  'funcionario'
);

CREATE TYPE public.material_custody_status AS ENUM (
  'aberta',
  'parcial',
  'concluida',
  'cancelada'
);

CREATE TYPE public.material_custody_event_type AS ENUM (
  'checkout',
  'checkin',
  'cancelamento',
  'correcao'
);

CREATE TABLE public.material_custodias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL,
  tipo_controle public.material_control_type NOT NULL,
  quantidade_retirada integer NOT NULL,
  quantidade_devolvida integer NOT NULL DEFAULT 0,
  localizacao_origem_id uuid NOT NULL,
  retirada_em timestamptz NOT NULL DEFAULT now(),
  previsao_retorno timestamptz,
  executado_por uuid NOT NULL,
  responsavel_tipo public.material_custody_responsible_type NOT NULL,
  responsavel_usuario_id uuid,
  responsavel_funcionario_id uuid,
  responsavel_nome text NOT NULL,
  finalidade public.material_custody_purpose NOT NULL,
  referencia_tipo text,
  referencia_id uuid,
  observacao_saida text,
  condicao_saida public.material_custody_condition NOT NULL,
  status public.material_custody_status NOT NULL DEFAULT 'aberta',
  movimento_saida_id uuid NOT NULL,
  encerrada_em timestamptz,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_custodias_empresa_id_id_unique
    UNIQUE (empresa_id, id),
  CONSTRAINT material_custodias_quantidade_positive
    CHECK (quantidade_retirada > 0),
  CONSTRAINT material_custodias_devolucao_range
    CHECK (
      quantidade_devolvida >= 0
      AND quantidade_devolvida <= quantidade_retirada
    ),
  CONSTRAINT material_custodias_individual_quantity
    CHECK (tipo_controle <> 'individual' OR quantidade_retirada = 1),
  CONSTRAINT material_custodias_responsavel_nome_not_blank
    CHECK (btrim(responsavel_nome) <> ''),
  CONSTRAINT material_custodias_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT material_custodias_responsavel_shape CHECK (
    (
      responsavel_tipo = 'usuario'
      AND responsavel_usuario_id IS NOT NULL
      AND responsavel_funcionario_id IS NULL
    )
    OR
    (
      responsavel_tipo = 'funcionario'
      AND responsavel_funcionario_id IS NOT NULL
      AND responsavel_usuario_id IS NULL
    )
  ),
  CONSTRAINT material_custodias_referencia_shape CHECK (
    (referencia_tipo IS NULL AND referencia_id IS NULL)
    OR
    (nullif(btrim(referencia_tipo), '') IS NOT NULL AND referencia_id IS NOT NULL)
  ),
  CONSTRAINT material_custodias_status_shape CHECK (
    (status = 'aberta' AND quantidade_devolvida = 0 AND encerrada_em IS NULL)
    OR
    (
      status = 'parcial'
      AND quantidade_devolvida > 0
      AND quantidade_devolvida < quantidade_retirada
      AND encerrada_em IS NULL
    )
    OR
    (
      status = 'concluida'
      AND quantidade_devolvida = quantidade_retirada
      AND encerrada_em IS NOT NULL
    )
    OR
    (
      status = 'cancelada'
      AND quantidade_devolvida = 0
      AND encerrada_em IS NOT NULL
    )
  ),
  CONSTRAINT material_custodias_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodias_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodias_empresa_movimento_saida_fkey
    FOREIGN KEY (empresa_id, material_id, movimento_saida_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT material_custodias_empresa_client_unique
    UNIQUE (empresa_id, client_uuid)
);

CREATE TABLE public.material_custodia_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL,
  material_id uuid NOT NULL,
  tipo public.material_custody_event_type NOT NULL,
  quantidade integer NOT NULL,
  localizacao_origem_id uuid,
  localizacao_destino_id uuid,
  condicao public.material_custody_condition,
  ocorrencia text,
  observacao text,
  justificativa text,
  data_efetiva timestamptz NOT NULL DEFAULT now(),
  executado_por uuid NOT NULL,
  movimento_estoque_id uuid NOT NULL,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_custodia_eventos_quantidade_positive
    CHECK (quantidade > 0),
  CONSTRAINT material_custodia_eventos_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT material_custodia_eventos_location_shape CHECK (
    (tipo = 'checkout' AND localizacao_origem_id IS NOT NULL AND localizacao_destino_id IS NULL)
    OR
    (tipo = 'checkin' AND localizacao_origem_id IS NULL AND localizacao_destino_id IS NOT NULL)
    OR
    (tipo IN ('cancelamento', 'correcao') AND (localizacao_origem_id IS NOT NULL OR localizacao_destino_id IS NOT NULL))
  ),
  CONSTRAINT material_custodia_eventos_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodia_eventos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodia_eventos_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodia_eventos_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_custodia_eventos_empresa_movimento_fkey
    FOREIGN KEY (empresa_id, material_id, movimento_estoque_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT material_custodia_eventos_empresa_client_unique
    UNIQUE (empresa_id, client_uuid)
);

CREATE UNIQUE INDEX material_custodias_individual_active_uidx
  ON public.material_custodias (empresa_id, material_id)
  WHERE tipo_controle = 'individual' AND status IN ('aberta', 'parcial');
CREATE INDEX material_custodias_company_status_date_idx
  ON public.material_custodias (empresa_id, status, retirada_em DESC, id DESC);
CREATE INDEX material_custodias_company_due_idx
  ON public.material_custodias (empresa_id, previsao_retorno, id)
  WHERE status IN ('aberta', 'parcial') AND previsao_retorno IS NOT NULL;
CREATE INDEX material_custodias_material_status_idx
  ON public.material_custodias (empresa_id, material_id, status, retirada_em DESC);
CREATE INDEX material_custodias_responsible_idx
  ON public.material_custodias (empresa_id, responsavel_tipo, responsavel_usuario_id, responsavel_funcionario_id);
CREATE INDEX material_custodia_eventos_custody_date_idx
  ON public.material_custodia_eventos (empresa_id, custodia_id, data_efetiva DESC, id DESC);
CREATE INDEX material_custodia_eventos_company_date_idx
  ON public.material_custodia_eventos (empresa_id, data_efetiva DESC, id DESC);
CREATE INDEX material_custodia_eventos_actor_date_idx
  ON public.material_custodia_eventos (empresa_id, executado_por, data_efetiva DESC);

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

  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'CI011',
        MESSAGE = 'Selecione a empresa para operar a custódia.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL
       OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'checkin_checkout'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'checkin_checkout')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_custody_responsible_name(
  _company_id uuid,
  _responsible_type public.material_custody_responsible_type,
  _responsible_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
BEGIN
  IF _responsible_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Selecione a pessoa responsável pela custódia.';
  END IF;
  IF _responsible_type = 'usuario' THEN
    SELECT nullif(btrim(profile.full_name), '') INTO v_name
    FROM public.profiles AS profile
    WHERE profile.empresa_id = _company_id
      AND profile.user_id = _responsible_id
      AND profile.ativado = true;
  ELSE
    SELECT nullif(btrim(employee.nome), '') INTO v_name
    FROM public.funcionarios AS employee
    WHERE employee.empresa_id = _company_id
      AND employee.id = _responsible_id;
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005',
      MESSAGE = 'Responsável não encontrado na empresa selecionada.';
  END IF;
  RETURN v_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_custody_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'material_custodia_eventos' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'O histórico de custódia é imutável.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Operações de custódia não podem ser excluídas.';
  END IF;
  IF COALESCE(current_setting('backstage.custody_projection_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Use as operações explícitas de check-in ou cancelamento.';
  END IF;
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.material_id IS DISTINCT FROM OLD.material_id
     OR NEW.tipo_controle IS DISTINCT FROM OLD.tipo_controle
     OR NEW.quantidade_retirada IS DISTINCT FROM OLD.quantidade_retirada
     OR NEW.localizacao_origem_id IS DISTINCT FROM OLD.localizacao_origem_id
     OR NEW.retirada_em IS DISTINCT FROM OLD.retirada_em
     OR NEW.executado_por IS DISTINCT FROM OLD.executado_por
     OR NEW.responsavel_tipo IS DISTINCT FROM OLD.responsavel_tipo
     OR NEW.responsavel_usuario_id IS DISTINCT FROM OLD.responsavel_usuario_id
     OR NEW.responsavel_funcionario_id IS DISTINCT FROM OLD.responsavel_funcionario_id
     OR NEW.responsavel_nome IS DISTINCT FROM OLD.responsavel_nome
     OR NEW.finalidade IS DISTINCT FROM OLD.finalidade
     OR NEW.referencia_tipo IS DISTINCT FROM OLD.referencia_tipo
     OR NEW.referencia_id IS DISTINCT FROM OLD.referencia_id
     OR NEW.observacao_saida IS DISTINCT FROM OLD.observacao_saida
     OR NEW.condicao_saida IS DISTINCT FROM OLD.condicao_saida
     OR NEW.movimento_saida_id IS DISTINCT FROM OLD.movimento_saida_id
     OR NEW.client_uuid IS DISTINCT FROM OLD.client_uuid
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Os dados históricos do check-out são imutáveis.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.registrar_checkin_material(
  _custodia_id uuid,
  _quantidade integer,
  _localizacao_destino_id uuid,
  _condicao_retorno text,
  _client_uuid uuid,
  _observacao text DEFAULT NULL,
  _ocorrencia text DEFAULT NULL,
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
  v_movement public.estoque_movimentacoes%ROWTYPE;
  v_condition public.material_custody_condition;
  v_hash text;
  v_stock_hash text;
  v_pending integer;
  v_new_returned integer;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF _custodia_id IS NULL OR _localizacao_destino_id IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Operação, localização de retorno e identificador são obrigatórios.';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Informe uma quantidade devolvida maior que zero.';
  END IF;
  BEGIN
    v_condition := _condicao_retorno::public.material_custody_condition;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Condição de retorno inválida.';
  END;
  IF v_condition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004',
      MESSAGE = 'Informe a condição de retorno.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', _custodia_id,
    'quantidade', _quantidade,
    'destino', _localizacao_destino_id,
    'condicao', v_condition,
    'observacao', nullif(btrim(_observacao), ''),
    'ocorrencia', nullif(btrim(_ocorrencia), ''),
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0)
  );
  SELECT * INTO v_existing_event
  FROM public.material_custodia_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash
       OR v_existing_event.tipo <> 'checkin' THEN
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
  IF v_custody.status NOT IN ('aberta', 'parcial') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI014',
      MESSAGE = 'Esta operação não possui quantidade pendente para retorno.';
  END IF;
  v_pending := v_custody.quantidade_retirada - v_custody.quantidade_devolvida;
  IF _quantidade > v_pending THEN
    RAISE EXCEPTION USING ERRCODE = 'CI001',
      MESSAGE = 'A quantidade devolvida supera a quantidade ainda em custódia.';
  END IF;
  IF v_custody.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI002',
      MESSAGE = 'Material individual deve retornar com quantidade um.';
  END IF;

  v_stock_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', v_custody.id,
    'material', v_custody.material_id,
    'quantidade', _quantidade,
    'destino', _localizacao_destino_id,
    'data', _data_efetiva,
    'operacao', 'checkin'
  )::text, 'UTF8')), 'hex');
  v_movement := public.apply_stock_movement(
    v_company_id, v_custody.material_id, 'entrada', _quantidade,
    NULL, _localizacao_destino_id,
    'Check-in de material', NULL, _observacao, NULL,
    _data_efetiva, 'checkin_checkout', v_custody.id,
    _client_uuid, v_stock_hash, NULL
  );

  v_new_returned := v_custody.quantidade_devolvida + _quantidade;
  PERFORM set_config('backstage.custody_projection_write', 'on', true);
  UPDATE public.material_custodias
  SET quantidade_devolvida = v_new_returned,
      status = CASE
        WHEN v_new_returned = quantidade_retirada
          THEN 'concluida'::public.material_custody_status
        ELSE 'parcial'::public.material_custody_status
      END,
      encerrada_em = CASE
        WHEN v_new_returned = quantidade_retirada THEN v_effective_at
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = v_custody.id
  RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write', 'off', true);

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade,
    localizacao_destino_id, condicao, ocorrencia, observacao,
    data_efetiva, executado_por, movimento_estoque_id,
    client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_custody.id, v_custody.material_id, 'checkin', _quantidade,
    _localizacao_destino_id, v_condition, nullif(btrim(_ocorrencia), ''),
    nullif(btrim(_observacao), ''), v_effective_at, auth.uid(), v_movement.id,
    _client_uuid, v_hash
  );

  INSERT INTO public.system_logs (
    tipo, acao, descricao, user_id, empresa_id, dados
  ) VALUES (
    'custodia',
    CASE WHEN v_result.status = 'concluida'
      THEN 'material_checkin_total' ELSE 'material_checkin_parcial' END,
    CASE WHEN v_result.status = 'concluida'
      THEN 'Retorno total de material registrado'
      ELSE 'Retorno parcial de material registrado' END,
    auth.uid(), v_company_id,
    jsonb_build_object(
      'custodia_id', v_result.id,
      'material_id', v_result.material_id,
      'quantidade', _quantidade,
      'condicao', v_condition,
      'ocorrencia', nullif(btrim(_ocorrencia), ''),
      'movimento_estoque_id', v_movement.id
    )
  );
  RETURN v_result;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.buscar_materiais_custodia(
  _busca text,
  _empresa_id uuid DEFAULT NULL,
  _limite integer DEFAULT 12
)
RETURNS TABLE (item jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_search text := btrim(COALESCE(_busca, ''));
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  IF v_search = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', material.id,
    'nome', material.nome,
    'codigo_interno', material.codigo_interno,
    'identificador_unico', material.identificador_unico,
    'codigo_barras', material.codigo_barras,
    'conteudo_qr_code', material.conteudo_qr_code,
    'numero_patrimonio', material.numero_patrimonio,
    'numero_serie', material.numero_serie,
    'tipo_controle', material.tipo_controle,
    'status_operacional', material.status_operacional,
    'ativo', material.ativo,
    'unidade_medida', material.unidade_medida,
    'foto_path', (
      SELECT photo.storage_path
      FROM public.materiais_fotos AS photo
      WHERE photo.empresa_id = material.empresa_id
        AND photo.material_id = material.id
      ORDER BY photo.foto_principal DESC, photo.created_at, photo.id
      LIMIT 1
    ),
    'saldos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'localizacao_id', balance.localizacao_id,
        'localizacao_codigo', location.codigo,
        'localizacao_nome', location.nome,
        'localizacao_ativa', location.ativa,
        'quantidade', balance.quantidade
      ) ORDER BY location.nome)
      FROM public.estoque_saldos AS balance
      JOIN public.estoque_localizacoes AS location
        ON location.empresa_id = balance.empresa_id
       AND location.id = balance.localizacao_id
      WHERE balance.empresa_id = material.empresa_id
        AND balance.material_id = material.id
        AND balance.quantidade > 0
    ), '[]'::jsonb),
    'custodias_abertas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', custody.id,
        'quantidade_retirada', custody.quantidade_retirada,
        'quantidade_devolvida', custody.quantidade_devolvida,
        'quantidade_pendente', custody.quantidade_retirada - custody.quantidade_devolvida,
        'responsavel_nome', custody.responsavel_nome,
        'retirada_em', custody.retirada_em,
        'previsao_retorno', custody.previsao_retorno,
        'status', custody.status
      ) ORDER BY custody.retirada_em)
      FROM public.material_custodias AS custody
      WHERE custody.empresa_id = material.empresa_id
        AND custody.material_id = material.id
        AND custody.status IN ('aberta', 'parcial')
    ), '[]'::jsonb)
  )
  FROM public.materiais AS material
  WHERE material.empresa_id = v_company_id
    AND (
      lower(material.id::text) = lower(v_search)
      OR lower(COALESCE(material.identificador_unico::text, '')) = lower(v_search)
      OR lower(COALESCE(material.conteudo_qr_code, '')) = lower(v_search)
      OR lower(COALESCE(material.codigo_barras, '')) = lower(v_search)
      OR lower(material.codigo_interno) = lower(v_search)
      OR lower(COALESCE(material.numero_patrimonio, '')) = lower(v_search)
      OR lower(COALESCE(material.numero_serie, '')) = lower(v_search)
      OR material.nome ILIKE '%' || v_search || '%'
      OR material.codigo_interno ILIKE '%' || v_search || '%'
    )
  ORDER BY
    CASE WHEN lower(material.id::text) = lower(v_search)
           OR lower(COALESCE(material.identificador_unico::text, '')) = lower(v_search)
           OR lower(COALESCE(material.conteudo_qr_code, '')) = lower(v_search)
           OR lower(COALESCE(material.codigo_barras, '')) = lower(v_search)
           OR lower(material.codigo_interno) = lower(v_search)
           OR lower(COALESCE(material.numero_patrimonio, '')) = lower(v_search)
           OR lower(COALESCE(material.numero_serie, '')) = lower(v_search)
      THEN 0 ELSE 1 END,
    material.nome,
    material.id
  LIMIT LEAST(GREATEST(COALESCE(_limite, 12), 1), 30);
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_custodias_materiais(
  _pagina integer DEFAULT 1,
  _tamanho_pagina integer DEFAULT 10,
  _busca text DEFAULT NULL,
  _status text DEFAULT NULL,
  _finalidade text DEFAULT NULL,
  _responsavel text DEFAULT NULL,
  _executor_id uuid DEFAULT NULL,
  _localizacao_id uuid DEFAULT NULL,
  _data_inicio date DEFAULT NULL,
  _data_fim date DEFAULT NULL,
  _somente_abertas boolean DEFAULT NULL,
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
  v_page integer := GREATEST(COALESCE(_pagina, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(_tamanho_pagina, 10), 1), 100);
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', custody.id,
    'empresa_id', custody.empresa_id,
    'material_id', custody.material_id,
    'material_nome', material.nome,
    'material_codigo', material.codigo_interno,
    'material_identificador', COALESCE(
      material.numero_patrimonio,
      material.numero_serie,
      material.codigo_barras,
      material.identificador_unico::text
    ),
    'foto_path', (
      SELECT photo.storage_path
      FROM public.materiais_fotos AS photo
      WHERE photo.empresa_id = custody.empresa_id
        AND photo.material_id = custody.material_id
      ORDER BY photo.foto_principal DESC, photo.created_at, photo.id
      LIMIT 1
    ),
    'tipo_controle', custody.tipo_controle,
    'quantidade_retirada', custody.quantidade_retirada,
    'quantidade_devolvida', custody.quantidade_devolvida,
    'quantidade_pendente', custody.quantidade_retirada - custody.quantidade_devolvida,
    'localizacao_origem_id', custody.localizacao_origem_id,
    'localizacao_origem_nome', origin.nome,
    'retirada_em', custody.retirada_em,
    'previsao_retorno', custody.previsao_retorno,
    'executado_por', custody.executado_por,
    'executor_nome', COALESCE(actor.full_name, 'Usuário'),
    'responsavel_tipo', custody.responsavel_tipo,
    'responsavel_usuario_id', custody.responsavel_usuario_id,
    'responsavel_funcionario_id', custody.responsavel_funcionario_id,
    'responsavel_nome', custody.responsavel_nome,
    'finalidade', custody.finalidade,
    'referencia_tipo', custody.referencia_tipo,
    'referencia_id', custody.referencia_id,
    'observacao_saida', custody.observacao_saida,
    'condicao_saida', custody.condicao_saida,
    'status', custody.status,
    'movimento_saida_id', custody.movimento_saida_id,
    'encerrada_em', custody.encerrada_em,
    'created_at', custody.created_at,
    'updated_at', custody.updated_at
  ), count(*) OVER ()
  FROM public.material_custodias AS custody
  JOIN public.materiais AS material
    ON material.empresa_id = custody.empresa_id
   AND material.id = custody.material_id
  JOIN public.estoque_localizacoes AS origin
    ON origin.empresa_id = custody.empresa_id
   AND origin.id = custody.localizacao_origem_id
  LEFT JOIN public.profiles AS actor
    ON actor.user_id = custody.executado_por
  WHERE custody.empresa_id = v_company_id
    AND (
      nullif(btrim(_busca), '') IS NULL
      OR material.nome ILIKE '%' || btrim(_busca) || '%'
      OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%'
      OR custody.responsavel_nome ILIKE '%' || btrim(_busca) || '%'
    )
    AND (_status IS NULL OR custody.status::text = _status)
    AND (_finalidade IS NULL OR custody.finalidade::text = _finalidade)
    AND (
      nullif(btrim(_responsavel), '') IS NULL
      OR custody.responsavel_nome ILIKE '%' || btrim(_responsavel) || '%'
    )
    AND (_executor_id IS NULL OR custody.executado_por = _executor_id)
    AND (_localizacao_id IS NULL OR custody.localizacao_origem_id = _localizacao_id)
    AND (_data_inicio IS NULL OR custody.retirada_em >= _data_inicio::timestamptz)
    AND (_data_fim IS NULL OR custody.retirada_em < (_data_fim + 1)::timestamptz)
    AND (
      _somente_abertas IS NULL
      OR (_somente_abertas AND custody.status IN ('aberta', 'parcial'))
      OR (NOT _somente_abertas AND custody.status NOT IN ('aberta', 'parcial'))
    )
  ORDER BY custody.retirada_em DESC, custody.id DESC
  OFFSET (v_page - 1) * v_size
  LIMIT v_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_indicadores_custodia(
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_result jsonb;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  SELECT jsonb_build_object(
    'itens_fora', COALESCE(sum(
      CASE WHEN custody.status IN ('aberta', 'parcial')
        THEN custody.quantidade_retirada - custody.quantidade_devolvida ELSE 0 END
    ), 0),
    'previstos_hoje', count(*) FILTER (
      WHERE custody.status IN ('aberta', 'parcial')
        AND custody.previsao_retorno >= current_date
        AND custody.previsao_retorno < current_date + interval '1 day'
    ),
    'atrasados', count(*) FILTER (
      WHERE custody.status IN ('aberta', 'parcial')
        AND custody.previsao_retorno < clock_timestamp()
    ),
    'ocorrencias', (
      SELECT count(*)
      FROM public.material_custodia_eventos AS event
      WHERE event.empresa_id = v_company_id
        AND event.tipo = 'checkin'
        AND (
          event.ocorrencia IS NOT NULL
          OR event.condicao <> 'bom'
        )
    )
  ) INTO v_result
  FROM public.material_custodias AS custody
  WHERE custody.empresa_id = v_company_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_responsaveis_custodia(
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (
  tipo public.material_custody_responsible_type,
  id uuid,
  nome text,
  detalhe text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  RETURN QUERY
  SELECT 'usuario'::public.material_custody_responsible_type,
         profile.user_id,
         profile.full_name,
         COALESCE(profile.email, 'Usuário do sistema')
  FROM public.profiles AS profile
  WHERE profile.empresa_id = v_company_id
    AND profile.ativado = true
  UNION ALL
  SELECT 'funcionario'::public.material_custody_responsible_type,
         employee.id,
         employee.nome,
         COALESCE(nullif(employee.funcao, ''), initcap(employee.tipo))
  FROM public.funcionarios AS employee
  WHERE employee.empresa_id = v_company_id
  ORDER BY 3, 1, 2;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_eventos_custodia(
  _custodia_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (item jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  IF NOT EXISTS (
    SELECT 1 FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = _custodia_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005',
      MESSAGE = 'Operação de custódia não encontrada.';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', event.id,
    'tipo', event.tipo,
    'quantidade', event.quantidade,
    'localizacao_origem_nome', origin.nome,
    'localizacao_destino_nome', destination.nome,
    'condicao', event.condicao,
    'ocorrencia', event.ocorrencia,
    'observacao', event.observacao,
    'justificativa', event.justificativa,
    'data_efetiva', event.data_efetiva,
    'executado_por', event.executado_por,
    'executor_nome', COALESCE(actor.full_name, 'Usuário'),
    'movimento_estoque_id', event.movimento_estoque_id,
    'created_at', event.created_at
  )
  FROM public.material_custodia_eventos AS event
  LEFT JOIN public.estoque_localizacoes AS origin
    ON origin.empresa_id = event.empresa_id
   AND origin.id = event.localizacao_origem_id
  LEFT JOIN public.estoque_localizacoes AS destination
    ON destination.empresa_id = event.empresa_id
   AND destination.id = event.localizacao_destino_id
  LEFT JOIN public.profiles AS actor
    ON actor.user_id = event.executado_por
  WHERE event.empresa_id = v_company_id
    AND event.custodia_id = _custodia_id
  ORDER BY event.data_efetiva, event.created_at, event.id;
END;
$$;

ALTER TABLE public.material_custodias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_custodia_eventos ENABLE ROW LEVEL SECURITY;

-- Stage 2 kept the entitlement helper private but referenced it directly from
-- these RLS policies. PostgreSQL checks EXECUTE for policy expressions, so an
-- authenticated read failed before tenant filtering could run. Route every
-- client-facing policy through the granted SECURITY DEFINER authorization
-- facade and keep the lower-level entitlement helper private.
DROP POLICY IF EXISTS "Company users read stock locations"
  ON public.estoque_localizacoes;
CREATE POLICY "Company users read stock locations"
ON public.estoque_localizacoes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
);

DROP POLICY IF EXISTS "Company users read stock balances"
  ON public.estoque_saldos;
CREATE POLICY "Company users read stock balances"
ON public.estoque_saldos FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
);

DROP POLICY IF EXISTS "Company users read stock movements"
  ON public.estoque_movimentacoes;
CREATE POLICY "Company users read stock movements"
ON public.estoque_movimentacoes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Company users read material custodies"
ON public.material_custodias FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'checkin_checkout')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
);

CREATE POLICY "Company users read material custody events"
ON public.material_custodia_eventos FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'checkin_checkout')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
);

REVOKE ALL ON public.material_custodias FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.material_custodia_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.material_custodias TO authenticated;
GRANT SELECT ON public.material_custodia_eventos TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_custody_company(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_custody_responsible_name(
  uuid, public.material_custody_responsible_type, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_material_custody_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_stock_movement(
  uuid, uuid, public.estoque_movimentacao_tipo, integer, uuid, uuid,
  text, text, text, text, timestamptz, public.estoque_origem_modulo,
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_checkout_material(
  uuid, integer, uuid, text, uuid, text, text, uuid,
  timestamptz, text, text, uuid, timestamptz, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_checkin_material(
  uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cancelar_checkout_material(
  uuid, text, uuid, timestamptz, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.buscar_materiais_custodia(text, uuid, integer)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_custodias_materiais(
  integer, integer, text, text, text, text, uuid, uuid,
  date, date, boolean, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_indicadores_custodia(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_responsaveis_custodia(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_eventos_custodia(uuid, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.registrar_checkout_material(
  uuid, integer, uuid, text, uuid, text, text, uuid,
  timestamptz, text, text, uuid, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_checkin_material(
  uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_checkout_material(
  uuid, text, uuid, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_materiais_custodia(text, uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_custodias_materiais(
  integer, integer, text, text, text, text, uuid, uuid,
  date, date, boolean, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_indicadores_custodia(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_responsaveis_custodia(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_eventos_custodia(uuid, uuid)
  TO authenticated;

COMMENT ON TABLE public.material_custodias IS
  'Current custody operation with immutable checkout facts and database-maintained return projection.';
COMMENT ON TABLE public.material_custodia_eventos IS
  'Append-only custody history linked to immutable canonical stock movements.';
COMMENT ON COLUMN public.material_custodias.responsavel_nome IS
  'Historical snapshot of the canonical profile/employee name at checkout time.';
COMMENT ON COLUMN public.material_custodias.referencia_tipo IS
  'Extensible future context discriminator; Stage 3 does not implement rental, billing or parallel entities.';
COMMENT ON FUNCTION public.registrar_checkout_material(
  uuid, integer, uuid, text, uuid, text, text, uuid,
  timestamptz, text, text, uuid, timestamptz, uuid
) IS 'Atomically creates custody and debits the official stock ledger.';
COMMENT ON FUNCTION public.registrar_checkin_material(
  uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid
) IS 'Atomically records a partial/total return and credits the official stock ledger.';
COMMENT ON FUNCTION public.cancelar_checkout_material(
  uuid, text, uuid, timestamptz, uuid
) IS 'Cancels an untouched checkout through an explicit immutable stock reversal.';

CREATE TRIGGER protect_material_custodias
BEFORE UPDATE OR DELETE ON public.material_custodias
FOR EACH ROW EXECUTE FUNCTION public.protect_material_custody_history();

CREATE TRIGGER protect_material_custodia_eventos
BEFORE UPDATE OR DELETE ON public.material_custodia_eventos
FOR EACH ROW EXECUTE FUNCTION public.protect_material_custody_history();

-- Stage 2 intentionally reserved the checkin_checkout source value but kept it
-- disabled. Replace the same canonical internal writer, changing only the
-- allowed-source contract. All locking, balance validation and immutable
-- ledger behavior remain centralized here.
CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  _company_id uuid,
  _material_id uuid,
  _type public.estoque_movimentacao_tipo,
  _quantity integer,
  _origin_location_id uuid,
  _destination_location_id uuid,
  _reason text,
  _justification text,
  _note text,
  _reference_document text,
  _effective_at timestamptz,
  _source_module public.estoque_origem_modulo,
  _source_id uuid,
  _client_uuid uuid,
  _payload_hash text,
  _reversed_movement_id uuid DEFAULT NULL
)
RETURNS public.estoque_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_material public.materiais%ROWTYPE;
  v_existing public.estoque_movimentacoes%ROWTYPE;
  v_result public.estoque_movimentacoes%ROWTYPE;
  v_origin_before integer;
  v_origin_after integer;
  v_destination_before integer;
  v_destination_after integer;
  v_total_before integer;
  v_total_after integer;
  v_projection integer;
  v_destination_active boolean;
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Informe uma quantidade inteira maior que zero.';
  END IF;
  IF _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004',
      MESSAGE = 'Identificador da operação é obrigatório.';
  END IF;
  IF _source_module NOT IN ('manual', 'controle_estoque', 'checkin_checkout') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST011',
      MESSAGE = 'O módulo de origem ainda não está autorizado a movimentar estoque.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_company_id::text || ':' || _client_uuid::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.estoque_movimentacoes
  WHERE empresa_id = _company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> _payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'ST013',
        MESSAGE = 'Esta operação já foi enviada com dados diferentes.';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT * INTO v_material
  FROM public.materiais
  WHERE empresa_id = _company_id AND id = _material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ST005', MESSAGE = 'Material não encontrado.';
  END IF;
  IF NOT v_material.ativo AND _type <> 'estorno' THEN
    RAISE EXCEPTION USING ERRCODE = 'ST008',
      MESSAGE = 'Material inativo não pode receber novas movimentações.';
  END IF;

  IF _origin_location_id IS NOT NULL
     AND _destination_location_id IS NOT NULL
     AND _origin_location_id = _destination_location_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ST007',
      MESSAGE = 'Origem e destino devem ser diferentes.';
  END IF;

  PERFORM 1
  FROM public.estoque_localizacoes
  WHERE empresa_id = _company_id
    AND (id = _origin_location_id OR id = _destination_location_id)
  ORDER BY id
  FOR UPDATE;

  IF _origin_location_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.estoque_localizacoes
      WHERE empresa_id = _company_id AND id = _origin_location_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ST005',
        MESSAGE = 'Localização de origem inválida.';
    END IF;
    INSERT INTO public.estoque_saldos
      (empresa_id, material_id, localizacao_id, quantidade)
    VALUES (_company_id, _material_id, _origin_location_id, 0)
    ON CONFLICT (empresa_id, material_id, localizacao_id) DO NOTHING;
  END IF;

  IF _destination_location_id IS NOT NULL THEN
    SELECT ativa INTO v_destination_active
    FROM public.estoque_localizacoes
    WHERE empresa_id = _company_id AND id = _destination_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'ST005',
        MESSAGE = 'Localização de destino inválida.';
    END IF;
    IF NOT v_destination_active AND _type <> 'estorno' THEN
      RAISE EXCEPTION USING ERRCODE = 'ST006',
        MESSAGE = 'Localização inativa não pode receber materiais.';
    END IF;
    INSERT INTO public.estoque_saldos
      (empresa_id, material_id, localizacao_id, quantidade)
    VALUES (_company_id, _material_id, _destination_location_id, 0)
    ON CONFLICT (empresa_id, material_id, localizacao_id) DO NOTHING;
  END IF;

  PERFORM 1 FROM public.estoque_saldos
  WHERE empresa_id = _company_id AND material_id = _material_id
  ORDER BY localizacao_id
  FOR UPDATE;

  SELECT COALESCE(sum(quantidade), 0)::integer INTO v_total_before
  FROM public.estoque_saldos
  WHERE empresa_id = _company_id AND material_id = _material_id;
  v_projection := v_material.quantidade;
  IF v_projection <> v_total_before THEN
    RAISE EXCEPTION USING ERRCODE = 'ST020',
      MESSAGE = 'Foi detectada divergência no saldo. Contate o suporte.';
  END IF;

  IF _origin_location_id IS NOT NULL THEN
    SELECT quantidade INTO v_origin_before
    FROM public.estoque_saldos
    WHERE empresa_id = _company_id
      AND material_id = _material_id
      AND localizacao_id = _origin_location_id;
    IF v_origin_before < _quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'ST001',
        MESSAGE = 'Saldo insuficiente na localização de origem.';
    END IF;
    v_origin_after := v_origin_before - _quantity;
  END IF;

  IF _destination_location_id IS NOT NULL THEN
    SELECT quantidade INTO v_destination_before
    FROM public.estoque_saldos
    WHERE empresa_id = _company_id
      AND material_id = _material_id
      AND localizacao_id = _destination_location_id;
    v_destination_after := v_destination_before + _quantity;
  END IF;

  v_total_after := v_total_before
    - CASE WHEN _origin_location_id IS NULL THEN 0 ELSE _quantity END
    + CASE WHEN _destination_location_id IS NULL THEN 0 ELSE _quantity END;

  IF v_total_after < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST001', MESSAGE = 'Saldo insuficiente.';
  END IF;
  IF v_material.tipo_controle = 'individual' AND v_total_after NOT IN (0, 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST002',
      MESSAGE = 'Um material individual só pode ter saldo total zero ou um.';
  END IF;
  IF _type = 'saldo_inicial' AND EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes
    WHERE empresa_id = _company_id
      AND material_id = _material_id
      AND tipo_movimentacao = 'saldo_inicial'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST012',
      MESSAGE = 'O saldo inicial deste material já foi registrado.';
  END IF;

  IF _origin_location_id IS NOT NULL THEN
    UPDATE public.estoque_saldos
    SET quantidade = v_origin_after, updated_at = clock_timestamp()
    WHERE empresa_id = _company_id
      AND material_id = _material_id
      AND localizacao_id = _origin_location_id;
  END IF;
  IF _destination_location_id IS NOT NULL THEN
    UPDATE public.estoque_saldos
    SET quantidade = v_destination_after, updated_at = clock_timestamp()
    WHERE empresa_id = _company_id
      AND material_id = _material_id
      AND localizacao_id = _destination_location_id;
  END IF;

  INSERT INTO public.estoque_movimentacoes (
    empresa_id, material_id, tipo_movimentacao, quantidade,
    localizacao_origem_id, localizacao_destino_id,
    saldo_origem_anterior, saldo_origem_posterior,
    saldo_destino_anterior, saldo_destino_posterior,
    saldo_total_anterior, saldo_total_posterior,
    motivo, justificativa, observacao, documento_referencia,
    data_efetiva, origem_modulo, origem_id,
    client_uuid, payload_hash, movimentacao_estornada_id, created_by
  ) VALUES (
    _company_id, _material_id, _type, _quantity,
    _origin_location_id, _destination_location_id,
    v_origin_before, v_origin_after,
    v_destination_before, v_destination_after,
    v_total_before, v_total_after,
    nullif(btrim(_reason), ''), nullif(btrim(_justification), ''),
    nullif(btrim(_note), ''), nullif(btrim(_reference_document), ''),
    COALESCE(_effective_at, clock_timestamp()), _source_module, _source_id,
    _client_uuid, _payload_hash, _reversed_movement_id, auth.uid()
  )
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
