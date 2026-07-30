-- Backstage Pro - Materials and equipment, stage 1.
-- Additive inventory foundation only: no rental, reservation, check-in,
-- check-out, billing, return or automated maintenance workflows.

CREATE TYPE public.material_control_type AS ENUM (
  'individual',
  'quantidade'
);

CREATE TYPE public.material_operational_status AS ENUM (
  'disponivel',
  'em_manutencao',
  'avariado',
  'extraviado',
  'baixado'
);

CREATE TYPE public.material_identification_type AS ENUM (
  'qr_code',
  'codigo_barras',
  'ambos'
);

CREATE TYPE public.material_identification_status AS ENUM (
  'nao_gerada',
  'ativa',
  'inativa'
);

-- Canonical commercial modules for the materials domain. Only the stage-one
-- base module is currently sellable; the remaining keys reserve stable
-- contracts for future features without exposing unfinished functionality.
INSERT INTO public.module_catalog (
  nome,
  descricao,
  valor,
  periodicidade,
  ativo,
  ordem,
  tipo_modulo,
  feature_key,
  metadata,
  is_capacity_module,
  categoria,
  texto_venda
)
VALUES (
  'Gestão de Materiais',
  'Cadastro patrimonial de categorias, materiais, equipamentos, fotos e identificação técnica.',
  0,
  'mensal',
  true,
  40,
  'addon',
  'gestao_materiais',
  jsonb_build_object(
    'area', 'materiais',
    'stage', 1,
    'base_module', true
  ),
  false,
  'operacional',
  'Organize materiais, equipamentos, fotos e identificadores técnicos.'
)
ON CONFLICT (feature_key) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    ativo = true,
    metadata = COALESCE(public.module_catalog.metadata, '{}'::jsonb)
      || EXCLUDED.metadata,
    updated_at = clock_timestamp();

INSERT INTO public.module_catalog (
  nome,
  descricao,
  valor,
  periodicidade,
  ativo,
  ordem,
  tipo_modulo,
  feature_key,
  metadata,
  is_capacity_module,
  categoria
)
VALUES
  (
    'Controle de Estoque',
    'Módulo futuro de entradas, saídas, ajustes e inventários.',
    0, 'mensal', false, 41, 'addon', 'controle_estoque',
    '{"area":"materiais","planned":true}'::jsonb, false, 'operacional'
  ),
  (
    'Check-in e Check-out',
    'Módulo futuro de retirada, conferência e devolução.',
    0, 'mensal', false, 42, 'addon', 'checkin_checkout',
    '{"area":"materiais","planned":true}'::jsonb, false, 'operacional'
  ),
  (
    'Locação de Materiais',
    'Módulo futuro de orçamentos, reservas e locações.',
    0, 'mensal', false, 43, 'addon', 'locacao_materiais',
    '{"area":"materiais","planned":true}'::jsonb, false, 'operacional'
  ),
  (
    'Manutenção de Equipamentos',
    'Módulo futuro de manutenções preventivas e corretivas.',
    0, 'mensal', false, 44, 'addon', 'manutencao_equipamentos',
    '{"area":"materiais","planned":true}'::jsonb, false, 'operacional'
  ),
  (
    'Etiquetas e Identificação',
    'Módulo futuro de modelos, impressão e histórico de etiquetas.',
    0, 'mensal', false, 45, 'addon', 'etiquetas_materiais',
    '{"area":"materiais","planned":true}'::jsonb, false, 'operacional'
  ),
  (
    'Relatórios de Materiais e Locações',
    'Módulo futuro de indicadores operacionais e comerciais.',
    0, 'mensal', false, 46, 'addon', 'relatorios_materiais',
    '{"area":"materiais","planned":true}'::jsonb, false, 'gestao'
  )
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE public.module_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL
    REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  required_module_id uuid NOT NULL
    REFERENCES public.module_catalog(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_dependencies_not_self
    CHECK (module_id <> required_module_id),
  CONSTRAINT module_dependencies_unique
    UNIQUE (module_id, required_module_id)
);

CREATE INDEX module_dependencies_required_idx
  ON public.module_dependencies (required_module_id);

INSERT INTO public.module_dependencies (
  module_id,
  required_module_id
)
SELECT child.id, base.id
FROM public.module_catalog AS child
CROSS JOIN public.module_catalog AS base
WHERE base.feature_key = 'gestao_materiais'
  AND child.feature_key IN (
    'controle_estoque',
    'checkin_checkout',
    'locacao_materiais',
    'manutencao_equipamentos',
    'etiquetas_materiais',
    'relatorios_materiais'
  )
ON CONFLICT (module_id, required_module_id) DO NOTHING;

ALTER TABLE public.module_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master administrators manage module dependencies"
ON public.module_dependencies
FOR ALL TO authenticated
USING (public.is_master_admin(auth.uid()))
WITH CHECK (public.is_master_admin(auth.uid()));

CREATE POLICY "Authenticated users read active module dependencies"
ON public.module_dependencies
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.module_catalog AS module
    WHERE module.id = module_dependencies.module_id
      AND module.ativo = true
  )
);

REVOKE ALL ON public.module_dependencies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.module_dependencies TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_material_module_catalog_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_protected_keys constant text[] := ARRAY[
    'gestao_materiais',
    'controle_estoque',
    'checkin_checkout',
    'locacao_materiais',
    'manutencao_equipamentos',
    'etiquetas_materiais',
    'relatorios_materiais'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.feature_key = ANY (v_protected_keys) THEN
      RAISE EXCEPTION
        'Canonical material module catalog entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.feature_key = ANY (v_protected_keys)
     AND NEW.feature_key IS DISTINCT FROM OLD.feature_key THEN
    RAISE EXCEPTION
      'Canonical material module feature keys cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_material_module_catalog_keys
  ON public.module_catalog;
CREATE TRIGGER protect_material_module_catalog_keys
BEFORE UPDATE OR DELETE ON public.module_catalog
FOR EACH ROW
EXECUTE FUNCTION public.protect_material_module_catalog_keys();

CREATE OR REPLACE FUNCTION public.company_module_dependencies_satisfied(
  _empresa_id uuid,
  _module_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.company_has_lifetime_subscription(_empresa_id)
    OR NOT EXISTS (
      WITH RECURSIVE required_modules(module_id) AS (
        SELECT dependency.required_module_id
        FROM public.module_dependencies AS dependency
        WHERE dependency.module_id = _module_id

        UNION

        SELECT dependency.required_module_id
        FROM public.module_dependencies AS dependency
        JOIN required_modules AS required
          ON dependency.module_id = required.module_id
      )
      SELECT 1
      FROM required_modules AS required
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.empresa_modules AS company_module
        JOIN public.module_catalog AS catalog
          ON catalog.id = company_module.module_id
        WHERE company_module.empresa_id = _empresa_id
          AND company_module.module_id = required.module_id
          AND company_module.status = 'active'
          AND catalog.ativo = true
          AND (
            company_module.expires_at IS NULL
            OR company_module.expires_at >= statement_timestamp()
          )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.company_has_active_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    _empresa_id IS NOT NULL
    AND _feature_key IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.module_catalog AS catalog
      WHERE catalog.feature_key = _feature_key
        AND catalog.ativo = true
        AND (
          public.company_has_lifetime_subscription(_empresa_id)
          OR (
            EXISTS (
              SELECT 1
              FROM public.empresa_modules AS company_module
              WHERE company_module.empresa_id = _empresa_id
                AND company_module.module_id = catalog.id
                AND company_module.status = 'active'
                AND (
                  company_module.expires_at IS NULL
                  OR company_module.expires_at >= statement_timestamp()
                )
            )
            AND public.company_module_dependencies_satisfied(
              _empresa_id,
              catalog.id
            )
          )
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.enforce_company_module_dependencies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_catalog_active boolean;
  v_deactivating boolean := false;
  v_has_active_dependents boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_deactivating := OLD.status = 'active';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    v_deactivating :=
      NEW.module_id IS DISTINCT FROM OLD.module_id
      OR NEW.status IS DISTINCT FROM 'active'
      OR (
        NEW.expires_at IS NOT NULL
        AND NEW.expires_at < statement_timestamp()
      );
  END IF;

  IF v_deactivating
     AND NOT public.company_has_lifetime_subscription(OLD.empresa_id) THEN
    WITH RECURSIVE dependent_modules(module_id) AS (
      SELECT dependency.module_id
      FROM public.module_dependencies AS dependency
      WHERE dependency.required_module_id = OLD.module_id

      UNION

      SELECT dependency.module_id
      FROM public.module_dependencies AS dependency
      JOIN dependent_modules AS dependent
        ON dependency.required_module_id = dependent.module_id
    )
    SELECT EXISTS (
      SELECT 1
      FROM dependent_modules AS dependent
      JOIN public.empresa_modules AS company_module
        ON company_module.module_id = dependent.module_id
      JOIN public.module_catalog AS catalog
        ON catalog.id = dependent.module_id
      WHERE company_module.empresa_id = OLD.empresa_id
        AND company_module.status = 'active'
        AND catalog.ativo = true
        AND (
          company_module.expires_at IS NULL
          OR company_module.expires_at >= statement_timestamp()
        )
    )
    INTO v_has_active_dependents;

    IF v_has_active_dependents THEN
      RAISE EXCEPTION
        'Cannot disable a module while dependent modules are active';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.status = 'active' THEN
    SELECT catalog.ativo
    INTO v_catalog_active
    FROM public.module_catalog AS catalog
    WHERE catalog.id = NEW.module_id;

    IF NOT COALESCE(v_catalog_active, false) THEN
      RAISE EXCEPTION 'Cannot activate an inactive catalog module';
    END IF;

    IF NOT public.company_module_dependencies_satisfied(
      NEW.empresa_id,
      NEW.module_id
    ) THEN
      RAISE EXCEPTION
        'Cannot activate a module before its dependencies';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_company_module_dependencies
  ON public.empresa_modules;
CREATE TRIGGER enforce_company_module_dependencies
BEFORE INSERT OR UPDATE OR DELETE ON public.empresa_modules
FOR EACH ROW
EXECUTE FUNCTION public.enforce_company_module_dependencies();

CREATE TABLE public.categorias_materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT categorias_materiais_nome_not_blank
    CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX categorias_materiais_empresa_nome_uidx
  ON public.categorias_materiais (
    empresa_id,
    lower(btrim(nome))
  );

CREATE INDEX categorias_materiais_empresa_ativo_idx
  ON public.categorias_materiais (empresa_id, ativo);

CREATE TABLE public.materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL
    REFERENCES public.categorias_materiais(id) ON DELETE RESTRICT,
  codigo_interno text NOT NULL,
  identificador_unico uuid NOT NULL DEFAULT gen_random_uuid(),
  codigo_barras text,
  tipo_identificacao public.material_identification_type
    NOT NULL DEFAULT 'qr_code',
  conteudo_qr_code text,
  identificacao_gerada_em timestamptz,
  identificacao_gerada_por uuid,
  status_identificacao public.material_identification_status
    NOT NULL DEFAULT 'nao_gerada',
  nome text NOT NULL,
  descricao text,
  marca text,
  modelo text,
  numero_serie text,
  numero_patrimonio text,
  tipo_controle public.material_control_type NOT NULL,
  quantidade integer NOT NULL DEFAULT 1,
  unidade_medida text NOT NULL DEFAULT 'unidade',
  localizacao text,
  valor_aquisicao numeric(14, 2),
  valor_reposicao numeric(14, 2),
  valor_locacao_padrao numeric(14, 2),
  data_aquisicao date,
  fornecedor text,
  observacoes text,
  status_operacional public.material_operational_status
    NOT NULL DEFAULT 'disponivel',
  justificativa_status text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT materiais_codigo_not_blank
    CHECK (btrim(codigo_interno) <> ''),
  CONSTRAINT materiais_nome_not_blank
    CHECK (btrim(nome) <> ''),
  CONSTRAINT materiais_unidade_not_blank
    CHECK (btrim(unidade_medida) <> ''),
  CONSTRAINT materiais_quantidade_nonnegative
    CHECK (quantidade >= 0),
  CONSTRAINT materiais_individual_quantity
    CHECK (
      tipo_controle <> 'individual'
      OR quantidade = 1
    ),
  CONSTRAINT materiais_codigo_barras_printable
    CHECK (
      codigo_barras IS NULL
      OR (
        codigo_barras = btrim(codigo_barras)
        AND length(codigo_barras) BETWEEN 3 AND 80
        AND codigo_barras ~ '^[ -~]+$'
      )
    ),
  CONSTRAINT materiais_identification_type_content
    CHECK (
      tipo_identificacao = 'qr_code'
      OR codigo_barras IS NOT NULL
    ),
  CONSTRAINT materiais_qr_content_shape
    CHECK (
      conteudo_qr_code IS NULL
      OR conteudo_qr_code =
        'BACKSTAGE-PRO:MATERIAL:' || identificador_unico::text
    ),
  CONSTRAINT materiais_identification_status_content
    CHECK (
      (
        status_identificacao = 'nao_gerada'
        AND conteudo_qr_code IS NULL
        AND codigo_barras IS NULL
      )
      OR (
        status_identificacao IN ('ativa', 'inativa')
        AND (
          conteudo_qr_code IS NOT NULL
          OR codigo_barras IS NOT NULL
        )
      )
    ),
  CONSTRAINT materiais_valor_aquisicao_nonnegative
    CHECK (valor_aquisicao IS NULL OR valor_aquisicao >= 0),
  CONSTRAINT materiais_valor_reposicao_nonnegative
    CHECK (valor_reposicao IS NULL OR valor_reposicao >= 0),
  CONSTRAINT materiais_valor_locacao_nonnegative
    CHECK (
      valor_locacao_padrao IS NULL
      OR valor_locacao_padrao >= 0
    ),
  CONSTRAINT materiais_manual_status_justification
    CHECK (
      status_operacional NOT IN (
        'em_manutencao',
        'avariado',
        'extraviado',
        'baixado'
      )
      OR nullif(btrim(justificativa_status), '') IS NOT NULL
    )
);

CREATE UNIQUE INDEX materiais_empresa_codigo_uidx
  ON public.materiais (
    empresa_id,
    lower(btrim(codigo_interno))
  );

CREATE UNIQUE INDEX materiais_identificador_unico_uidx
  ON public.materiais (identificador_unico);

CREATE UNIQUE INDEX materiais_empresa_codigo_barras_uidx
  ON public.materiais (
    empresa_id,
    lower(btrim(codigo_barras))
  )
  WHERE codigo_barras IS NOT NULL;

CREATE UNIQUE INDEX materiais_empresa_patrimonio_uidx
  ON public.materiais (
    empresa_id,
    lower(btrim(numero_patrimonio))
  )
  WHERE nullif(btrim(numero_patrimonio), '') IS NOT NULL;

CREATE UNIQUE INDEX materiais_empresa_serie_uidx
  ON public.materiais (
    empresa_id,
    lower(btrim(numero_serie))
  )
  WHERE nullif(btrim(numero_serie), '') IS NOT NULL;

CREATE INDEX materiais_empresa_idx
  ON public.materiais (empresa_id);
CREATE INDEX materiais_empresa_categoria_idx
  ON public.materiais (empresa_id, categoria_id);
CREATE INDEX materiais_empresa_status_idx
  ON public.materiais (empresa_id, status_operacional);
CREATE INDEX materiais_empresa_ativo_idx
  ON public.materiais (empresa_id, ativo);
CREATE INDEX materiais_empresa_nome_idx
  ON public.materiais (empresa_id, lower(nome));
CREATE INDEX materiais_empresa_localizacao_idx
  ON public.materiais (empresa_id, lower(localizacao))
  WHERE localizacao IS NOT NULL;

CREATE TABLE public.materiais_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  material_id uuid NOT NULL
    REFERENCES public.materiais(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  nome_arquivo text NOT NULL,
  tipo_arquivo text NOT NULL,
  tamanho_arquivo bigint NOT NULL,
  foto_principal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT materiais_fotos_nome_not_blank
    CHECK (btrim(nome_arquivo) <> ''),
  CONSTRAINT materiais_fotos_path_not_blank
    CHECK (btrim(storage_path) <> ''),
  CONSTRAINT materiais_fotos_tamanho_positive
    CHECK (tamanho_arquivo > 0),
  CONSTRAINT materiais_fotos_tamanho_limit
    CHECK (tamanho_arquivo <= 8388608),
  CONSTRAINT materiais_fotos_mime
    CHECK (
      tipo_arquivo IN (
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    )
);

CREATE UNIQUE INDEX materiais_fotos_principal_uidx
  ON public.materiais_fotos (material_id)
  WHERE foto_principal;

CREATE INDEX materiais_fotos_empresa_material_idx
  ON public.materiais_fotos (empresa_id, material_id);

CREATE OR REPLACE FUNCTION public.prepare_material_category_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_empresa_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_master_admin(auth.uid()) THEN
    v_user_empresa_id := public.get_user_empresa_id(auth.uid());
    IF v_user_empresa_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated user has no canonical company';
    END IF;
    NEW.empresa_id := v_user_empresa_id;
  END IF;

  NEW.nome := btrim(NEW.nome);
  NEW.descricao := nullif(btrim(NEW.descricao), '');
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_material_category_write
BEFORE INSERT OR UPDATE ON public.categorias_materiais
FOR EACH ROW
EXECUTE FUNCTION public.prepare_material_category_write();

CREATE OR REPLACE FUNCTION public.protect_used_material_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.materiais
    WHERE categoria_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Categoria em uso não pode ser excluída; inative-a';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER protect_used_material_category
BEFORE DELETE ON public.categorias_materiais
FOR EACH ROW
EXECUTE FUNCTION public.protect_used_material_category();

CREATE OR REPLACE FUNCTION public.prepare_material_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category_company_id uuid;
  v_user_empresa_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_master_admin(auth.uid()) THEN
    v_user_empresa_id := public.get_user_empresa_id(auth.uid());
    IF v_user_empresa_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated user has no canonical company';
    END IF;
    NEW.empresa_id := v_user_empresa_id;
  END IF;

  SELECT empresa_id
  INTO v_category_company_id
  FROM public.categorias_materiais
  WHERE id = NEW.categoria_id;

  IF v_category_company_id IS NULL
     OR v_category_company_id <> NEW.empresa_id THEN
    RAISE EXCEPTION
      'Categoria deve pertencer à mesma empresa do material';
  END IF;

  NEW.codigo_interno := btrim(NEW.codigo_interno);
  NEW.nome := btrim(NEW.nome);
  NEW.descricao := nullif(btrim(NEW.descricao), '');
  NEW.marca := nullif(btrim(NEW.marca), '');
  NEW.modelo := nullif(btrim(NEW.modelo), '');
  NEW.numero_serie := nullif(btrim(NEW.numero_serie), '');
  NEW.numero_patrimonio :=
    nullif(btrim(NEW.numero_patrimonio), '');
  NEW.codigo_barras := nullif(btrim(NEW.codigo_barras), '');
  NEW.unidade_medida := btrim(NEW.unidade_medida);
  NEW.localizacao := nullif(btrim(NEW.localizacao), '');
  NEW.fornecedor := nullif(btrim(NEW.fornecedor), '');
  NEW.observacoes := nullif(btrim(NEW.observacoes), '');
  NEW.justificativa_status :=
    nullif(btrim(NEW.justificativa_status), '');

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.identificador_unico := gen_random_uuid();
  ELSIF NEW.identificador_unico IS NULL THEN
    NEW.identificador_unico := gen_random_uuid();
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status_operacional <> 'disponivel' THEN
      RAISE EXCEPTION
        'Novos materiais devem iniciar como disponível';
    END IF;
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.identificacao_gerada_em := NULL;
    NEW.identificacao_gerada_por := NULL;
    NEW.status_identificacao := 'nao_gerada';
  ELSE
    IF NEW.identificador_unico IS DISTINCT FROM OLD.identificador_unico THEN
      RAISE EXCEPTION
        'Identificador técnico do material é imutável';
    END IF;

    IF OLD.conteudo_qr_code IS NOT NULL
       AND NEW.conteudo_qr_code IS DISTINCT FROM OLD.conteudo_qr_code THEN
      RAISE EXCEPTION 'Conteúdo do QR Code do material é imutável';
    END IF;

    NEW.identificacao_gerada_em := OLD.identificacao_gerada_em;
    NEW.identificacao_gerada_por := OLD.identificacao_gerada_por;

    IF NEW.status_operacional IS DISTINCT FROM OLD.status_operacional THEN
      IF NEW.status_operacional IN (
        'em_manutencao',
        'avariado',
        'extraviado',
        'baixado'
      )
      AND NEW.justificativa_status IS NULL THEN
        RAISE EXCEPTION
          'Justificativa é obrigatória para a alteração de status';
      END IF;
    END IF;
  END IF;

  IF NEW.conteudo_qr_code IS NOT NULL
     AND NEW.conteudo_qr_code <>
       'BACKSTAGE-PRO:MATERIAL:' || NEW.identificador_unico::text THEN
    RAISE EXCEPTION
      'Conteúdo do QR Code deve usar somente o identificador técnico';
  END IF;

  IF NEW.conteudo_qr_code IS NOT NULL
     OR NEW.codigo_barras IS NOT NULL THEN
    IF NEW.identificacao_gerada_em IS NULL THEN
      NEW.identificacao_gerada_em := clock_timestamp();
      NEW.identificacao_gerada_por :=
        COALESCE(auth.uid(), NEW.identificacao_gerada_por);
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.status_identificacao = 'nao_gerada'
       OR (
         OLD.conteudo_qr_code IS NULL
         AND OLD.codigo_barras IS NULL
       ) THEN
      NEW.status_identificacao := 'ativa';
    END IF;
  ELSE
    NEW.status_identificacao := 'nao_gerada';
    NEW.identificacao_gerada_em := NULL;
    NEW.identificacao_gerada_por := NULL;
  END IF;

  NEW.updated_at := clock_timestamp();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_material_write
BEFORE INSERT OR UPDATE ON public.materiais
FOR EACH ROW
EXECUTE FUNCTION public.prepare_material_write();

CREATE OR REPLACE FUNCTION public.generate_material_qr_code(
  _material_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_identifier uuid;
  v_existing_content text;
  v_content text;
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

  SELECT
    material.identificador_unico,
    material.conteudo_qr_code
  INTO
    v_identifier,
    v_existing_content
  FROM public.materiais AS material
  WHERE material.id = _material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão';
  END IF;

  v_content :=
    'BACKSTAGE-PRO:MATERIAL:' || v_identifier::text;

  IF v_existing_content IS NOT NULL THEN
    IF v_existing_content <> v_content THEN
      RAISE EXCEPTION 'Identificação QR armazenada é inconsistente';
    END IF;
    RETURN v_existing_content;
  END IF;

  UPDATE public.materiais
  SET conteudo_qr_code = v_content,
      tipo_identificacao = CASE
        WHEN codigo_barras IS NULL THEN 'qr_code'
        ELSE 'ambos'
      END::public.material_identification_type,
      status_identificacao = 'ativa'
  WHERE id = _material_id;

  RETURN v_content;
END;
$$;

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
  v_attempt integer;
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

REVOKE ALL ON FUNCTION public.generate_material_qr_code(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_material_barcode(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_material_qr_code(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_material_barcode(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_material_photo_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_material_company_id uuid;
BEGIN
  SELECT empresa_id
  INTO v_material_company_id
  FROM public.materiais
  WHERE id = NEW.material_id;

  IF v_material_company_id IS NULL THEN
    RAISE EXCEPTION 'Material da foto não foi encontrado';
  END IF;

  NEW.empresa_id := v_material_company_id;
  NEW.nome_arquivo := btrim(NEW.nome_arquivo);
  NEW.storage_path := btrim(NEW.storage_path);

  IF NEW.storage_path NOT LIKE
       NEW.empresa_id::text || '/' || NEW.material_id::text || '/%' THEN
    RAISE EXCEPTION
      'Caminho da foto não corresponde à empresa e ao material';
  END IF;

  IF NEW.foto_principal THEN
    UPDATE public.materiais_fotos
    SET foto_principal = false
    WHERE material_id = NEW.material_id
      AND id <> NEW.id
      AND foto_principal;
  ELSIF TG_OP = 'INSERT'
        AND NOT EXISTS (
          SELECT 1
          FROM public.materiais_fotos
          WHERE material_id = NEW.material_id
        ) THEN
    NEW.foto_principal := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_material_photo_write
BEFORE INSERT OR UPDATE ON public.materiais_fotos
FOR EACH ROW
EXECUTE FUNCTION public.prepare_material_photo_write();

CREATE OR REPLACE FUNCTION public.promote_material_photo_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.foto_principal THEN
    UPDATE public.materiais_fotos
    SET foto_principal = true
    WHERE id = (
      SELECT id
      FROM public.materiais_fotos
      WHERE material_id = OLD.material_id
      ORDER BY created_at, id
      LIMIT 1
    );
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER promote_material_photo_after_delete
AFTER DELETE ON public.materiais_fotos
FOR EACH ROW
EXECUTE FUNCTION public.promote_material_photo_after_delete();

ALTER TABLE public.categorias_materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materiais_fotos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Licensed tenant users read material categories"
ON public.categorias_materiais
FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators insert material categories"
ON public.categorias_materiais
FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators update material categories"
ON public.categorias_materiais
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators delete unused material categories"
ON public.categorias_materiais
FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant users read materials"
ON public.materiais
FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators insert materials"
ON public.materiais
FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators update materials"
ON public.materiais
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant users read material photo metadata"
ON public.materiais_fotos
FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'gestao_materiais')
);

CREATE POLICY "Licensed tenant administrators insert material photo metadata"
ON public.materiais_fotos
FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  AND EXISTS (
    SELECT 1
    FROM public.materiais
    WHERE id = material_id
      AND empresa_id = materiais_fotos.empresa_id
  )
);

CREATE POLICY "Licensed tenant administrators update material photo metadata"
ON public.materiais_fotos
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  AND EXISTS (
    SELECT 1
    FROM public.materiais
    WHERE id = material_id
      AND empresa_id = materiais_fotos.empresa_id
  )
);

CREATE POLICY "Licensed tenant administrators delete material photo metadata"
ON public.materiais_fotos
FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
);

REVOKE ALL ON public.categorias_materiais FROM anon;
REVOKE ALL ON public.materiais FROM anon;
REVOKE ALL ON public.materiais_fotos FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.categorias_materiais TO authenticated;
GRANT SELECT, INSERT, UPDATE
  ON public.materiais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.materiais_fotos TO authenticated;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'material-photos',
  'material-photos',
  false,
  8388608,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.is_valid_material_photo_path(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    _file_path IS NOT NULL
    AND _file_path ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+\.(jpe?g|png|webp)$'
    AND _file_path NOT LIKE '%..%'
$$;

CREATE OR REPLACE FUNCTION public.can_read_material_photo_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_material_photo_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.materiais_fotos AS photo
      WHERE photo.storage_path = _file_path
        AND photo.empresa_id::text =
            split_part(_file_path, '/', 1)
        AND photo.material_id::text =
            split_part(_file_path, '/', 2)
        AND public.can_read_company_module(
          photo.empresa_id,
          'gestao_materiais'
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_material_photo_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_material_photo_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.materiais AS material
      WHERE material.id::text = split_part(_file_path, '/', 2)
        AND material.empresa_id::text =
            split_part(_file_path, '/', 1)
        AND public.can_write_company_module(
          material.empresa_id,
          'gestao_materiais'
        )
    )
$$;

CREATE POLICY "Tenant users read registered material photos"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'material-photos'
  AND public.can_read_material_photo_object(name)
);

CREATE POLICY "Tenant administrators upload material photos"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name)
);

CREATE POLICY "Tenant administrators replace material photos"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name)
)
WITH CHECK (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name)
);

CREATE POLICY "Tenant administrators delete material photos"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'material-photos'
  AND public.can_manage_material_photo_object(name)
);

REVOKE ALL ON FUNCTION public.prepare_material_category_write()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_used_material_category()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_material_write()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_material_photo_write()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_material_photo_after_delete()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_material_module_catalog_keys()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION
  public.company_module_dependencies_satisfied(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_has_active_module(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_company_module_dependencies()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_valid_material_photo_path(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_material_photo_object(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_material_photo_object(text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_valid_material_photo_path(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_material_photo_object(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_material_photo_object(text)
  TO authenticated, service_role;

COMMENT ON TABLE public.categorias_materiais IS
  'Tenant-scoped material and equipment categories.';
COMMENT ON TABLE public.materiais IS
  'Tenant-scoped material and equipment master data.';
COMMENT ON TABLE public.materiais_fotos IS
  'Private Storage metadata for material photos.';
COMMENT ON TABLE public.module_dependencies IS
  'Reusable dependency graph between commercial Backstage Pro modules.';
COMMENT ON FUNCTION
  public.company_module_dependencies_satisfied(uuid, uuid) IS
  'Checks all transitive module dependencies for a company.';
COMMENT ON FUNCTION public.company_has_active_module(uuid, text) IS
  'Canonical entitlement check including active catalog keys, lifetime licenses, expiry and dependencies.';
