-- Backstage Pro - Stage 4: commercial material rentals.
-- Physical balance remains in estoque_saldos and physical custody remains in
-- material_custodias. Rentals add customer, period, reservation and pricing.

UPDATE public.module_catalog
SET nome = 'Locação de Materiais',
    descricao = 'Reservas por período, valores comerciais e operação integrada à custódia física.',
    ativo = true,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'planned')
      || '{"area":"materiais","stage":4,"operational":true}'::jsonb,
    texto_venda = 'Planeje, reserve, entregue e receba materiais sem separar a locação do estoque oficial.',
    updated_at = clock_timestamp()
WHERE feature_key = 'locacao_materiais';

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT rental.id, dependency.id
FROM public.module_catalog AS rental
JOIN public.module_catalog AS dependency
  ON dependency.feature_key IN (
    'gestao_materiais', 'controle_estoque', 'checkin_checkout'
  )
WHERE rental.feature_key = 'locacao_materiais'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

CREATE TYPE public.customer_person_type AS ENUM (
  'pessoa_fisica',
  'pessoa_juridica'
);

CREATE TYPE public.material_rental_status AS ENUM (
  'rascunho',
  'reservada',
  'pronta_retirada',
  'em_andamento',
  'parcialmente_devolvida',
  'concluida',
  'cancelada'
);

CREATE TYPE public.material_rental_billing_mode AS ENUM (
  'fixo',
  'diaria',
  'periodo',
  'unidade'
);

CREATE TYPE public.material_rental_event_type AS ENUM (
  'criacao',
  'edicao',
  'reserva',
  'pronta_retirada',
  'retirada',
  'devolucao',
  'cancelamento',
  'conclusao'
);

-- No canonical customer entity existed before Stage 4. This generic table is
-- deliberately not rental-specific so events, documents and finance can reuse
-- the same customer in future stages.
CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  tipo_pessoa public.customer_person_type NOT NULL,
  nome text NOT NULL,
  nome_fantasia text,
  cpf_cnpj text,
  email text,
  telefone text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT clientes_nome_not_blank CHECK (btrim(nome) <> ''),
  CONSTRAINT clientes_document_shape CHECK (
    cpf_cnpj IS NULL OR cpf_cnpj ~ '^[0-9]{11}$|^[0-9]{14}$'
  ),
  CONSTRAINT clientes_email_not_blank CHECK (
    email IS NULL OR nullif(btrim(email), '') IS NOT NULL
  ),
  CONSTRAINT clientes_phone_not_blank CHECK (
    telefone IS NULL OR nullif(btrim(telefone), '') IS NOT NULL
  )
);

CREATE UNIQUE INDEX clientes_empresa_documento_uidx
  ON public.clientes (empresa_id, cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL;
CREATE INDEX clientes_empresa_nome_idx
  ON public.clientes (empresa_id, lower(nome), id);
CREATE INDEX clientes_empresa_ativo_idx
  ON public.clientes (empresa_id, ativo, lower(nome));

CREATE TABLE public.material_locacao_numeradores (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  ano integer NOT NULL,
  ultimo_numero integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, ano),
  CONSTRAINT material_locacao_numeradores_year CHECK (ano BETWEEN 2000 AND 9999),
  CONSTRAINT material_locacao_numeradores_value CHECK (ultimo_numero >= 0)
);

CREATE TABLE public.material_locacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL,
  evento_id uuid,
  numero text NOT NULL,
  status public.material_rental_status NOT NULL DEFAULT 'rascunho',
  retirada_prevista_em timestamptz NOT NULL,
  devolucao_prevista_em timestamptz NOT NULL,
  iniciada_em timestamptz,
  encerrada_em timestamptz,
  observacoes text,
  responsavel_tipo public.material_custody_responsible_type NOT NULL,
  responsavel_usuario_id uuid,
  responsavel_funcionario_id uuid,
  responsavel_nome text NOT NULL,
  valor_bruto numeric(14,2) NOT NULL DEFAULT 0,
  desconto numeric(14,2) NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  financeiro_lancamento_id uuid,
  orcamento_referencia_id uuid,
  contrato_referencia_id uuid,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_locacoes_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT material_locacoes_empresa_numero_unique UNIQUE (empresa_id, numero),
  CONSTRAINT material_locacoes_empresa_client_unique UNIQUE (empresa_id, client_uuid),
  CONSTRAINT material_locacoes_empresa_cliente_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacoes_periodo_valid
    CHECK (devolucao_prevista_em > retirada_prevista_em),
  CONSTRAINT material_locacoes_numero_not_blank CHECK (btrim(numero) <> ''),
  CONSTRAINT material_locacoes_responsavel_not_blank
    CHECK (btrim(responsavel_nome) <> ''),
  CONSTRAINT material_locacoes_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT material_locacoes_values_nonnegative CHECK (
    valor_bruto >= 0 AND desconto >= 0 AND valor_total >= 0
    AND desconto <= valor_bruto AND valor_total = valor_bruto - desconto
  ),
  CONSTRAINT material_locacoes_responsavel_shape CHECK (
    (
      responsavel_tipo = 'usuario'
      AND responsavel_usuario_id IS NOT NULL
      AND responsavel_funcionario_id IS NULL
    ) OR (
      responsavel_tipo = 'funcionario'
      AND responsavel_funcionario_id IS NOT NULL
      AND responsavel_usuario_id IS NULL
    )
  ),
  CONSTRAINT material_locacoes_status_dates CHECK (
    (status IN ('rascunho', 'reservada', 'pronta_retirada', 'cancelada'))
    OR (status IN ('em_andamento', 'parcialmente_devolvida') AND iniciada_em IS NOT NULL AND encerrada_em IS NULL)
    OR (status = 'concluida' AND iniciada_em IS NOT NULL AND encerrada_em IS NOT NULL)
  )
);

CREATE TABLE public.material_locacao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  locacao_id uuid NOT NULL,
  material_id uuid NOT NULL,
  quantidade_contratada integer NOT NULL,
  modalidade_cobranca public.material_rental_billing_mode NOT NULL DEFAULT 'unidade',
  unidades_cobranca numeric(12,2) NOT NULL DEFAULT 1,
  valor_unitario numeric(14,2) NOT NULL DEFAULT 0,
  desconto numeric(14,2) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) GENERATED ALWAYS AS (
    round((quantidade_contratada::numeric * unidades_cobranca * valor_unitario) - desconto, 2)
  ) STORED,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_locacao_itens_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT material_locacao_itens_empresa_locacao_material_unique
    UNIQUE (empresa_id, locacao_id, material_id),
  CONSTRAINT material_locacao_itens_empresa_locacao_fkey
    FOREIGN KEY (empresa_id, locacao_id)
    REFERENCES public.material_locacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacao_itens_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacao_itens_quantity_positive
    CHECK (quantidade_contratada > 0),
  CONSTRAINT material_locacao_itens_values CHECK (
    unidades_cobranca > 0 AND valor_unitario >= 0 AND desconto >= 0
    AND desconto <= quantidade_contratada::numeric * unidades_cobranca * valor_unitario
  )
);

CREATE TABLE public.material_locacao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  locacao_id uuid NOT NULL,
  item_id uuid,
  custodia_id uuid,
  tipo public.material_rental_event_type NOT NULL,
  descricao text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  executado_por uuid NOT NULL,
  data_efetiva timestamptz NOT NULL DEFAULT now(),
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_locacao_eventos_empresa_locacao_fkey
    FOREIGN KEY (empresa_id, locacao_id)
    REFERENCES public.material_locacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacao_eventos_empresa_item_fkey
    FOREIGN KEY (empresa_id, item_id)
    REFERENCES public.material_locacao_itens (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacao_eventos_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT material_locacao_eventos_empresa_client_unique
    UNIQUE (empresa_id, client_uuid),
  CONSTRAINT material_locacao_eventos_description_not_blank
    CHECK (btrim(descricao) <> ''),
  CONSTRAINT material_locacao_eventos_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> '')
);

CREATE INDEX material_locacoes_company_status_period_idx
  ON public.material_locacoes (
    empresa_id, status, retirada_prevista_em, devolucao_prevista_em, id
  );
CREATE INDEX material_locacoes_company_customer_idx
  ON public.material_locacoes (empresa_id, cliente_id, created_at DESC, id);
CREATE INDEX material_locacoes_company_responsible_idx
  ON public.material_locacoes (
    empresa_id, responsavel_tipo, responsavel_usuario_id,
    responsavel_funcionario_id, created_at DESC
  );
CREATE INDEX material_locacoes_company_due_idx
  ON public.material_locacoes (empresa_id, devolucao_prevista_em, id)
  WHERE status IN ('em_andamento', 'parcialmente_devolvida');
CREATE INDEX material_locacao_itens_material_idx
  ON public.material_locacao_itens (empresa_id, material_id, locacao_id);
CREATE INDEX material_locacao_eventos_rental_date_idx
  ON public.material_locacao_eventos (
    empresa_id, locacao_id, data_efetiva DESC, id DESC
  );
CREATE INDEX material_custodias_rental_reference_idx
  ON public.material_custodias (empresa_id, referencia_id, status)
  WHERE referencia_tipo = 'locacao_item';

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
  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'LR011',
        MESSAGE = 'Selecione a empresa para operar locações.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL
       OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'locacao_materiais'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'locacao_materiais')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

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
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  IF _retirada_prevista_em IS NULL OR _devolucao_prevista_em IS NULL
     OR _devolucao_prevista_em <= _retirada_prevista_em THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004',
      MESSAGE = 'Informe um período válido para consultar a disponibilidade.';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', material.id,
    'codigo_interno', material.codigo_interno,
    'identificador_unico', material.identificador_unico,
    'codigo_barras', material.codigo_barras,
    'conteudo_qr_code', material.conteudo_qr_code,
    'nome', material.nome,
    'descricao', material.descricao,
    'marca', material.marca,
    'modelo', material.modelo,
    'numero_serie', material.numero_serie,
    'numero_patrimonio', material.numero_patrimonio,
    'tipo_controle', material.tipo_controle,
    'unidade_medida', material.unidade_medida,
    'status_operacional', material.status_operacional,
    'valor_locacao_padrao', material.valor_locacao_padrao,
    'foto_path', photo.storage_path,
    'estoque_fisico', availability.estoque_fisico,
    'reservado', availability.reservado,
    'disponivel', availability.disponivel
  )
  FROM public.materiais AS material
  CROSS JOIN LATERAL public.material_rental_availability(
    v_company_id, material.id, _retirada_prevista_em,
    _devolucao_prevista_em, _locacao_excluir_id
  ) AS availability
  LEFT JOIN LATERAL (
    SELECT picture.storage_path
    FROM public.materiais_fotos AS picture
    WHERE picture.empresa_id = material.empresa_id
      AND picture.material_id = material.id
    ORDER BY picture.foto_principal DESC, picture.created_at, picture.id
    LIMIT 1
  ) AS photo ON true
  WHERE material.empresa_id = v_company_id
    AND material.ativo
    AND material.status_operacional = 'disponivel'
    AND (
      nullif(btrim(_busca), '') IS NULL
      OR material.nome ILIKE '%' || btrim(_busca) || '%'
      OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(material.codigo_barras, '') = btrim(_busca)
      OR material.identificador_unico::text = btrim(_busca)
      OR COALESCE(material.numero_serie, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(material.numero_patrimonio, '') ILIKE '%' || btrim(_busca) || '%'
    )
  ORDER BY material.nome, material.codigo_interno, material.id
  LIMIT greatest(1, least(COALESCE(_limite, 40), 100));
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_locacoes_materiais(
  _pagina integer DEFAULT 1,
  _por_pagina integer DEFAULT 20,
  _busca text DEFAULT NULL,
  _status text DEFAULT NULL,
  _cliente_id uuid DEFAULT NULL,
  _inicio timestamptz DEFAULT NULL,
  _fim timestamptz DEFAULT NULL,
  _somente_atrasadas boolean DEFAULT false,
  _responsavel text DEFAULT NULL,
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
  v_page integer := greatest(COALESCE(_pagina, 1), 1);
  v_per_page integer := greatest(1, least(COALESCE(_por_pagina, 20), 100));
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);

  RETURN QUERY
  WITH operational AS (
    SELECT rental.id,
      count(rental_item.id)::bigint AS quantidade_itens,
      COALESCE(sum(totals.retirada), 0)::bigint AS quantidade_retirada,
      COALESCE(sum(totals.devolvida), 0)::bigint AS quantidade_devolvida,
      COALESCE(sum(totals.com_cliente), 0)::bigint AS quantidade_com_cliente
    FROM public.material_locacoes AS rental
    LEFT JOIN public.material_locacao_itens AS rental_item
      ON rental_item.empresa_id = rental.empresa_id
     AND rental_item.locacao_id = rental.id
    LEFT JOIN LATERAL public.material_rental_item_operational_totals(rental_item.id)
      AS totals ON rental_item.id IS NOT NULL
    WHERE rental.empresa_id = v_company_id
    GROUP BY rental.id
  ), filtered AS (
    SELECT rental.*, customer.nome AS cliente_nome,
      customer.nome_fantasia AS cliente_nome_fantasia,
      op.quantidade_itens, op.quantidade_retirada,
      op.quantidade_devolvida, op.quantidade_com_cliente,
      (
        rental.devolucao_prevista_em < clock_timestamp()
        AND op.quantidade_com_cliente > 0
      ) AS atrasada
    FROM public.material_locacoes AS rental
    JOIN public.clientes AS customer
      ON customer.empresa_id = rental.empresa_id
     AND customer.id = rental.cliente_id
    JOIN operational AS op ON op.id = rental.id
    WHERE rental.empresa_id = v_company_id
      AND (nullif(btrim(_status), '') IS NULL OR rental.status::text = btrim(_status))
      AND (_cliente_id IS NULL OR rental.cliente_id = _cliente_id)
      AND (_inicio IS NULL OR rental.devolucao_prevista_em > _inicio)
      AND (_fim IS NULL OR rental.retirada_prevista_em < _fim)
      AND (
        nullif(btrim(_responsavel), '') IS NULL
        OR rental.responsavel_nome ILIKE '%' || btrim(_responsavel) || '%'
      )
      AND (
        nullif(btrim(_busca), '') IS NULL
        OR rental.numero ILIKE '%' || btrim(_busca) || '%'
        OR customer.nome ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(customer.nome_fantasia, '') ILIKE '%' || btrim(_busca) || '%'
        OR EXISTS (
          SELECT 1
          FROM public.material_locacao_itens AS searched_item
          JOIN public.materiais AS material
            ON material.empresa_id = searched_item.empresa_id
           AND material.id = searched_item.material_id
          WHERE searched_item.empresa_id = rental.empresa_id
            AND searched_item.locacao_id = rental.id
            AND (
              material.nome ILIKE '%' || btrim(_busca) || '%'
              OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%'
            )
        )
      )
  )
  SELECT to_jsonb(filtered), count(*) OVER ()
  FROM filtered
  WHERE NOT _somente_atrasadas OR filtered.atrasada
  ORDER BY filtered.created_at DESC, filtered.id DESC
  LIMIT v_per_page OFFSET (v_page - 1) * v_per_page;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_locacao_material(
  _locacao_id uuid,
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
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);

  SELECT to_jsonb(rental) || jsonb_build_object(
    'cliente', to_jsonb(customer),
    'evento', CASE WHEN agenda.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', agenda.id, 'name', agenda.name, 'date', agenda.date,
      'artist', agenda.artist, 'city', agenda.city, 'venue', agenda.venue
    ) END,
    'atrasada', rental.devolucao_prevista_em < clock_timestamp()
      AND EXISTS (
        SELECT 1 FROM public.material_locacao_itens AS pending_item
        CROSS JOIN LATERAL public.material_rental_item_operational_totals(pending_item.id) AS pending
        WHERE pending_item.empresa_id = rental.empresa_id
          AND pending_item.locacao_id = rental.id AND pending.com_cliente > 0
      ),
    'itens', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(rental_item) || jsonb_build_object(
          'material', jsonb_build_object(
            'id', material.id, 'nome', material.nome,
            'codigo_interno', material.codigo_interno,
            'tipo_controle', material.tipo_controle,
            'unidade_medida', material.unidade_medida,
            'numero_serie', material.numero_serie,
            'numero_patrimonio', material.numero_patrimonio,
            'codigo_barras', material.codigo_barras,
            'identificador_unico', material.identificador_unico
          ),
          'quantidade_retirada', operational.retirada,
          'quantidade_devolvida', operational.devolvida,
          'quantidade_com_cliente', operational.com_cliente,
          'quantidade_pendente_retirada', greatest(
            rental_item.quantidade_contratada - operational.retirada::integer, 0
          )
        ) ORDER BY material.nome, rental_item.id
      )
      FROM public.material_locacao_itens AS rental_item
      JOIN public.materiais AS material
        ON material.empresa_id = rental_item.empresa_id
       AND material.id = rental_item.material_id
      CROSS JOIN LATERAL public.material_rental_item_operational_totals(rental_item.id) AS operational
      WHERE rental_item.empresa_id = rental.empresa_id
        AND rental_item.locacao_id = rental.id
    ), '[]'::jsonb),
    'custodias', COALESCE((
      SELECT jsonb_agg(to_jsonb(custody) ORDER BY custody.retirada_em, custody.id)
      FROM public.material_custodias AS custody
      JOIN public.material_locacao_itens AS custody_item
        ON custody_item.empresa_id = custody.empresa_id
       AND custody_item.id = custody.referencia_id
      WHERE custody.empresa_id = rental.empresa_id
        AND custody_item.locacao_id = rental.id
        AND custody.referencia_tipo = 'locacao_item'
    ), '[]'::jsonb),
    'historico', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(history) || jsonb_build_object(
          'executor_nome', COALESCE(actor.full_name, 'Usuário')
        ) ORDER BY history.data_efetiva, history.created_at, history.id
      )
      FROM public.material_locacao_eventos AS history
      LEFT JOIN public.profiles AS actor ON actor.user_id = history.executado_por
      WHERE history.empresa_id = rental.empresa_id
        AND history.locacao_id = rental.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.material_locacoes AS rental
  JOIN public.clientes AS customer
    ON customer.empresa_id = rental.empresa_id AND customer.id = rental.cliente_id
  LEFT JOIN public.events AS agenda
    ON agenda.empresa_id = rental.empresa_id AND agenda.id = rental.evento_id
  WHERE rental.empresa_id = v_company_id AND rental.id = _locacao_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_indicadores_locacoes(
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
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  RETURN (
    WITH operational AS (
      SELECT rental.id, COALESCE(sum(totals.com_cliente), 0)::bigint AS com_cliente
      FROM public.material_locacoes AS rental
      LEFT JOIN public.material_locacao_itens AS item
        ON item.empresa_id = rental.empresa_id AND item.locacao_id = rental.id
      LEFT JOIN LATERAL public.material_rental_item_operational_totals(item.id)
        AS totals ON item.id IS NOT NULL
      WHERE rental.empresa_id = v_company_id
      GROUP BY rental.id
    )
    SELECT jsonb_build_object(
      'em_andamento', count(*) FILTER (
        WHERE rental.status IN ('em_andamento', 'parcialmente_devolvida')
      ),
      'retiradas_hoje', count(*) FILTER (
        WHERE (rental.retirada_prevista_em AT TIME ZONE 'America/Sao_Paulo')::date = v_today
          AND rental.status IN ('reservada', 'pronta_retirada')
      ),
      'devolucoes_hoje', count(*) FILTER (
        WHERE (rental.devolucao_prevista_em AT TIME ZONE 'America/Sao_Paulo')::date = v_today
          AND operational.com_cliente > 0
      ),
      'atrasadas', count(*) FILTER (
        WHERE rental.devolucao_prevista_em < clock_timestamp()
          AND operational.com_cliente > 0
      )
    )
    FROM public.material_locacoes AS rental
    JOIN operational ON operational.id = rental.id
    WHERE rental.empresa_id = v_company_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_eventos_para_locacao(
  _busca text DEFAULT NULL,
  _limite integer DEFAULT 50,
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
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', event.id, 'name', event.name, 'date', event.date,
    'artist', event.artist, 'city', event.city, 'venue', event.venue,
    'status', event.status
  )
  FROM public.events AS event
  WHERE event.empresa_id = v_company_id
    AND (
      nullif(btrim(_busca), '') IS NULL
      OR event.name ILIKE '%' || btrim(_busca) || '%'
      OR event.artist ILIKE '%' || btrim(_busca) || '%'
      OR event.city ILIKE '%' || btrim(_busca) || '%'
    )
  ORDER BY event.date DESC, event.name, event.id
  LIMIT greatest(1, least(COALESCE(_limite, 50), 100));
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_rental_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'material_locacao_eventos' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019',
      MESSAGE = 'O histórico da locação é imutável.';
  END IF;
  IF COALESCE(current_setting('backstage.material_rental_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019',
      MESSAGE = 'Use as operações explícitas do módulo de locações.';
  END IF;
  IF TG_TABLE_NAME = 'material_locacoes' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019', MESSAGE = 'Locações não podem ser excluídas.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_material_rental_number(
  _company_id uuid,
  _at timestamptz
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
  INSERT INTO public.material_locacao_numeradores (empresa_id, ano, ultimo_numero)
  VALUES (_company_id, v_year, 1)
  ON CONFLICT (empresa_id, ano) DO UPDATE
    SET ultimo_numero = material_locacao_numeradores.ultimo_numero + 1,
        updated_at = clock_timestamp()
  RETURNING ultimo_numero INTO v_value;
  RETURN 'LOC-' || v_year::text || '-' || lpad(v_value::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.material_rental_item_operational_totals(
  _item_id uuid
)
RETURNS TABLE (retirada bigint, devolvida bigint, com_cliente bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE(sum(c.quantidade_retirada) FILTER (WHERE c.status <> 'cancelada'), 0)::bigint,
    COALESCE(sum(c.quantidade_devolvida) FILTER (WHERE c.status <> 'cancelada'), 0)::bigint,
    COALESCE(sum(c.quantidade_retirada - c.quantidade_devolvida)
      FILTER (WHERE c.status IN ('aberta', 'parcial')), 0)::bigint
  FROM public.material_custodias AS c
  WHERE c.referencia_tipo = 'locacao_item'
    AND c.referencia_id = _item_id
$$;

-- Reservation intervals are half-open [withdrawal, return). A return and a new
-- withdrawal at exactly the same timestamp do not overlap.
CREATE OR REPLACE FUNCTION public.material_rental_availability(
  _company_id uuid,
  _material_id uuid,
  _start_at timestamptz,
  _end_at timestamptz,
  _exclude_rental_id uuid DEFAULT NULL
)
RETURNS TABLE (
  estoque_fisico bigint,
  reservado bigint,
  disponivel bigint
)
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
     AND location.id = balance.localizacao_id
     AND location.ativa = true
    WHERE balance.empresa_id = _company_id
      AND balance.material_id = _material_id
  ), reservations AS (
    SELECT COALESCE(sum(greatest(
      item.quantidade_contratada - operational.retirada::integer, 0
    )), 0)::bigint AS quantity
    FROM public.material_locacao_itens AS item
    JOIN public.material_locacoes AS rental
      ON rental.empresa_id = item.empresa_id AND rental.id = item.locacao_id
    CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
    WHERE item.empresa_id = _company_id
      AND item.material_id = _material_id
      AND rental.status IN (
        'reservada', 'pronta_retirada', 'em_andamento', 'parcialmente_devolvida'
      )
      AND (_exclude_rental_id IS NULL OR rental.id <> _exclude_rental_id)
      AND tstzrange(rental.retirada_prevista_em, rental.devolucao_prevista_em, '[)')
          && tstzrange(_start_at, _end_at, '[)')
  )
  SELECT physical.quantity, reservations.quantity,
    greatest(physical.quantity - reservations.quantity, 0)::bigint
  FROM physical CROSS JOIN reservations
$$;

CREATE OR REPLACE FUNCTION public.recalculate_material_rental_totals(
  _company_id uuid,
  _rental_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_gross numeric(14,2);
  v_discount numeric(14,2);
BEGIN
  SELECT COALESCE(sum(
      item.quantidade_contratada::numeric * item.unidades_cobranca * item.valor_unitario
    ), 0), COALESCE(sum(item.desconto), 0)
  INTO v_gross, v_discount
  FROM public.material_locacao_itens AS item
  WHERE item.empresa_id = _company_id AND item.locacao_id = _rental_id;

  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET valor_bruto = round(v_gross, 2),
      desconto = round(v_discount, 2),
      valor_total = round(v_gross - v_discount, 2),
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE empresa_id = _company_id AND id = _rental_id;
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

CREATE OR REPLACE FUNCTION public.listar_clientes(
  _busca text DEFAULT NULL,
  _somente_ativos boolean DEFAULT true,
  _limite integer DEFAULT 100,
  _empresa_id uuid DEFAULT NULL
)
RETURNS SETOF public.clientes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  RETURN QUERY
  SELECT customer.*
  FROM public.clientes AS customer
  WHERE customer.empresa_id = v_company_id
    AND (NOT _somente_ativos OR customer.ativo)
    AND (
      nullif(btrim(_busca), '') IS NULL
      OR customer.nome ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(customer.nome_fantasia, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(customer.cpf_cnpj, '') ILIKE '%' || regexp_replace(btrim(_busca), '[^0-9]', '', 'g') || '%'
    )
  ORDER BY customer.nome, customer.id
  LIMIT greatest(1, least(COALESCE(_limite, 100), 200));
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

CREATE OR REPLACE FUNCTION public.confirmar_reserva_locacao_material(
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
  v_item public.material_locacao_itens%ROWTYPE;
  v_availability record;
  v_hash text;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  v_hash := encode(sha256(convert_to(jsonb_build_object('locacao', _locacao_id, 'acao', 'reservar')::text, 'UTF8')), 'hex');
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

  -- Stable lock order prevents deadlocks and makes the final availability
  -- validation serializable per material without persisting a second balance.
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
  RETURN v_rental;
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

CREATE OR REPLACE FUNCTION public.registrar_retirada_locacao_material(
  _locacao_id uuid,
  _item_id uuid,
  _quantidade integer,
  _localizacao_origem_id uuid,
  _responsavel_tipo text,
  _responsavel_id uuid,
  _condicao_saida text,
  _client_uuid uuid,
  _data_efetiva timestamptz DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_custodias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_totals record;
  v_custody public.material_custodias%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF _client_uuid IS NULL OR COALESCE(_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Quantidade e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'item', _item_id, 'quantidade', _quantidade,
    'origem', _localizacao_origem_id, 'responsavel_tipo', _responsavel_tipo,
    'responsavel', _responsavel_id, 'condicao', _condicao_saida,
    'data', _data_efetiva, 'observacao', nullif(btrim(_observacao), '')
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.item_id <> _item_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_custody FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = v_existing_event.custodia_id;
    RETURN v_custody;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status NOT IN ('reservada', 'pronta_retirada', 'em_andamento', 'parcialmente_devolvida') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não permite retirada neste estado.';
  END IF;
  SELECT * INTO v_item FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND locacao_id = _locacao_id AND id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Item não encontrado na locação.'; END IF;
  SELECT * INTO v_totals FROM public.material_rental_item_operational_totals(_item_id);
  IF _quantidade > v_item.quantidade_contratada - v_totals.retirada THEN
    RAISE EXCEPTION USING ERRCODE = 'LR015', MESSAGE = 'A retirada supera a quantidade contratada ainda não entregue.';
  END IF;

  v_custody := public.registrar_checkout_material(
    v_item.material_id, _quantidade, _localizacao_origem_id,
    _responsavel_tipo, _responsavel_id, 'locacao', _condicao_saida,
    _client_uuid, v_rental.devolucao_prevista_em, _observacao,
    'locacao_item', v_item.id, _data_efetiva, v_company_id
  );
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, item_id, custodia_id, tipo, descricao,
    executado_por, data_efetiva, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, _item_id, v_custody.id, 'retirada',
    'Retirada física vinculada à custódia', auth.uid(), v_custody.retirada_em,
    _client_uuid, v_hash,
    jsonb_build_object('quantidade', _quantidade, 'material_id', v_item.material_id, 'custodia_id', v_custody.id)
  );
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'em_andamento', iniciada_em = COALESCE(iniciada_em, v_custody.retirada_em),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_retirada', 'Retirada de locação registrada via custódia',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'item_id', _item_id, 'custodia_id', v_custody.id, 'quantidade', _quantidade));
  RETURN v_custody;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_devolucao_locacao_material(
  _locacao_id uuid,
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
  v_rental public.material_locacoes%ROWTYPE;
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
  v_pending bigint;
  v_returned bigint;
  v_all_delivered boolean;
  v_new_status public.material_rental_status;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF _client_uuid IS NULL OR COALESCE(_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Quantidade e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'custodia', _custodia_id, 'quantidade', _quantidade,
    'destino', _localizacao_destino_id, 'condicao', _condicao_retorno,
    'observacao', nullif(btrim(_observacao), ''),
    'ocorrencia', nullif(btrim(_ocorrencia), ''), 'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.custodia_id <> _custodia_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = _custodia_id;
    RETURN v_result;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND OR v_rental.status NOT IN ('em_andamento', 'parcialmente_devolvida') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não permite devolução neste estado.';
  END IF;
  SELECT * INTO v_custody FROM public.material_custodias
  WHERE empresa_id = v_company_id AND id = _custodia_id
    AND referencia_tipo = 'locacao_item' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Custódia da locação não encontrada.'; END IF;
  SELECT * INTO v_item FROM public.material_locacao_itens
  WHERE empresa_id = v_company_id AND id = v_custody.referencia_id AND locacao_id = _locacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Custódia não pertence à locação informada.'; END IF;

  v_result := public.registrar_checkin_material(
    _custodia_id, _quantidade, _localizacao_destino_id, _condicao_retorno,
    _client_uuid, _observacao, _ocorrencia, _data_efetiva, v_company_id
  );
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, item_id, custodia_id, tipo, descricao,
    executado_por, data_efetiva, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, v_item.id, _custodia_id, 'devolucao',
    CASE WHEN v_result.status = 'concluida' THEN 'Devolução total da custódia' ELSE 'Devolução parcial da custódia' END,
    auth.uid(), COALESCE(_data_efetiva, clock_timestamp()), _client_uuid, v_hash,
    jsonb_build_object('quantidade', _quantidade, 'condicao', _condicao_retorno, 'ocorrencia', nullif(btrim(_ocorrencia), ''))
  );

  SELECT COALESCE(sum(operational.com_cliente), 0),
         COALESCE(sum(operational.devolvida), 0),
         COALESCE(bool_and(operational.retirada >= item.quantidade_contratada), false)
  INTO v_pending, v_returned, v_all_delivered
  FROM public.material_locacao_itens AS item
  CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
  WHERE item.empresa_id = v_company_id AND item.locacao_id = _locacao_id;

  IF v_pending = 0 AND v_all_delivered THEN
    v_new_status := 'concluida';
  ELSIF v_pending > 0 AND v_returned > 0 THEN
    v_new_status := 'parcialmente_devolvida';
  ELSE
    v_new_status := 'em_andamento';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = v_new_status,
      encerrada_em = CASE WHEN v_new_status = 'concluida' THEN COALESCE(_data_efetiva, clock_timestamp()) ELSE NULL END,
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id;
  IF v_new_status = 'concluida' THEN
    INSERT INTO public.material_locacao_eventos (
      empresa_id, locacao_id, tipo, descricao, executado_por,
      client_uuid, payload_hash, dados
    ) VALUES (
      v_company_id, _locacao_id, 'conclusao', 'Locação concluída após devolução integral',
      auth.uid(), gen_random_uuid(), v_hash, jsonb_build_object('devolvida_total', v_returned)
    );
  END IF;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_devolucao', 'Devolução de locação registrada via custódia',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'custodia_id', _custodia_id, 'quantidade', _quantidade, 'status', v_new_status));
  RETURN v_result;
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

CREATE OR REPLACE FUNCTION public.cancelar_locacao_material(
  _locacao_id uuid,
  _justificativa text,
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
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
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
  RETURN v_rental;
END;
$$;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_locacao_numeradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_locacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_locacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_locacao_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users read customers"
ON public.clientes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'locacao_materiais')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'checkin_checkout')
);
CREATE POLICY "Company users read material rentals"
ON public.material_locacoes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'locacao_materiais')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'checkin_checkout')
);
CREATE POLICY "Company users read material rental items"
ON public.material_locacao_itens FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'locacao_materiais')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'checkin_checkout')
);
CREATE POLICY "Company users read material rental events"
ON public.material_locacao_eventos FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'locacao_materiais')
  AND public.can_read_company_module(empresa_id, 'gestao_materiais')
  AND public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.can_read_company_module(empresa_id, 'checkin_checkout')
);

REVOKE ALL ON TABLE public.clientes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.material_locacao_numeradores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.material_locacoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.material_locacao_itens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.material_locacao_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.clientes TO authenticated;
GRANT SELECT ON TABLE public.material_locacoes TO authenticated;
GRANT SELECT ON TABLE public.material_locacao_itens TO authenticated;
GRANT SELECT ON TABLE public.material_locacao_eventos TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_material_rental_company(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_material_rental_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_material_rental_number(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.material_rental_item_operational_totals(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.material_rental_availability(uuid, uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalculate_material_rental_totals(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.salvar_cliente(text, text, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_clientes(text, boolean, integer, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.criar_locacao_material(uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.atualizar_rascunho_locacao_material(uuid, uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_item_locacao_material(uuid, uuid, integer, text, numeric, numeric, numeric, uuid, text, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.remover_item_locacao_material(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.confirmar_reserva_locacao_material(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.marcar_locacao_pronta_retirada(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_retirada_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_devolucao_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cancelar_locacao_material(uuid, text, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.concluir_locacao_material(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.buscar_materiais_disponiveis_locacao(text, timestamptz, timestamptz, uuid, integer, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_locacoes_materiais(integer, integer, text, text, uuid, timestamptz, timestamptz, boolean, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_locacao_material(uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_indicadores_locacoes(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_eventos_para_locacao(text, integer, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.salvar_cliente(text, text, text, text, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_clientes(text, boolean, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_locacao_material(uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_rascunho_locacao_material(uuid, uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_item_locacao_material(uuid, uuid, integer, text, numeric, numeric, numeric, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_item_locacao_material(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_reserva_locacao_material(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_locacao_pronta_retirada(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_retirada_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_locacao_material(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_locacao_material(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_materiais_disponiveis_locacao(text, timestamptz, timestamptz, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_locacoes_materiais(integer, integer, text, text, uuid, timestamptz, timestamptz, boolean, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_locacao_material(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_indicadores_locacoes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_eventos_para_locacao(text, integer, uuid) TO authenticated;

CREATE TRIGGER protect_material_locacoes
BEFORE UPDATE OR DELETE ON public.material_locacoes
FOR EACH ROW EXECUTE FUNCTION public.protect_material_rental_history();
CREATE TRIGGER protect_material_locacao_itens
BEFORE UPDATE OR DELETE ON public.material_locacao_itens
FOR EACH ROW EXECUTE FUNCTION public.protect_material_rental_history();
CREATE TRIGGER protect_material_locacao_eventos
BEFORE UPDATE OR DELETE ON public.material_locacao_eventos
FOR EACH ROW EXECUTE FUNCTION public.protect_material_rental_history();

COMMENT ON TABLE public.clientes IS
  'Cadastro canônico e multiempresa de clientes PF/PJ, reutilizável por locações e integrações futuras.';
COMMENT ON TABLE public.material_locacoes IS
  'Contexto comercial da locação; não representa saldo físico nem custódia.';
COMMENT ON TABLE public.material_locacao_itens IS
  'Itens contratados e reservados por período, sem saldo paralelo persistido.';
COMMENT ON TABLE public.material_locacao_eventos IS
  'Histórico comercial append-only; eventos físicos permanecem no histórico de custódia.';
COMMENT ON FUNCTION public.material_rental_availability(uuid, uuid, timestamptz, timestamptz, uuid) IS
  'Disponibilidade comercial derivada do saldo físico menos reservas sobrepostas no intervalo semiaberto [retirada, devolução).';
COMMENT ON FUNCTION public.registrar_retirada_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, uuid) IS
  'Fachada atômica de retirada: valida contrato e delega débito/custódia ao RPC canônico da Etapa 3.';
COMMENT ON FUNCTION public.registrar_devolucao_locacao_material(uuid, uuid, integer, uuid, text, uuid, text, text, timestamptz, uuid) IS
  'Fachada atômica de devolução: delega retorno ao RPC canônico da Etapa 3 e deriva o estado da locação.';
