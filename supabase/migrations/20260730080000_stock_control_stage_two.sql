-- Backstage Pro - Stage 2: stock control and immutable movements.
-- This migration deliberately does not convert materiais.quantidade into stock.
-- The legacy value is retained for explicit/manual reconciliation.

UPDATE public.module_catalog
SET nome = 'Controle de Estoque',
    descricao = 'Entradas, saídas, transferências, ajustes, saldos por localização e histórico auditável.',
    ativo = true,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'planned')
      || '{"area":"materiais","stage":2,"operational":true}'::jsonb,
    texto_venda = 'Controle saldos e movimentações de materiais por localização.',
    updated_at = clock_timestamp()
WHERE feature_key = 'controle_estoque';

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT stock.id, materials.id
FROM public.module_catalog stock
JOIN public.module_catalog materials
  ON materials.feature_key = 'gestao_materiais'
WHERE stock.feature_key = 'controle_estoque'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

-- Incremental lint correction for the Stage 1 barcode RPC. A PL/pgSQL integer
-- FOR loop declares its target variable automatically, so an explicit
-- v_attempt declaration would be shadowed and unused.
CREATE OR REPLACE FUNCTION public.generate_material_barcode(
  _material_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_existing_barcode text;
  v_candidate text;
BEGIN
  SELECT material.empresa_id
  INTO v_empresa_id
  FROM public.materiais AS material
  WHERE material.id = _material_id;

  IF NOT FOUND
     OR NOT public.can_write_company_module(
       v_empresa_id,
       'gestao_materiais'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  SELECT material.codigo_barras
  INTO v_existing_barcode
  FROM public.materiais AS material
  WHERE material.id = _material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  IF v_existing_barcode IS NOT NULL THEN
    RETURN v_existing_barcode;
  END IF;

  FOR v_attempt IN 1..5 LOOP
    v_candidate :=
      'BSP-' || upper(
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
      );

    BEGIN
      UPDATE public.materiais
      SET codigo_barras = v_candidate,
          tipo_identificacao = CASE
            WHEN conteudo_qr_code IS NULL THEN 'codigo_barras'
            ELSE 'ambos'
          END::public.material_identification_type,
          status_identificacao = 'ativa'
      WHERE id = _material_id;

      RETURN v_candidate;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RAISE EXCEPTION
    'Não foi possível gerar um código de barras único';
END;
$$;

CREATE TYPE public.estoque_localizacao_tipo AS ENUM (
  'deposito',
  'almoxarifado',
  'sala',
  'veiculo',
  'estrutura',
  'area_tecnica',
  'outra'
);

CREATE TYPE public.estoque_movimentacao_tipo AS ENUM (
  'entrada',
  'saida',
  'transferencia',
  'ajuste_positivo',
  'ajuste_negativo',
  'saldo_inicial',
  'estorno'
);

CREATE TYPE public.estoque_origem_modulo AS ENUM (
  'manual',
  'controle_estoque',
  'checkin_checkout',
  'locacao_materiais',
  'manutencao_equipamentos'
);

ALTER TABLE public.materiais
  ADD COLUMN estoque_minimo integer NOT NULL DEFAULT 0,
  ADD COLUMN quantidade_legada_etapa1 integer;

ALTER TABLE public.materiais
  ADD CONSTRAINT materiais_estoque_minimo_nonnegative
    CHECK (estoque_minimo >= 0);

-- Stage one required individual rows to store quantidade = 1. Remove that
-- legacy input constraint before resetting the column to the protected stock
-- projection, otherwise existing individual materials would make this
-- migration fail.
ALTER TABLE public.materiais
  DROP CONSTRAINT materiais_individual_quantity;

-- Preserve the former editable value, but do not turn it into a balance or a
-- movement. Initial stock must be explicitly registered through the RPC.
UPDATE public.materiais
SET quantidade_legada_etapa1 = quantidade,
    quantidade = 0;

ALTER TABLE public.materiais
  ADD CONSTRAINT materiais_individual_stock_projection
    CHECK (tipo_controle <> 'individual' OR quantidade IN (0, 1));

CREATE UNIQUE INDEX materiais_empresa_id_id_uidx
  ON public.materiais (empresa_id, id);

CREATE TABLE public.estoque_localizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  localizacao_pai_id uuid,
  codigo text NOT NULL,
  nome text NOT NULL,
  tipo public.estoque_localizacao_tipo NOT NULL DEFAULT 'outra',
  descricao text,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT estoque_localizacoes_codigo_not_blank CHECK (btrim(codigo) <> ''),
  CONSTRAINT estoque_localizacoes_nome_not_blank CHECK (btrim(nome) <> ''),
  CONSTRAINT estoque_localizacoes_not_self
    CHECK (localizacao_pai_id IS NULL OR localizacao_pai_id <> id),
  CONSTRAINT estoque_localizacoes_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT estoque_localizacoes_parent_fkey
    FOREIGN KEY (empresa_id, localizacao_pai_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE RESTRICT
);

-- Codes and names are unique per company, case- and whitespace-insensitive.
-- This avoids ambiguous paths in selectors and future integrations.
CREATE UNIQUE INDEX estoque_localizacoes_empresa_codigo_uidx
  ON public.estoque_localizacoes (empresa_id, lower(btrim(codigo)));
CREATE UNIQUE INDEX estoque_localizacoes_empresa_nome_uidx
  ON public.estoque_localizacoes (empresa_id, lower(btrim(nome)));
CREATE INDEX estoque_localizacoes_empresa_parent_idx
  ON public.estoque_localizacoes (empresa_id, localizacao_pai_id, ativa);

CREATE TABLE public.estoque_saldos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  material_id uuid NOT NULL,
  localizacao_id uuid NOT NULL,
  quantidade integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_saldos_nonnegative CHECK (quantidade >= 0),
  CONSTRAINT estoque_saldos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT estoque_saldos_empresa_localizacao_fkey
    FOREIGN KEY (empresa_id, localizacao_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT estoque_saldos_empresa_material_localizacao_unique
    UNIQUE (empresa_id, material_id, localizacao_id)
);

CREATE INDEX estoque_saldos_empresa_material_idx
  ON public.estoque_saldos (empresa_id, material_id);
CREATE INDEX estoque_saldos_empresa_localizacao_idx
  ON public.estoque_saldos (empresa_id, localizacao_id)
  WHERE quantidade > 0;

CREATE TABLE public.estoque_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL,
  tipo_movimentacao public.estoque_movimentacao_tipo NOT NULL,
  quantidade integer NOT NULL,
  localizacao_origem_id uuid,
  localizacao_destino_id uuid,
  saldo_origem_anterior integer,
  saldo_origem_posterior integer,
  saldo_destino_anterior integer,
  saldo_destino_posterior integer,
  saldo_total_anterior integer NOT NULL,
  saldo_total_posterior integer NOT NULL,
  motivo text,
  justificativa text,
  observacao text,
  documento_referencia text,
  data_efetiva timestamptz NOT NULL DEFAULT now(),
  origem_modulo public.estoque_origem_modulo NOT NULL DEFAULT 'manual',
  origem_id uuid,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  movimentacao_estornada_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT estoque_movimentacoes_quantidade_positive CHECK (quantidade > 0),
  CONSTRAINT estoque_movimentacoes_totais_nonnegative
    CHECK (saldo_total_anterior >= 0 AND saldo_total_posterior >= 0),
  CONSTRAINT estoque_movimentacoes_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  CONSTRAINT estoque_movimentacoes_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT estoque_movimentacoes_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT estoque_movimentacoes_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT estoque_movimentacoes_empresa_material_id_unique
    UNIQUE (empresa_id, material_id, id),
  CONSTRAINT estoque_movimentacoes_estornada_fkey
    FOREIGN KEY (empresa_id, material_id, movimentacao_estornada_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT estoque_movimentacoes_empresa_client_unique
    UNIQUE (empresa_id, client_uuid),
  CONSTRAINT estoque_movimentacoes_location_shape CHECK (
    (tipo_movimentacao IN ('entrada', 'saldo_inicial', 'ajuste_positivo')
      AND localizacao_origem_id IS NULL
      AND localizacao_destino_id IS NOT NULL)
    OR
    (tipo_movimentacao IN ('saida', 'ajuste_negativo')
      AND localizacao_origem_id IS NOT NULL
      AND localizacao_destino_id IS NULL)
    OR
    (tipo_movimentacao IN ('transferencia', 'estorno')
      AND (localizacao_origem_id IS NOT NULL OR localizacao_destino_id IS NOT NULL))
  ),
  CONSTRAINT estoque_movimentacoes_different_locations CHECK (
    localizacao_origem_id IS NULL
    OR localizacao_destino_id IS NULL
    OR localizacao_origem_id <> localizacao_destino_id
  ),
  CONSTRAINT estoque_movimentacoes_reversal_reference_shape CHECK (
    (tipo_movimentacao = 'estorno' AND movimentacao_estornada_id IS NOT NULL)
    OR
    (tipo_movimentacao <> 'estorno' AND movimentacao_estornada_id IS NULL)
  )
);

CREATE UNIQUE INDEX estoque_movimentacoes_original_estorno_uidx
  ON public.estoque_movimentacoes (movimentacao_estornada_id)
  WHERE movimentacao_estornada_id IS NOT NULL;
CREATE UNIQUE INDEX estoque_movimentacoes_initial_balance_uidx
  ON public.estoque_movimentacoes (empresa_id, material_id)
  WHERE tipo_movimentacao = 'saldo_inicial';
CREATE INDEX estoque_movimentacoes_company_date_idx
  ON public.estoque_movimentacoes (empresa_id, data_efetiva DESC, id DESC);
CREATE INDEX estoque_movimentacoes_material_date_idx
  ON public.estoque_movimentacoes
  (empresa_id, material_id, data_efetiva DESC, id DESC);
CREATE INDEX estoque_movimentacoes_location_date_idx
  ON public.estoque_movimentacoes
  (empresa_id, localizacao_origem_id, localizacao_destino_id, data_efetiva DESC);
CREATE INDEX estoque_movimentacoes_origin_date_idx
  ON public.estoque_movimentacoes
  (empresa_id, localizacao_origem_id, data_efetiva DESC);
CREATE INDEX estoque_movimentacoes_destination_date_idx
  ON public.estoque_movimentacoes
  (empresa_id, localizacao_destino_id, data_efetiva DESC);
CREATE INDEX estoque_movimentacoes_type_date_idx
  ON public.estoque_movimentacoes
  (empresa_id, tipo_movimentacao, data_efetiva DESC);
CREATE INDEX estoque_movimentacoes_document_idx
  ON public.estoque_movimentacoes (empresa_id, documento_referencia)
  WHERE documento_referencia IS NOT NULL;
CREATE INDEX estoque_movimentacoes_source_idx
  ON public.estoque_movimentacoes (empresa_id, origem_modulo, origem_id);
CREATE INDEX estoque_movimentacoes_actor_date_idx
  ON public.estoque_movimentacoes (empresa_id, created_by, data_efetiva DESC);
CREATE INDEX materiais_empresa_below_minimum_idx
  ON public.materiais (empresa_id, quantidade, estoque_minimo)
  WHERE ativo AND quantidade <= estoque_minimo;
CREATE INDEX materiais_empresa_qr_content_idx
  ON public.materiais (empresa_id, conteudo_qr_code)
  WHERE conteudo_qr_code IS NOT NULL;

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

  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ST011',
        MESSAGE = 'Selecione a empresa para operar o estoque.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL
       OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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

  IF (_write AND NOT public.can_write_company_module(v_company_id, 'controle_estoque'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'controle_estoque')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;

  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_stock_location_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_master_admin(auth.uid()) THEN
    NEW.empresa_id := public.get_user_empresa_id(auth.uid());
  END IF;

  NEW.codigo := btrim(NEW.codigo);
  NEW.nome := btrim(NEW.nome);
  NEW.descricao := nullif(btrim(NEW.descricao), '');
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;

  v_current := NEW.localizacao_pai_id;
  WHILE v_current IS NOT NULL LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION USING ERRCODE = 'ST016',
        MESSAGE = 'A hierarquia de localizações não pode conter ciclos.';
    END IF;
    -- Lock each ancestor while walking the chain. Concurrent updates that
    -- could jointly form a cycle cannot both commit.
    SELECT localizacao_pai_id INTO v_current
    FROM public.estoque_localizacoes
    WHERE empresa_id = NEW.empresa_id AND id = v_current
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'ST005',
        MESSAGE = 'A localização superior é inválida.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_stock_location_write
BEFORE INSERT OR UPDATE ON public.estoque_localizacoes
FOR EACH ROW EXECUTE FUNCTION public.prepare_stock_location_write();

CREATE OR REPLACE FUNCTION public.protect_used_stock_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.estoque_localizacoes WHERE localizacao_pai_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.estoque_saldos WHERE localizacao_id = OLD.id)
     OR EXISTS (
       SELECT 1 FROM public.estoque_movimentacoes
       WHERE localizacao_origem_id = OLD.id OR localizacao_destino_id = OLD.id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST017',
      MESSAGE = 'Localização em uso não pode ser excluída; inative-a.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER protect_used_stock_location
BEFORE DELETE ON public.estoque_localizacoes
FOR EACH ROW EXECUTE FUNCTION public.protect_used_stock_location();

CREATE OR REPLACE FUNCTION public.protect_material_stock_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.quantidade := 0;
    NEW.quantidade_legada_etapa1 := NULL;
  ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade
        AND COALESCE(current_setting('backstage.stock_projection_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'O saldo só pode ser alterado por uma movimentação de estoque.';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.quantidade_legada_etapa1 IS DISTINCT FROM OLD.quantidade_legada_etapa1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'A referência de quantidade legada é protegida.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_material_stock_projection
BEFORE INSERT OR UPDATE ON public.materiais
FOR EACH ROW EXECUTE FUNCTION public.protect_material_stock_projection();

CREATE OR REPLACE FUNCTION public.validate_stock_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_control_type public.material_control_type;
  v_other_total integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.material_id IS DISTINCT FROM OLD.material_id
       OR NEW.localizacao_id IS DISTINCT FROM OLD.localizacao_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'A identidade de um saldo de estoque é imutável.';
  END IF;

  -- This lock makes the individual-item invariant a concurrency-safe second
  -- barrier even for trusted/internal writers outside the canonical RPCs.
  SELECT tipo_controle INTO v_control_type
  FROM public.materiais
  WHERE empresa_id = NEW.empresa_id AND id = NEW.material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ST005', MESSAGE = 'Material não encontrado.';
  END IF;
  IF v_control_type = 'individual' THEN
    SELECT COALESCE(sum(quantidade), 0)::integer INTO v_other_total
    FROM public.estoque_saldos
    WHERE empresa_id = NEW.empresa_id
      AND material_id = NEW.material_id
      AND id <> NEW.id;
    IF NEW.quantidade NOT IN (0, 1) OR v_other_total + NEW.quantidade > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'ST002',
        MESSAGE = 'Um material individual só pode ter saldo total zero ou um.';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_stock_balance
BEFORE INSERT OR UPDATE ON public.estoque_saldos
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_balance();

CREATE OR REPLACE FUNCTION public.sync_material_stock_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid := COALESCE(NEW.empresa_id, OLD.empresa_id);
  v_material_id uuid := COALESCE(NEW.material_id, OLD.material_id);
  v_total integer;
BEGIN
  SELECT COALESCE(sum(quantidade), 0)::integer INTO v_total
  FROM public.estoque_saldos
  WHERE empresa_id = v_company_id
    AND material_id = v_material_id;
  PERFORM set_config('backstage.stock_projection_write', 'on', true);
  UPDATE public.materiais
  SET quantidade = v_total
  WHERE empresa_id = v_company_id
    AND id = v_material_id;
  PERFORM set_config('backstage.stock_projection_write', 'off', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sync_material_stock_projection
AFTER INSERT OR UPDATE OR DELETE ON public.estoque_saldos
FOR EACH ROW EXECUTE FUNCTION public.sync_material_stock_projection();

CREATE OR REPLACE FUNCTION public.protect_stock_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'ST019',
    MESSAGE = 'O histórico de estoque é imutável.';
END;
$$;

CREATE TRIGGER protect_stock_ledger
BEFORE UPDATE OR DELETE ON public.estoque_movimentacoes
FOR EACH ROW EXECUTE FUNCTION public.protect_stock_ledger();

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
  IF _source_module NOT IN ('manual', 'controle_estoque') THEN
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

  -- Lock every referenced location in UUID order. Besides avoiding lock-order
  -- inversions, this serializes an inactivation with a movement so destination
  -- activity is always checked against the locked current row.
  PERFORM 1
  FROM public.estoque_localizacoes
  WHERE empresa_id = _company_id
    AND (
      id = _origin_location_id
      OR id = _destination_location_id
    )
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

  -- Lock all rows for this material in deterministic order. The material lock
  -- already serializes competing operations, and these row locks form a second
  -- barrier against future writers.
  PERFORM 1 FROM public.estoque_saldos
  WHERE empresa_id = _company_id AND material_id = _material_id
  ORDER BY localizacao_id
  FOR UPDATE;

  -- Re-read the official total and compare the projection only after all
  -- controlling locks have been acquired.
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

CREATE OR REPLACE FUNCTION public.listar_estoque_resumo(
  _pagina integer DEFAULT 1,
  _tamanho_pagina integer DEFAULT 10,
  _busca text DEFAULT NULL,
  _tipo_controle text DEFAULT NULL,
  _filtro_saldo text DEFAULT NULL,
  _localizacao_id uuid DEFAULT NULL,
  _categoria_id uuid DEFAULT NULL,
  _ativo text DEFAULT 'ativos',
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (
  material jsonb,
  saldos jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_page integer := GREATEST(COALESCE(_pagina, 1), 1);
  v_page_size integer := LEAST(GREATEST(COALESCE(_tamanho_pagina, 10), 1), 100);
BEGIN
  v_company_id := public.resolve_stock_company(_empresa_id, false);
  IF COALESCE(_tipo_controle, 'todos') NOT IN ('todos', 'individual', 'quantidade')
     OR COALESCE(_filtro_saldo, 'todos') NOT IN
       ('todos', 'com_saldo', 'sem_saldo', 'abaixo_minimo')
     OR COALESCE(_ativo, 'ativos') NOT IN ('todos', 'ativos', 'inativos') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST004', MESSAGE = 'Filtro de estoque inválido.';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT item.*
    FROM public.materiais item
    WHERE item.empresa_id = v_company_id
      AND (
        nullif(btrim(_busca), '') IS NULL
        OR item.nome ILIKE '%' || btrim(_busca) || '%'
        OR item.codigo_interno ILIKE '%' || btrim(_busca) || '%'
        OR item.codigo_barras ILIKE '%' || btrim(_busca) || '%'
        OR item.identificador_unico::text ILIKE '%' || btrim(_busca) || '%'
        OR item.conteudo_qr_code ILIKE '%' || btrim(_busca) || '%'
      )
      AND (_categoria_id IS NULL OR item.categoria_id = _categoria_id)
      AND (
        COALESCE(_ativo, 'ativos') = 'todos'
        OR (_ativo = 'ativos' AND item.ativo)
        OR (_ativo = 'inativos' AND NOT item.ativo)
      )
      AND (
        COALESCE(_tipo_controle, 'todos') = 'todos'
        OR item.tipo_controle::text = _tipo_controle
      )
      AND (
        COALESCE(_filtro_saldo, 'todos') = 'todos'
        OR (_filtro_saldo = 'com_saldo' AND item.quantidade > 0)
        OR (_filtro_saldo = 'sem_saldo' AND item.quantidade = 0)
        OR (
          _filtro_saldo = 'abaixo_minimo'
          AND item.quantidade <= item.estoque_minimo
        )
      )
      AND (
        _localizacao_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.estoque_saldos location_balance
          WHERE location_balance.empresa_id = item.empresa_id
            AND location_balance.material_id = item.id
            AND location_balance.localizacao_id = _localizacao_id
            AND location_balance.quantidade > 0
        )
      )
  ),
  paged AS (
    SELECT filtered.*, count(*) OVER () AS matched_count
    FROM filtered
    ORDER BY lower(filtered.nome), filtered.id
    OFFSET (v_page - 1) * v_page_size
    LIMIT v_page_size
  )
  SELECT
    to_jsonb(paged) - 'matched_count',
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(balance)
          || jsonb_build_object(
            'localizacao',
            jsonb_build_object(
              'id', location.id,
              'codigo', location.codigo,
              'nome', location.nome,
              'ativa', location.ativa,
              'tipo', location.tipo
            )
          )
          ORDER BY location.nome
        )
        FROM public.estoque_saldos balance
        JOIN public.estoque_localizacoes location
          ON location.empresa_id = balance.empresa_id
         AND location.id = balance.localizacao_id
        WHERE balance.empresa_id = paged.empresa_id
          AND balance.material_id = paged.id
          AND balance.quantidade > 0
      ),
      '[]'::jsonb
    ),
    paged.matched_count
  FROM paged;
END;
$$;

CREATE VIEW public.estoque_divergencias_saldo
WITH (security_invoker = true)
AS
SELECT
  material.empresa_id,
  material.id AS material_id,
  material.quantidade AS quantidade_projetada,
  COALESCE(sum(balance.quantidade), 0)::integer AS quantidade_saldos
FROM public.materiais material
LEFT JOIN public.estoque_saldos balance
  ON balance.empresa_id = material.empresa_id
 AND balance.material_id = material.id
GROUP BY material.empresa_id, material.id, material.quantidade
HAVING material.quantidade <> COALESCE(sum(balance.quantidade), 0)::integer;

CREATE VIEW public.estoque_reconciliacao_legado
WITH (security_invoker = true)
AS
SELECT
  material.empresa_id,
  material.id AS material_id,
  material.codigo_interno,
  material.nome,
  material.tipo_controle,
  material.quantidade_legada_etapa1,
  material.quantidade AS saldo_atual,
  NOT EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes movement
    WHERE movement.empresa_id = material.empresa_id
      AND movement.material_id = material.id
      AND movement.tipo_movimentacao = 'saldo_inicial'
  ) AS saldo_inicial_pendente
FROM public.materiais material
WHERE material.quantidade_legada_etapa1 IS NOT NULL;

ALTER TABLE public.estoque_localizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users read stock locations"
ON public.estoque_localizacoes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Company admins create stock locations"
ON public.estoque_localizacoes FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
  AND public.company_has_operational_access(empresa_id)
);

CREATE POLICY "Company admins update stock locations"
ON public.estoque_localizacoes FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
  AND public.company_has_operational_access(empresa_id)
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
  AND public.company_has_operational_access(empresa_id)
);

CREATE POLICY "Company admins delete unused stock locations"
ON public.estoque_localizacoes FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
  AND public.company_has_operational_access(empresa_id)
);

CREATE POLICY "Company users read stock balances"
ON public.estoque_saldos FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Company users read stock movements"
ON public.estoque_movimentacoes FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'controle_estoque')
  AND public.company_has_active_module(empresa_id, 'gestao_materiais')
);

REVOKE ALL ON public.estoque_localizacoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estoque_saldos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estoque_movimentacoes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.estoque_localizacoes TO authenticated;
GRANT SELECT ON public.estoque_saldos TO authenticated;
GRANT SELECT ON public.estoque_movimentacoes TO authenticated;

-- These are administrative diagnostics, not application read models. Keeping
-- them unavailable to authenticated clients prevents the materials-module RLS
-- from exposing projected or legacy stock data while controle_estoque is off.
REVOKE ALL ON public.estoque_divergencias_saldo
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estoque_reconciliacao_legado
  FROM PUBLIC, anon, authenticated;

-- Ordinary material services may update metadata, never balances or the legacy
-- reconciliation reference. Projection updates execute as the function owner.
REVOKE UPDATE ON public.materiais FROM authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.materiais FROM authenticated;
GRANT UPDATE (
  categoria_id, codigo_interno, codigo_barras, tipo_identificacao,
  conteudo_qr_code, status_identificacao, nome, descricao, marca, modelo,
  numero_serie, numero_patrimonio, tipo_controle, unidade_medida, localizacao,
  valor_aquisicao, valor_reposicao, valor_locacao_padrao, data_aquisicao,
  fornecedor, observacoes, status_operacional, justificativa_status, ativo,
  estoque_minimo, updated_at, updated_by
) ON public.materiais TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_stock_company(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_stock_movement(
  uuid, uuid, public.estoque_movimentacao_tipo, integer, uuid, uuid,
  text, text, text, text, timestamptz, public.estoque_origem_modulo,
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_movimentacao_estoque(
  uuid, text, integer, uuid, uuid, uuid, text, text, text,
  timestamptz, text, uuid, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.ajustar_estoque_material(
  uuid, uuid, integer, text, text, uuid, text, timestamptz, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.estornar_movimentacao_estoque(
  uuid, text, uuid, timestamptz, uuid
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_estoque_resumo(
  integer, integer, text, text, text, uuid, uuid, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_movimentacao_estoque(
  uuid, text, integer, uuid, uuid, uuid, text, text, text,
  timestamptz, text, uuid, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_estoque_material(
  uuid, uuid, integer, text, text, uuid, text, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_movimentacao_estoque(
  uuid, text, uuid, timestamptz, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_estoque_resumo(
  integer, integer, text, text, text, uuid, uuid, text, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_stock_location_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_used_stock_location()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_material_stock_projection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_material_stock_projection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_stock_balance()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_stock_ledger()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.estoque_localizacoes IS
  'Canonical hierarchical stock locations. Code and name are unique per company.';
COMMENT ON TABLE public.estoque_saldos IS
  'Official current integer balance per material and location; writable only by stock RPCs.';
COMMENT ON TABLE public.estoque_movimentacoes IS
  'Immutable, idempotent stock ledger with before/after snapshots.';
COMMENT ON COLUMN public.materiais.quantidade IS
  'Deprecated as input. Database-only projection of the sum in estoque_saldos.';
COMMENT ON COLUMN public.materiais.quantidade_legada_etapa1 IS
  'Frozen pre-stage-two value for explicit reconciliation; never automatically converted.';
COMMENT ON COLUMN public.materiais.localizacao IS
  'Deprecated compatibility text. Official locations are estoque_localizacoes/estoque_saldos.';
COMMENT ON VIEW public.estoque_divergencias_saldo IS
  'Must remain empty; exposes projection-versus-official-balance inconsistencies.';
COMMENT ON VIEW public.estoque_reconciliacao_legado IS
  'Read-only aid for an explicit Registrar saldo inicial workflow; performs no backfill.';
