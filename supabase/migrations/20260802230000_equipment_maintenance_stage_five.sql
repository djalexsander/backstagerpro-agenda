-- Backstage Pro - Stage 5: preventive/corrective equipment maintenance.
-- Maintenance is an operational availability domain. It never changes stock
-- balances and never duplicates physical custody.

UPDATE public.module_catalog
SET nome = 'Manutenção de Equipamentos',
    descricao = 'Ordens preventivas, corretivas e inspeções com indisponibilidade operacional.',
    ativo = true,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'planned')
      || '{"area":"materiais","stage":5,"operational":true}'::jsonb,
    texto_venda = 'Controle manutenção, custos, histórico e disponibilidade dos seus equipamentos.',
    updated_at = clock_timestamp()
WHERE feature_key = 'manutencao_equipamentos';

-- Maintenance only requires the canonical material registry. Stock and
-- custody are optional integrations: maintenance does not move physical stock,
-- and manual/preventive orders remain valid without checkout enabled.
INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT maintenance.id, materials.id
FROM public.module_catalog AS maintenance
JOIN public.module_catalog AS materials
  ON materials.feature_key = 'gestao_materiais'
WHERE maintenance.feature_key = 'manutencao_equipamentos'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

CREATE TYPE public.equipment_maintenance_type AS ENUM (
  'corretiva', 'preventiva', 'inspecao'
);
CREATE TYPE public.equipment_maintenance_status AS ENUM (
  'aberta', 'aguardando_analise', 'em_manutencao',
  'aguardando_peca', 'concluida', 'cancelada'
);
CREATE TYPE public.equipment_maintenance_priority AS ENUM (
  'baixa', 'normal', 'alta', 'critica'
);
CREATE TYPE public.equipment_maintenance_origin AS ENUM (
  'manual', 'checkin', 'inspecao', 'preventiva', 'defeito_operacional'
);
CREATE TYPE public.equipment_maintenance_execution AS ENUM (
  'interna', 'externa'
);
CREATE TYPE public.equipment_maintenance_event_type AS ENUM (
  'criacao', 'edicao', 'mudanca_status', 'diagnostico', 'inicio',
  'conclusao', 'cancelamento', 'insumo_adicionado', 'insumo_removido'
);

CREATE TABLE public.manutencao_equipamento_numeradores (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  ano integer NOT NULL,
  ultimo_numero integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, ano),
  CONSTRAINT manutencao_numeradores_ano CHECK (ano BETWEEN 2000 AND 9999),
  CONSTRAINT manutencao_numeradores_valor CHECK (ultimo_numero >= 0)
);

CREATE TABLE public.manutencao_ordens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL,
  numero text NOT NULL,
  tipo public.equipment_maintenance_type NOT NULL,
  status public.equipment_maintenance_status NOT NULL DEFAULT 'aberta',
  prioridade public.equipment_maintenance_priority NOT NULL DEFAULT 'normal',
  origem public.equipment_maintenance_origin NOT NULL DEFAULT 'manual',
  tipo_controle public.material_control_type NOT NULL,
  quantidade_afetada integer NOT NULL DEFAULT 1,
  defeito_relatado text NOT NULL,
  diagnostico text,
  servico_executado text,
  condicao_entrada text,
  condicao_saida text,
  observacoes text,
  modalidade_execucao public.equipment_maintenance_execution NOT NULL DEFAULT 'interna',
  responsavel_tipo public.material_custody_responsible_type,
  responsavel_usuario_id uuid,
  responsavel_funcionario_id uuid,
  responsavel_nome text,
  fornecedor_externo text,
  aberta_em timestamptz NOT NULL DEFAULT now(),
  previsao_conclusao_em timestamptz,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  cancelada_em timestamptz,
  intervalo_preventivo_dias integer,
  proxima_preventiva_em date,
  custo_mao_obra numeric(14,2) NOT NULL DEFAULT 0,
  custo_pecas numeric(14,2) NOT NULL DEFAULT 0,
  custo_outros numeric(14,2) NOT NULL DEFAULT 0,
  custo_total numeric(14,2) GENERATED ALWAYS AS (
    round(custo_mao_obra + custo_pecas + custo_outros, 2)
  ) STORED,
  custodia_evento_origem_id uuid,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manutencao_ordens_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT manutencao_ordens_empresa_numero_unique UNIQUE (empresa_id, numero),
  CONSTRAINT manutencao_ordens_empresa_client_unique UNIQUE (empresa_id, client_uuid),
  CONSTRAINT manutencao_ordens_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT manutencao_ordens_numero_not_blank CHECK (btrim(numero) <> ''),
  CONSTRAINT manutencao_ordens_defeito_not_blank CHECK (btrim(defeito_relatado) <> ''),
  CONSTRAINT manutencao_ordens_payload_hash_not_blank CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT manutencao_ordens_quantidade_positive CHECK (quantidade_afetada > 0),
  CONSTRAINT manutencao_ordens_individual_quantity
    CHECK (tipo_controle <> 'individual' OR quantidade_afetada = 1),
  CONSTRAINT manutencao_ordens_costs_nonnegative CHECK (
    custo_mao_obra >= 0 AND custo_pecas >= 0 AND custo_outros >= 0
  ),
  CONSTRAINT manutencao_ordens_preventive_interval CHECK (
    intervalo_preventivo_dias IS NULL OR intervalo_preventivo_dias BETWEEN 1 AND 3650
  ),
  CONSTRAINT manutencao_ordens_responsavel_shape CHECK (
    (responsavel_tipo IS NULL AND responsavel_usuario_id IS NULL AND responsavel_funcionario_id IS NULL)
    OR (responsavel_tipo = 'usuario' AND responsavel_usuario_id IS NOT NULL AND responsavel_funcionario_id IS NULL)
    OR (responsavel_tipo = 'funcionario' AND responsavel_funcionario_id IS NOT NULL AND responsavel_usuario_id IS NULL)
  ),
  CONSTRAINT manutencao_ordens_external_shape CHECK (
    modalidade_execucao <> 'externa' OR nullif(btrim(fornecedor_externo), '') IS NOT NULL
  ),
  CONSTRAINT manutencao_ordens_origin_shape CHECK (
    (origem = 'checkin' AND custodia_evento_origem_id IS NOT NULL)
    OR (origem <> 'checkin' AND custodia_evento_origem_id IS NULL)
  ),
  CONSTRAINT manutencao_ordens_status_dates CHECK (
    (status IN ('aberta', 'aguardando_analise', 'aguardando_peca') AND concluida_em IS NULL AND cancelada_em IS NULL)
    OR (status = 'em_manutencao' AND iniciada_em IS NOT NULL AND concluida_em IS NULL AND cancelada_em IS NULL)
    OR (status = 'concluida' AND iniciada_em IS NOT NULL AND concluida_em IS NOT NULL AND cancelada_em IS NULL)
    OR (status = 'cancelada' AND concluida_em IS NULL AND cancelada_em IS NOT NULL)
  )
);

ALTER TABLE public.material_custodia_eventos
  ADD CONSTRAINT material_custodia_eventos_empresa_id_id_unique
  UNIQUE (empresa_id, id);

ALTER TABLE public.manutencao_ordens
  ADD CONSTRAINT manutencao_ordens_empresa_checkin_event_fkey
  FOREIGN KEY (empresa_id, custodia_evento_origem_id)
  REFERENCES public.material_custodia_eventos (empresa_id, id) ON DELETE RESTRICT;

CREATE TABLE public.manutencao_ordem_insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  ordem_id uuid NOT NULL,
  material_id uuid,
  descricao text NOT NULL,
  quantidade numeric(12,3) NOT NULL DEFAULT 1,
  unidade text NOT NULL DEFAULT 'un',
  custo_unitario numeric(14,2) NOT NULL DEFAULT 0,
  custo_total numeric(14,2) GENERATED ALWAYS AS (
    round(quantidade * custo_unitario, 2)
  ) STORED,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manutencao_insumos_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT manutencao_insumos_empresa_ordem_fkey
    FOREIGN KEY (empresa_id, ordem_id)
    REFERENCES public.manutencao_ordens (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT manutencao_insumos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT manutencao_insumos_descricao_not_blank CHECK (btrim(descricao) <> ''),
  CONSTRAINT manutencao_insumos_unidade_not_blank CHECK (btrim(unidade) <> ''),
  CONSTRAINT manutencao_insumos_values CHECK (quantidade > 0 AND custo_unitario >= 0)
);

CREATE TABLE public.manutencao_ordem_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  ordem_id uuid NOT NULL,
  tipo public.equipment_maintenance_event_type NOT NULL,
  status_anterior public.equipment_maintenance_status,
  status_novo public.equipment_maintenance_status,
  descricao text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  executado_por uuid NOT NULL,
  data_efetiva timestamptz NOT NULL DEFAULT now(),
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manutencao_eventos_empresa_ordem_fkey
    FOREIGN KEY (empresa_id, ordem_id)
    REFERENCES public.manutencao_ordens (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT manutencao_eventos_empresa_client_unique UNIQUE (empresa_id, client_uuid),
  CONSTRAINT manutencao_eventos_descricao_not_blank CHECK (btrim(descricao) <> ''),
  CONSTRAINT manutencao_eventos_payload_hash_not_blank CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT manutencao_eventos_status_pair CHECK (
    (tipo = 'mudanca_status' AND status_anterior IS NOT NULL AND status_novo IS NOT NULL)
    OR (tipo <> 'mudanca_status')
  )
);

CREATE UNIQUE INDEX manutencao_ordens_individual_active_uidx
  ON public.manutencao_ordens (empresa_id, material_id)
  WHERE tipo_controle = 'individual'
    AND status IN ('aberta', 'aguardando_analise', 'em_manutencao', 'aguardando_peca');
CREATE INDEX manutencao_ordens_company_status_due_idx
  ON public.manutencao_ordens (empresa_id, status, previsao_conclusao_em, id);
CREATE INDEX manutencao_ordens_company_priority_open_idx
  ON public.manutencao_ordens (empresa_id, prioridade, aberta_em DESC, id DESC);
CREATE INDEX manutencao_ordens_material_history_idx
  ON public.manutencao_ordens (empresa_id, material_id, aberta_em DESC, id DESC);
CREATE INDEX manutencao_ordens_responsible_idx
  ON public.manutencao_ordens (empresa_id, responsavel_tipo, responsavel_usuario_id, responsavel_funcionario_id, status);
CREATE INDEX manutencao_ordens_next_preventive_idx
  ON public.manutencao_ordens (empresa_id, proxima_preventiva_em, material_id)
  WHERE status = 'concluida' AND proxima_preventiva_em IS NOT NULL;
CREATE INDEX manutencao_eventos_order_date_idx
  ON public.manutencao_ordem_eventos (empresa_id, ordem_id, data_efetiva DESC, id DESC);
CREATE INDEX manutencao_insumos_order_idx
  ON public.manutencao_ordem_insumos (empresa_id, ordem_id, created_at, id);

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
  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'MT011', MESSAGE = 'Selecione a empresa para operar manutenções.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'manutencao_equipamentos')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT009', MESSAGE = 'Manutenção e Gestão de Materiais precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT010', MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'manutencao_equipamentos'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'manutencao_equipamentos')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_equipment_maintenance_number(
  _company_id uuid,
  _at timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM COALESCE(_at, clock_timestamp()))::integer;
  v_value integer;
BEGIN
  INSERT INTO public.manutencao_equipamento_numeradores (empresa_id, ano, ultimo_numero)
  VALUES (_company_id, v_year, 1)
  ON CONFLICT (empresa_id, ano) DO UPDATE
    SET ultimo_numero = manutencao_equipamento_numeradores.ultimo_numero + 1,
        updated_at = clock_timestamp()
  RETURNING ultimo_numero INTO v_value;
  RETURN 'MAN-' || v_year::text || '-' || lpad(v_value::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_equipment_maintenance_responsible(
  _company_id uuid,
  _responsible_type public.material_custody_responsible_type,
  _responsible_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_name text;
BEGIN
  IF _responsible_type IS NULL AND _responsible_id IS NULL THEN RETURN NULL; END IF;
  IF _responsible_type IS NULL OR _responsible_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Tipo e responsável devem ser informados juntos.';
  END IF;
  IF _responsible_type = 'usuario' THEN
    SELECT p.full_name INTO v_name FROM public.profiles AS p
    WHERE p.empresa_id = _company_id AND p.user_id = _responsible_id AND p.ativado;
  ELSE
    SELECT f.nome INTO v_name FROM public.funcionarios AS f
    WHERE f.empresa_id = _company_id AND f.id = _responsible_id;
  END IF;
  IF nullif(btrim(v_name), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Responsável não encontrado na empresa.';
  END IF;
  RETURN v_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.equipment_maintenance_transition_allowed(
  _from public.equipment_maintenance_status,
  _to public.equipment_maintenance_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE _from
    WHEN 'aberta' THEN _to IN ('aguardando_analise', 'em_manutencao', 'cancelada')
    WHEN 'aguardando_analise' THEN _to IN ('em_manutencao', 'aguardando_peca', 'cancelada')
    WHEN 'em_manutencao' THEN _to IN ('aguardando_peca', 'concluida', 'cancelada')
    WHEN 'aguardando_peca' THEN _to IN ('em_manutencao', 'concluida', 'cancelada')
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.protect_equipment_maintenance_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('backstage.equipment_maintenance_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use as operações canônicas de manutenção.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_equipment_maintenance_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'O histórico de manutenção é imutável.';
END;
$$;

CREATE OR REPLACE FUNCTION public.equipment_active_maintenance_quantity(
  _company_id uuid,
  _material_id uuid,
  _exclude_order_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(sum(o.quantidade_afetada), 0)::bigint
  FROM public.manutencao_ordens AS o
  WHERE o.empresa_id = _company_id
    AND o.material_id = _material_id
    AND o.status IN ('aberta', 'aguardando_analise', 'em_manutencao', 'aguardando_peca')
    AND (_exclude_order_id IS NULL OR o.id <> _exclude_order_id)
$$;

CREATE OR REPLACE FUNCTION public.material_is_operationally_available(
  _company_id uuid,
  _material_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.materiais AS m
    WHERE m.empresa_id = _company_id AND m.id = _material_id
      AND m.ativo AND m.status_operacional = 'disponivel'
      AND (m.tipo_controle <> 'individual'
        OR public.equipment_active_maintenance_quantity(_company_id, _material_id) = 0)
  )
$$;

CREATE OR REPLACE FUNCTION public.block_custody_when_maintenance_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_maintenance bigint;
  v_remaining bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.empresa_id::text || ':operational-material:' || NEW.material_id::text, 0));
  v_maintenance := public.equipment_active_maintenance_quantity(NEW.empresa_id, NEW.material_id);
  IF NEW.tipo_controle = 'individual' AND v_maintenance > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'Material em manutenção não pode realizar check-out.';
  END IF;
  IF NEW.tipo_controle = 'quantidade' AND v_maintenance > 0 THEN
    SELECT COALESCE(sum(s.quantidade), 0)::bigint INTO v_remaining
    FROM public.estoque_saldos AS s
    WHERE s.empresa_id = NEW.empresa_id AND s.material_id = NEW.material_id;
    IF v_remaining < v_maintenance THEN
      RAISE EXCEPTION USING ERRCODE = 'MT012', MESSAGE = 'A quantidade disponível exclui itens em manutenção.';
    END IF;
  END IF;
  RETURN NEW;
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

CREATE OR REPLACE FUNCTION public.listar_ordens_manutencao(
  _pagina integer DEFAULT 1,
  _por_pagina integer DEFAULT 20,
  _busca text DEFAULT NULL,
  _status text DEFAULT NULL,
  _tipo text DEFAULT NULL,
  _prioridade text DEFAULT NULL,
  _responsavel text DEFAULT NULL,
  _material_id uuid DEFAULT NULL,
  _inicio timestamptz DEFAULT NULL,
  _fim timestamptz DEFAULT NULL,
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
  v_status public.equipment_maintenance_status;
  v_type public.equipment_maintenance_type;
  v_priority public.equipment_maintenance_priority;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  IF COALESCE(_pagina, 0) < 1 OR COALESCE(_por_pagina, 0) < 1 OR _por_pagina > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Paginação inválida.';
  END IF;
  BEGIN
    IF _status IS NOT NULL THEN v_status := _status::public.equipment_maintenance_status; END IF;
    IF _tipo IS NOT NULL THEN v_type := _tipo::public.equipment_maintenance_type; END IF;
    IF _prioridade IS NOT NULL THEN v_priority := _prioridade::public.equipment_maintenance_priority; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'MT004', MESSAGE = 'Filtro de status, tipo ou prioridade inválido.';
  END;
  RETURN QUERY
  WITH filtered AS (
    SELECT o.*, m.nome AS material_nome, m.codigo_interno AS material_codigo,
      m.identificador_unico, m.numero_serie, m.numero_patrimonio,
      count(*) OVER() AS total
    FROM public.manutencao_ordens AS o
    JOIN public.materiais AS m ON m.empresa_id = o.empresa_id AND m.id = o.material_id
    WHERE o.empresa_id = v_company_id
      AND (v_status IS NULL OR o.status = v_status)
      AND (v_type IS NULL OR o.tipo = v_type)
      AND (v_priority IS NULL OR o.prioridade = v_priority)
      AND (_material_id IS NULL OR o.material_id = _material_id)
      AND (_inicio IS NULL OR o.aberta_em >= _inicio)
      AND (_fim IS NULL OR o.aberta_em <= _fim)
      AND (nullif(btrim(_responsavel), '') IS NULL OR COALESCE(o.responsavel_nome, '') ILIKE '%' || btrim(_responsavel) || '%')
      AND (nullif(btrim(_busca), '') IS NULL
        OR o.numero ILIKE '%' || btrim(_busca) || '%'
        OR m.nome ILIKE '%' || btrim(_busca) || '%'
        OR m.codigo_interno ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(m.codigo_barras, '') = btrim(_busca)
        OR m.identificador_unico::text = btrim(_busca)
        OR COALESCE(m.numero_serie, '') ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(m.numero_patrimonio, '') ILIKE '%' || btrim(_busca) || '%')
    ORDER BY o.aberta_em DESC, o.id DESC
    OFFSET (_pagina - 1) * _por_pagina LIMIT _por_pagina
  )
  SELECT jsonb_build_object(
    'id', f.id, 'empresa_id', f.empresa_id, 'material_id', f.material_id,
    'numero', f.numero, 'tipo', f.tipo, 'status', f.status, 'prioridade', f.prioridade,
    'origem', f.origem, 'quantidade_afetada', f.quantidade_afetada,
    'material_nome', f.material_nome, 'material_codigo', f.material_codigo,
    'identificador_unico', f.identificador_unico, 'numero_serie', f.numero_serie,
    'numero_patrimonio', f.numero_patrimonio, 'responsavel_nome', f.responsavel_nome,
    'aberta_em', f.aberta_em, 'previsao_conclusao_em', f.previsao_conclusao_em,
    'custo_total', f.custo_total,
    'atrasada', f.previsao_conclusao_em IS NOT NULL AND f.previsao_conclusao_em < clock_timestamp()
      AND f.status NOT IN ('concluida', 'cancelada')
  ), f.total FROM filtered AS f;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_indicadores_manutencao(
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  RETURN (
    SELECT jsonb_build_object(
      'abertas', count(*) FILTER (WHERE status IN ('aberta', 'aguardando_analise')),
      'em_manutencao', count(*) FILTER (WHERE status = 'em_manutencao'),
      'aguardando_peca', count(*) FILTER (WHERE status = 'aguardando_peca'),
      'preventivas_proximas', count(*) FILTER (WHERE status = 'concluida' AND proxima_preventiva_em BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),
      'atrasadas', count(*) FILTER (WHERE status NOT IN ('concluida', 'cancelada') AND previsao_conclusao_em < clock_timestamp())
    ) FROM public.manutencao_ordens WHERE empresa_id = v_company_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_ordem_manutencao(
  _ordem_id uuid,
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
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  SELECT to_jsonb(o) || jsonb_build_object(
    'material', jsonb_build_object(
      'id', m.id, 'nome', m.nome, 'codigo_interno', m.codigo_interno,
      'identificador_unico', m.identificador_unico, 'numero_serie', m.numero_serie,
      'numero_patrimonio', m.numero_patrimonio, 'tipo_controle', m.tipo_controle,
      'foto_path', photo.storage_path
    ),
    'insumos', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at, i.id)
      FROM public.manutencao_ordem_insumos AS i WHERE i.empresa_id = o.empresa_id AND i.ordem_id = o.id), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('executor_nome', COALESCE(p.full_name, 'Usuário')) ORDER BY e.data_efetiva DESC, e.id DESC)
      FROM public.manutencao_ordem_eventos AS e LEFT JOIN public.profiles AS p ON p.user_id = e.executado_por
      WHERE e.empresa_id = o.empresa_id AND e.ordem_id = o.id), '[]'::jsonb),
    'checkin_origem', CASE WHEN ce.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', ce.id, 'custodia_id', ce.custodia_id, 'condicao', ce.condicao,
      'ocorrencia', ce.ocorrencia, 'observacao', ce.observacao, 'data_efetiva', ce.data_efetiva) END
  ) INTO v_result
  FROM public.manutencao_ordens AS o
  JOIN public.materiais AS m ON m.empresa_id = o.empresa_id AND m.id = o.material_id
  LEFT JOIN public.material_custodia_eventos AS ce ON ce.empresa_id = o.empresa_id AND ce.id = o.custodia_evento_origem_id
  LEFT JOIN LATERAL (
    SELECT f.storage_path FROM public.materiais_fotos AS f
    WHERE f.empresa_id = m.empresa_id AND f.material_id = m.id
    ORDER BY f.foto_principal DESC, f.created_at, f.id LIMIT 1
  ) AS photo ON true
  WHERE o.empresa_id = v_company_id AND o.id = _ordem_id;
  IF v_result IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Ordem de manutenção não encontrada.'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.buscar_materiais_manutencao(
  _busca text,
  _limite integer DEFAULT 40,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (item jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  RETURN QUERY SELECT jsonb_build_object(
    'id', m.id, 'nome', m.nome, 'codigo_interno', m.codigo_interno,
    'identificador_unico', m.identificador_unico, 'codigo_barras', m.codigo_barras,
    'conteudo_qr_code', m.conteudo_qr_code, 'numero_serie', m.numero_serie,
    'numero_patrimonio', m.numero_patrimonio, 'tipo_controle', m.tipo_controle,
    'unidade_medida', m.unidade_medida, 'quantidade', m.quantidade,
    'status_operacional', m.status_operacional, 'foto_path', photo.storage_path,
    'quantidade_em_manutencao', public.equipment_active_maintenance_quantity(v_company_id, m.id)
  )
  FROM public.materiais AS m
  LEFT JOIN LATERAL (
    SELECT f.storage_path FROM public.materiais_fotos AS f
    WHERE f.empresa_id = m.empresa_id AND f.material_id = m.id
    ORDER BY f.foto_principal DESC, f.created_at, f.id LIMIT 1
  ) AS photo ON true
  WHERE m.empresa_id = v_company_id AND m.ativo
    AND (nullif(btrim(_busca), '') IS NULL OR m.nome ILIKE '%' || btrim(_busca) || '%'
      OR m.codigo_interno ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(m.codigo_barras, '') = btrim(_busca)
      OR m.identificador_unico::text = btrim(_busca)
      OR COALESCE(m.conteudo_qr_code, '') = btrim(_busca)
      OR COALESCE(m.numero_serie, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(m.numero_patrimonio, '') ILIKE '%' || btrim(_busca) || '%')
  ORDER BY m.nome, m.codigo_interno, m.id
  LIMIT greatest(1, least(COALESCE(_limite, 40), 100));
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_sugestao_manutencao_checkin(
  _custodia_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid; v_result jsonb;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  SELECT jsonb_build_object('evento_id', e.id, 'custodia_id', e.custodia_id,
    'material_id', e.material_id, 'quantidade', e.quantidade, 'condicao', e.condicao,
    'defeito_relatado', COALESCE(nullif(btrim(e.ocorrencia), ''), nullif(btrim(e.observacao), ''), 'Avaria identificada no Check-in'))
  INTO v_result FROM public.material_custodia_eventos AS e
  WHERE e.empresa_id = v_company_id AND e.custodia_id = _custodia_id AND e.tipo = 'checkin'
    AND e.condicao IN ('com_avaria', 'danificado', 'manutencao_necessaria')
  ORDER BY e.data_efetiva DESC, e.id DESC LIMIT 1;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_resumo_manutencao_material(
  _material_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_equipment_maintenance_company(_empresa_id, false);
  IF NOT EXISTS (SELECT 1 FROM public.materiais WHERE empresa_id = v_company_id AND id = _material_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT005', MESSAGE = 'Material não encontrado.';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'manutencoes_ativas', count(*) FILTER (WHERE status IN ('aberta','aguardando_analise','em_manutencao','aguardando_peca')),
    'quantidade_indisponivel', COALESCE(sum(quantidade_afetada) FILTER (WHERE status IN ('aberta','aguardando_analise','em_manutencao','aguardando_peca')), 0),
    'ultima_manutencao_em', max(concluida_em) FILTER (WHERE status = 'concluida'),
    'proxima_preventiva_em', min(proxima_preventiva_em) FILTER (WHERE status = 'concluida' AND proxima_preventiva_em >= CURRENT_DATE),
    'custo_acumulado', COALESCE(sum(custo_total) FILTER (WHERE status = 'concluida'), 0),
    'historico_total', count(*)
  ) FROM public.manutencao_ordens WHERE empresa_id = v_company_id AND material_id = _material_id);
END;
$$;

-- Extend the Stage 4 canonical availability engine. Maintenance is subtracted
-- from operational availability but never from physical stock.
CREATE OR REPLACE FUNCTION public.material_rental_availability(
  _company_id uuid,
  _material_id uuid,
  _start_at timestamptz,
  _end_at timestamptz,
  _exclude_rental_id uuid DEFAULT NULL
)
RETURNS TABLE (estoque_fisico bigint, reservado bigint, disponivel bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH physical AS (
    SELECT COALESCE(sum(balance.quantidade), 0)::bigint AS quantity
    FROM public.estoque_saldos AS balance
    JOIN public.estoque_localizacoes AS location
      ON location.empresa_id = balance.empresa_id
     AND location.id = balance.localizacao_id AND location.ativa = true
    WHERE balance.empresa_id = _company_id AND balance.material_id = _material_id
  ), reservations AS (
    SELECT COALESCE(sum(greatest(item.quantidade_contratada - operational.retirada::integer, 0)), 0)::bigint AS quantity
    FROM public.material_locacao_itens AS item
    JOIN public.material_locacoes AS rental ON rental.empresa_id = item.empresa_id AND rental.id = item.locacao_id
    CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
    WHERE item.empresa_id = _company_id AND item.material_id = _material_id
      AND rental.status IN ('reservada', 'pronta_retirada', 'em_andamento', 'parcialmente_devolvida')
      AND (_exclude_rental_id IS NULL OR rental.id <> _exclude_rental_id)
      AND tstzrange(rental.retirada_prevista_em, rental.devolucao_prevista_em, '[)')
          && tstzrange(_start_at, _end_at, '[)')
  ), maintenance AS (
    SELECT public.equipment_active_maintenance_quantity(_company_id, _material_id) AS quantity
  )
  SELECT physical.quantity, reservations.quantity,
    greatest(physical.quantity - reservations.quantity - maintenance.quantity, 0)::bigint
  FROM physical CROSS JOIN reservations CROSS JOIN maintenance
$$;

-- Keep materials with zero availability out of the rental picker. The write
-- facade still performs its own locked validation.
CREATE OR REPLACE FUNCTION public.buscar_materiais_disponiveis_locacao(
  _busca text,
  _retirada_prevista_em timestamptz,
  _devolucao_prevista_em timestamptz,
  _locacao_excluir_id uuid DEFAULT NULL,
  _limite integer DEFAULT 40,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (item jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  IF _retirada_prevista_em IS NULL OR _devolucao_prevista_em IS NULL OR _devolucao_prevista_em <= _retirada_prevista_em THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Informe um período válido para consultar a disponibilidade.';
  END IF;
  RETURN QUERY SELECT jsonb_build_object(
    'id', material.id, 'codigo_interno', material.codigo_interno,
    'identificador_unico', material.identificador_unico, 'codigo_barras', material.codigo_barras,
    'conteudo_qr_code', material.conteudo_qr_code, 'nome', material.nome,
    'descricao', material.descricao, 'marca', material.marca, 'modelo', material.modelo,
    'numero_serie', material.numero_serie, 'numero_patrimonio', material.numero_patrimonio,
    'tipo_controle', material.tipo_controle, 'unidade_medida', material.unidade_medida,
    'status_operacional', material.status_operacional, 'valor_locacao_padrao', material.valor_locacao_padrao,
    'foto_path', photo.storage_path, 'estoque_fisico', availability.estoque_fisico,
    'reservado', availability.reservado, 'disponivel', availability.disponivel
  )
  FROM public.materiais AS material
  CROSS JOIN LATERAL public.material_rental_availability(v_company_id, material.id,
    _retirada_prevista_em, _devolucao_prevista_em, _locacao_excluir_id) AS availability
  LEFT JOIN LATERAL (
    SELECT picture.storage_path FROM public.materiais_fotos AS picture
    WHERE picture.empresa_id = material.empresa_id AND picture.material_id = material.id
    ORDER BY picture.foto_principal DESC, picture.created_at, picture.id LIMIT 1
  ) AS photo ON true
  WHERE material.empresa_id = v_company_id AND material.ativo
    AND material.status_operacional = 'disponivel' AND availability.disponivel > 0
    AND (nullif(btrim(_busca), '') IS NULL OR material.nome ILIKE '%' || btrim(_busca) || '%'
      OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(material.codigo_barras, '') = btrim(_busca)
      OR material.identificador_unico::text = btrim(_busca)
      OR COALESCE(material.numero_serie, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(material.numero_patrimonio, '') ILIKE '%' || btrim(_busca) || '%')
  ORDER BY material.nome, material.codigo_interno, material.id
  LIMIT greatest(1, least(COALESCE(_limite, 40), 100));
END;
$$;

ALTER TABLE public.manutencao_ordens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_ordem_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_ordem_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manutencao_equipamento_numeradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY manutencao_ordens_select ON public.manutencao_ordens
FOR SELECT TO authenticated USING (
  public.can_read_company_module(empresa_id, 'manutencao_equipamentos')
);
CREATE POLICY manutencao_insumos_select ON public.manutencao_ordem_insumos
FOR SELECT TO authenticated USING (
  public.can_read_company_module(empresa_id, 'manutencao_equipamentos')
);
CREATE POLICY manutencao_eventos_select ON public.manutencao_ordem_eventos
FOR SELECT TO authenticated USING (
  public.can_read_company_module(empresa_id, 'manutencao_equipamentos')
);

CREATE TRIGGER manutencao_ordens_projection_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.manutencao_ordens
FOR EACH ROW EXECUTE FUNCTION public.protect_equipment_maintenance_projection();
CREATE TRIGGER manutencao_insumos_projection_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.manutencao_ordem_insumos
FOR EACH ROW EXECUTE FUNCTION public.protect_equipment_maintenance_projection();
CREATE TRIGGER manutencao_eventos_history_guard
BEFORE UPDATE OR DELETE ON public.manutencao_ordem_eventos
FOR EACH ROW EXECUTE FUNCTION public.protect_equipment_maintenance_history();
CREATE TRIGGER material_custody_maintenance_guard
BEFORE INSERT ON public.material_custodias
FOR EACH ROW EXECUTE FUNCTION public.block_custody_when_maintenance_active();

REVOKE ALL ON public.manutencao_ordens, public.manutencao_ordem_insumos,
  public.manutencao_ordem_eventos, public.manutencao_equipamento_numeradores
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.manutencao_ordens, public.manutencao_ordem_insumos,
  public.manutencao_ordem_eventos TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_equipment_maintenance_company(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_equipment_maintenance_number(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_equipment_maintenance_responsible(uuid, public.material_custody_responsible_type, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_maintenance_transition_allowed(public.equipment_maintenance_status, public.equipment_maintenance_status) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_equipment_maintenance_projection() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_equipment_maintenance_history() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_active_maintenance_quantity(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.material_is_operationally_available(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_custody_when_maintenance_active() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.material_rental_availability(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamptz,text,text,text,text,integer,uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.atualizar_ordem_manutencao(uuid,uuid,timestamptz,text,text,text,text,uuid,timestamptz,text,text,text,text,integer,numeric,numeric,numeric,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.transicionar_ordem_manutencao(uuid,text,uuid,timestamptz,text,timestamptz,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_insumo_ordem_manutencao(uuid,text,numeric,text,numeric,uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.remover_insumo_ordem_manutencao(uuid,uuid,text,uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_ordens_manutencao(integer,integer,text,text,text,text,text,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_indicadores_manutencao(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_ordem_manutencao(uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.buscar_materiais_manutencao(text,integer,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_sugestao_manutencao_checkin(uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_resumo_manutencao_material(uuid,uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.criar_ordem_manutencao(uuid,text,text,text,text,uuid,integer,text,uuid,timestamptz,text,text,text,text,integer,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_ordem_manutencao(uuid,uuid,timestamptz,text,text,text,text,uuid,timestamptz,text,text,text,text,integer,numeric,numeric,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_ordem_manutencao(uuid,text,uuid,timestamptz,text,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_insumo_ordem_manutencao(uuid,text,numeric,text,numeric,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_insumo_ordem_manutencao(uuid,uuid,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_ordens_manutencao(integer,integer,text,text,text,text,text,uuid,timestamptz,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_indicadores_manutencao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_ordem_manutencao(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_materiais_manutencao(text,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_sugestao_manutencao_checkin(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_resumo_manutencao_material(uuid,uuid) TO authenticated;

COMMENT ON TABLE public.manutencao_ordens IS
  'Canonical maintenance orders. Active rows derive operational unavailability and never change physical stock.';
COMMENT ON COLUMN public.manutencao_ordens.quantidade_afetada IS
  'Count for quantity-controlled SKUs; no synthetic unit or serial identity is created.';
COMMENT ON TABLE public.manutencao_ordem_insumos IS
  'Parts/inputs documentation. It deliberately creates no stock movement in Stage 5.';
COMMENT ON FUNCTION public.material_rental_availability(uuid, uuid, timestamptz, timestamptz, uuid) IS
  'Canonical rental availability: active-location physical stock minus overlapping reservations and active maintenance quantity.';
