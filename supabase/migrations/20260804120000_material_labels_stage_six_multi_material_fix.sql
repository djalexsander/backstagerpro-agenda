-- Backstage Pro - Stage 6.1: atomic multi-material label batches.
-- Incremental compatibility layer over Stage 6. No legacy history is removed.

ALTER TABLE public.etiqueta_modelos
  ADD COLUMN margem_interna_mm numeric(5, 2) NOT NULL DEFAULT 1.50,
  ADD COLUMN espacamento_interno_mm numeric(5, 2) NOT NULL DEFAULT 1.50;

ALTER TABLE public.etiqueta_modelos
  ADD CONSTRAINT etiqueta_modelos_inner_margin
    CHECK (margem_interna_mm BETWEEN 0 AND 10),
  ADD CONSTRAINT etiqueta_modelos_inner_spacing
    CHECK (espacamento_interno_mm BETWEEN 0 AND 10);

COMMENT ON COLUMN public.etiqueta_modelos.margem_interna_mm IS
  'Internal content padding controlled by the application. Physical printer margins still depend on browser, driver and hardware.';
COMMENT ON COLUMN public.etiqueta_modelos.espacamento_interno_mm IS
  'Internal gap between identification codes and text. It is not inter-label media spacing.';

CREATE TABLE public.etiqueta_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modelo_id uuid,
  modelo_snapshot jsonb NOT NULL,
  quantidade_materiais integer NOT NULL,
  quantidade_etiquetas integer NOT NULL,
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  solicitada_por uuid NOT NULL,
  solicitante_nome text NOT NULL,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  reimpressao_de_id uuid,
  origem text NOT NULL DEFAULT 'lote',
  CONSTRAINT etiqueta_solicitacoes_empresa_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT etiqueta_solicitacoes_modelo_company_fk
    FOREIGN KEY (empresa_id, modelo_id)
    REFERENCES public.etiqueta_modelos (empresa_id, id) ON DELETE SET NULL,
  CONSTRAINT etiqueta_solicitacoes_reprint_company_fk
    FOREIGN KEY (empresa_id, reimpressao_de_id)
    REFERENCES public.etiqueta_solicitacoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT etiqueta_solicitacoes_material_count CHECK (quantidade_materiais BETWEEN 1 AND 100),
  CONSTRAINT etiqueta_solicitacoes_label_count CHECK (quantidade_etiquetas BETWEEN 1 AND 5000),
  CONSTRAINT etiqueta_solicitacoes_actor_name CHECK (btrim(solicitante_nome) <> ''),
  CONSTRAINT etiqueta_solicitacoes_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT etiqueta_solicitacoes_model_snapshot CHECK (jsonb_typeof(modelo_snapshot) = 'object'),
  CONSTRAINT etiqueta_solicitacoes_origin CHECK (origem IN ('legado_etapa_6', 'lote')),
  CONSTRAINT etiqueta_solicitacoes_not_self_reprint CHECK (reimpressao_de_id IS DISTINCT FROM id)
);

CREATE TABLE public.etiqueta_solicitacao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  solicitacao_id uuid NOT NULL,
  material_id uuid NOT NULL,
  ordem integer NOT NULL,
  quantidade integer NOT NULL,
  material_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT etiqueta_solicitacao_itens_request_company_fk
    FOREIGN KEY (empresa_id, solicitacao_id)
    REFERENCES public.etiqueta_solicitacoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT etiqueta_solicitacao_itens_material_company_fk
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT etiqueta_solicitacao_itens_request_material_unique UNIQUE (solicitacao_id, material_id),
  CONSTRAINT etiqueta_solicitacao_itens_request_order_unique UNIQUE (solicitacao_id, ordem),
  CONSTRAINT etiqueta_solicitacao_itens_order CHECK (ordem BETWEEN 1 AND 100),
  CONSTRAINT etiqueta_solicitacao_itens_quantity CHECK (quantidade BETWEEN 1 AND 500),
  CONSTRAINT etiqueta_solicitacao_itens_snapshot CHECK (jsonb_typeof(material_snapshot) = 'object')
);

CREATE UNIQUE INDEX etiqueta_solicitacoes_empresa_client_uidx
  ON public.etiqueta_solicitacoes (empresa_id, client_uuid);
CREATE INDEX etiqueta_solicitacoes_empresa_date_idx
  ON public.etiqueta_solicitacoes (empresa_id, solicitada_em DESC, id DESC);
CREATE INDEX etiqueta_solicitacao_itens_material_date_idx
  ON public.etiqueta_solicitacao_itens (empresa_id, material_id, solicitacao_id);
CREATE INDEX etiqueta_solicitacao_itens_request_order_idx
  ON public.etiqueta_solicitacao_itens (empresa_id, solicitacao_id, ordem);

-- Deterministic compatibility backfill: one Stage-6 row becomes one batch with
-- one item. IDs, actor, timestamp, client key and snapshots are preserved.
INSERT INTO public.etiqueta_solicitacoes (
  id, empresa_id, modelo_id, modelo_snapshot, quantidade_materiais,
  quantidade_etiquetas, solicitada_em, solicitada_por, solicitante_nome,
  client_uuid, payload_hash, origem
)
SELECT
  i.id, i.empresa_id, i.modelo_id, i.modelo_snapshot, 1,
  i.quantidade, i.solicitada_em, i.solicitada_por, i.solicitante_nome,
  i.client_uuid, i.payload_hash, 'legado_etapa_6'
FROM public.etiqueta_impressoes AS i
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.etiqueta_solicitacao_itens (
  id, empresa_id, solicitacao_id, material_id, ordem, quantidade,
  material_snapshot, created_at
)
SELECT
  i.id, i.empresa_id, i.id, i.material_id, 1, i.quantidade,
  i.material_snapshot, i.solicitada_em
FROM public.etiqueta_impressoes AS i
ON CONFLICT (id) DO NOTHING;

UPDATE public.etiqueta_solicitacoes AS request
SET reimpressao_de_id = legacy.reimpressao_de_id
FROM public.etiqueta_impressoes AS legacy
WHERE request.id = legacy.id
  AND legacy.reimpressao_de_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.etiqueta_solicitacoes AS original
    WHERE original.empresa_id = request.empresa_id
      AND original.id = legacy.reimpressao_de_id
  );

CREATE OR REPLACE FUNCTION public.protect_material_label_batch_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('backstage.material_label_batch_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'LB014', MESSAGE = 'O historico de impressoes e imutavel.';
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_material_label_batch_completeness(
  _company_id uuid,
  _request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_expected_materials integer;
  v_expected_labels integer;
  v_materials integer;
  v_labels integer;
BEGIN
  SELECT quantidade_materiais, quantidade_etiquetas
  INTO v_expected_materials, v_expected_labels
  FROM public.etiqueta_solicitacoes
  WHERE empresa_id = _company_id AND id = _request_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::integer, COALESCE(sum(quantidade), 0)::integer
  INTO v_materials, v_labels
  FROM public.etiqueta_solicitacao_itens
  WHERE empresa_id = _company_id AND solicitacao_id = _request_id;

  IF v_materials <> v_expected_materials OR v_labels <> v_expected_labels THEN
    RAISE EXCEPTION USING ERRCODE = 'LB018',
      MESSAGE = 'O lote de etiquetas esta incompleto ou possui totais divergentes.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_material_label_batch_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.assert_material_label_batch_completeness(OLD.empresa_id,OLD.id);
  ELSE PERFORM public.assert_material_label_batch_completeness(NEW.empresa_id,NEW.id); END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_material_label_batch_item_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.assert_material_label_batch_completeness(OLD.empresa_id,OLD.solicitacao_id);
  ELSE PERFORM public.assert_material_label_batch_completeness(NEW.empresa_id,NEW.solicitacao_id); END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER etiqueta_solicitacoes_completeness
AFTER INSERT OR UPDATE ON public.etiqueta_solicitacoes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_material_label_batch_completeness();

CREATE CONSTRAINT TRIGGER etiqueta_solicitacao_itens_completeness
AFTER INSERT OR UPDATE OR DELETE ON public.etiqueta_solicitacao_itens
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_material_label_batch_item_completeness();

CREATE TRIGGER etiqueta_solicitacoes_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.etiqueta_solicitacoes
FOR EACH ROW EXECUTE FUNCTION public.protect_material_label_batch_history();
CREATE TRIGGER etiqueta_solicitacao_itens_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.etiqueta_solicitacao_itens
FOR EACH ROW EXECUTE FUNCTION public.protect_material_label_batch_history();

CREATE OR REPLACE FUNCTION public.material_label_batch_json(
  _company_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT to_jsonb(request) || jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(to_jsonb(item) ORDER BY item.ordem, item.id)
      FROM public.etiqueta_solicitacao_itens AS item
      WHERE item.empresa_id = request.empresa_id
        AND item.solicitacao_id = request.id
    ), '[]'::jsonb),
    'material_id', CASE WHEN request.quantidade_materiais = 1 THEN (
      SELECT item.material_id FROM public.etiqueta_solicitacao_itens AS item
      WHERE item.empresa_id = request.empresa_id AND item.solicitacao_id = request.id
      ORDER BY item.ordem LIMIT 1
    ) ELSE NULL END,
    'quantidade', request.quantidade_etiquetas,
    'material_snapshot', CASE WHEN request.quantidade_materiais = 1 THEN (
      SELECT item.material_snapshot FROM public.etiqueta_solicitacao_itens AS item
      WHERE item.empresa_id = request.empresa_id AND item.solicitacao_id = request.id
      ORDER BY item.ordem LIMIT 1
    ) ELSE NULL END
  )
  FROM public.etiqueta_solicitacoes AS request
  WHERE request.empresa_id = _company_id AND request.id = _request_id
$$;

CREATE OR REPLACE FUNCTION public.registrar_solicitacao_impressao_lote_etiquetas(
  _modelo_id uuid,
  _itens jsonb,
  _client_uuid uuid,
  _expected_model_updated_at timestamptz DEFAULT NULL,
  _reimpressao_de_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_model public.etiqueta_modelos%ROWTYPE;
  v_actor_name text;
  v_input jsonb;
  v_snapshots jsonb;
  v_input_count integer;
  v_joined_count integer;
  v_total integer;
  v_hash text;
  v_existing public.etiqueta_solicitacoes%ROWTYPE;
  v_request public.etiqueta_solicitacoes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, true);
  IF _client_uuid IS NULL OR _itens IS NULL OR jsonb_typeof(_itens) <> 'array'
     OR jsonb_array_length(_itens) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Informe entre 1 e 100 materiais para o lote.';
  END IF;

  BEGIN
    WITH parsed AS (
      SELECT (entry.value->>'material_id')::uuid AS material_id,
        (entry.value->>'quantidade')::integer AS quantidade,
        entry.ordinality::integer AS ordem
      FROM jsonb_array_elements(_itens) WITH ORDINALITY AS entry(value, ordinality)
    )
    SELECT jsonb_agg(jsonb_build_object(
      'material_id', material_id, 'quantidade', quantidade, 'ordem', ordem
    ) ORDER BY ordem), count(*)::integer, sum(quantidade)::integer
    INTO v_input, v_input_count, v_total
    FROM parsed;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Material ou quantidade invalida no lote.';
  END;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_input) AS item
    WHERE (item->>'quantidade')::integer NOT BETWEEN 1 AND 500
  ) OR v_total NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Cada item aceita 1 a 500 etiquetas e o lote aceita ate 5000.';
  END IF;
  IF (SELECT count(DISTINCT item->>'material_id') FROM jsonb_array_elements(v_input) AS item) <> v_input_count THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Um material nao pode aparecer duas vezes no mesmo lote.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'modelo_id', _modelo_id, 'itens', v_input, 'reimpressao_de_id', _reimpressao_de_id
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || _client_uuid::text, 0));

  SELECT * INTO v_existing FROM public.etiqueta_solicitacoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'LB016', MESSAGE = 'A operacao foi repetida com dados diferentes.';
    END IF;
    RETURN public.material_label_batch_json(v_company_id, v_existing.id);
  END IF;

  SELECT * INTO v_model FROM public.etiqueta_modelos
  WHERE empresa_id = v_company_id AND id = _modelo_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Modelo ativo nao encontrado.'; END IF;
  IF _expected_model_updated_at IS NOT NULL AND v_model.updated_at <> _expected_model_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = 'LB015', MESSAGE = 'O modelo foi alterado em outra sessao.';
  END IF;
  IF _reimpressao_de_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.etiqueta_solicitacoes
    WHERE empresa_id = v_company_id AND id = _reimpressao_de_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Solicitacao original nao encontrada.';
  END IF;

  BEGIN
    WITH parsed AS (
      SELECT (entry.value->>'material_id')::uuid AS material_id,
        (entry.value->>'quantidade')::integer AS quantidade,
        nullif(entry.value->>'expected_updated_at', '')::timestamptz AS expected_updated_at,
        entry.ordinality::integer AS ordem
      FROM jsonb_array_elements(_itens) WITH ORDINALITY AS entry(value, ordinality)
    ), joined AS (
      SELECT input.ordem, input.quantidade AS etiquetas_quantidade, input.expected_updated_at,
        material.id AS material_id, material.nome, material.codigo_interno,
        material.marca, material.modelo, material.numero_serie, material.numero_patrimonio,
        material.localizacao, material.identificador_unico, material.conteudo_qr_code,
        material.codigo_barras, material.updated_at, category.nome AS categoria_nome, company.nome_empresa
      FROM parsed AS input
      JOIN public.materiais AS material
        ON material.empresa_id = v_company_id AND material.id = input.material_id AND material.ativo
      JOIN public.categorias_materiais AS category
        ON category.empresa_id = material.empresa_id AND category.id = material.categoria_id
      JOIN public.empresas AS company ON company.id = material.empresa_id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'ordem', ordem, 'material_id', material_id, 'quantidade', etiquetas_quantidade,
      'material_snapshot', jsonb_build_object(
        'id', material_id, 'nome', nome, 'codigo_interno', codigo_interno,
        'categoria', categoria_nome, 'marca', marca, 'modelo', modelo,
        'numero_serie', numero_serie, 'numero_patrimonio', numero_patrimonio,
        'localizacao', localizacao, 'empresa', nome_empresa,
        'identificador_unico', identificador_unico,
        'conteudo_qr_code', conteudo_qr_code, 'codigo_barras', codigo_barras
      )
    ) ORDER BY ordem), count(*)::integer
    INTO v_snapshots, v_joined_count
    FROM joined
    WHERE (expected_updated_at IS NULL OR updated_at = expected_updated_at)
      AND (v_model.tipo_identificacao = 'codigo_barras' OR conteudo_qr_code IS NOT NULL)
      AND (v_model.tipo_identificacao = 'qr_code' OR codigo_barras IS NOT NULL);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Versao de material invalida no lote.';
  END;

  IF v_joined_count <> v_input_count THEN
    RAISE EXCEPTION USING ERRCODE = 'LB017',
      MESSAGE = 'Um material nao pertence a empresa, foi alterado ou nao possui a identificacao exigida.';
  END IF;

  SELECT COALESCE(profile.full_name, auth.uid()::text) INTO v_actor_name
  FROM (SELECT auth.uid() AS user_id) AS actor
  LEFT JOIN public.profiles AS profile ON profile.user_id = actor.user_id;

  PERFORM set_config('backstage.material_label_batch_write', 'on', true);
  INSERT INTO public.etiqueta_solicitacoes (
    empresa_id, modelo_id, modelo_snapshot, quantidade_materiais,
    quantidade_etiquetas, solicitada_por, solicitante_nome, client_uuid,
    payload_hash, reimpressao_de_id
  ) VALUES (
    v_company_id, v_model.id, jsonb_build_object(
      'id', v_model.id, 'nome', v_model.nome, 'largura_mm', v_model.largura_mm,
      'altura_mm', v_model.altura_mm, 'tipo_identificacao', v_model.tipo_identificacao,
      'campos', v_model.campos, 'tamanho_fonte', v_model.tamanho_fonte,
      'mostrar_borda', v_model.mostrar_borda, 'margem_interna_mm', v_model.margem_interna_mm,
      'espacamento_interno_mm', v_model.espacamento_interno_mm, 'versao', v_model.versao
    ), v_input_count, v_total, auth.uid(),
    COALESCE(nullif(btrim(v_actor_name), ''), auth.uid()::text), _client_uuid,
    v_hash, _reimpressao_de_id
  ) RETURNING * INTO v_request;

  INSERT INTO public.etiqueta_solicitacao_itens (
    empresa_id, solicitacao_id, material_id, ordem, quantidade, material_snapshot
  )
  SELECT v_company_id, v_request.id, (item->>'material_id')::uuid,
    (item->>'ordem')::integer, (item->>'quantidade')::integer,
    item->'material_snapshot'
  FROM jsonb_array_elements(v_snapshots) AS item;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('etiquetas', 'lote_impressao_solicitado', 'Lote multi-material de etiquetas solicitado',
    auth.uid(), v_company_id, jsonb_build_object(
      'solicitacao_id', v_request.id, 'modelo_id', v_model.id,
      'quantidade_materiais', v_input_count, 'quantidade_etiquetas', v_total,
      'reimpressao_de_id', _reimpressao_de_id
    ));

  RETURN public.material_label_batch_json(v_company_id, v_request.id);
END;
$$;

-- Backward-compatible one-material facade delegates to the atomic batch.
CREATE OR REPLACE FUNCTION public.registrar_solicitacao_impressao_etiqueta(
  _modelo_id uuid,
  _material_id uuid,
  _quantidade integer,
  _client_uuid uuid,
  _reimpressao_de_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_result jsonb;
  v_model_type text;
  v_qr text;
  v_barcode text;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, true);
  SELECT model.tipo_identificacao, material.conteudo_qr_code, material.codigo_barras
  INTO v_model_type, v_qr, v_barcode
  FROM public.etiqueta_modelos AS model
  JOIN public.materiais AS material ON material.empresa_id = model.empresa_id
  WHERE model.empresa_id = v_company_id AND model.id = _modelo_id
    AND material.id = _material_id AND model.ativo AND material.ativo;
  IF FOUND AND v_model_type IN ('qr_code', 'ambos') AND v_qr IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LB012', MESSAGE = 'Gere o QR Code do material antes de imprimir.';
  END IF;
  IF FOUND AND v_model_type IN ('codigo_barras', 'ambos') AND v_barcode IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LB013', MESSAGE = 'Gere o codigo de barras do material antes de imprimir.';
  END IF;
  IF _reimpressao_de_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.etiqueta_impressoes
    WHERE empresa_id = v_company_id AND id = _reimpressao_de_id AND material_id = _material_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Impressao original nao encontrada para o material.';
  END IF;

  v_result := public.registrar_solicitacao_impressao_lote_etiquetas(
    _modelo_id,
    jsonb_build_array(jsonb_build_object('material_id', _material_id, 'quantidade', _quantidade)),
    _client_uuid, NULL, _reimpressao_de_id, _empresa_id
  );
  PERFORM set_config('backstage.material_labels_write', 'on', true);
  INSERT INTO public.etiqueta_impressoes (
    id, empresa_id, modelo_id, material_id, quantidade, modelo_snapshot, material_snapshot,
    solicitada_por, solicitante_nome, client_uuid, payload_hash, reimpressao_de_id, solicitada_em
  ) VALUES (
    (v_result->>'id')::uuid, v_company_id, _modelo_id, _material_id, _quantidade,
    v_result->'modelo_snapshot', v_result->'material_snapshot',
    (v_result->>'solicitada_por')::uuid, v_result->>'solicitante_nome', _client_uuid,
    v_result->>'payload_hash', _reimpressao_de_id, (v_result->>'solicitada_em')::timestamptz
  ) ON CONFLICT (empresa_id, client_uuid) DO NOTHING;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_solicitacao_impressao_etiqueta(
  _solicitacao_id uuid,
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
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  v_result := public.material_label_batch_json(v_company_id, _solicitacao_id);
  IF v_result IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Solicitacao nao encontrada.'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_historico_impressoes_etiqueta(
  _pagina integer DEFAULT 1,
  _por_pagina integer DEFAULT 20,
  _material_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE (item jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  IF COALESCE(_pagina, 0) < 1 OR COALESCE(_por_pagina, 0) < 1 OR _por_pagina > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Paginacao invalida.';
  END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT request.id, count(*) OVER() AS total
    FROM public.etiqueta_solicitacoes AS request
    WHERE request.empresa_id = v_company_id
      AND (_material_id IS NULL OR EXISTS (
        SELECT 1 FROM public.etiqueta_solicitacao_itens AS request_item
        WHERE request_item.empresa_id = request.empresa_id
          AND request_item.solicitacao_id = request.id
          AND request_item.material_id = _material_id
      ))
    ORDER BY request.solicitada_em DESC, request.id DESC
    OFFSET (_pagina - 1) * _por_pagina LIMIT _por_pagina
  )
  SELECT public.material_label_batch_json(v_company_id, filtered.id), filtered.total
  FROM filtered;
END;
$$;

CREATE OR REPLACE FUNCTION public.buscar_materiais_etiqueta(
  _busca text DEFAULT NULL,
  _limite integer DEFAULT 50,
  _empresa_id uuid DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', material.id, 'nome', material.nome, 'codigo_interno', material.codigo_interno,
    'categoria', category.nome, 'marca', material.marca, 'modelo', material.modelo,
    'numero_serie', material.numero_serie, 'numero_patrimonio', material.numero_patrimonio,
    'localizacao', material.localizacao, 'identificador_unico', material.identificador_unico,
    'tipo_identificacao', material.tipo_identificacao, 'status_identificacao', material.status_identificacao,
    'conteudo_qr_code', material.conteudo_qr_code, 'codigo_barras', material.codigo_barras,
    'ativo', material.ativo, 'updated_at', material.updated_at,
    'ultima_impressao_em', (SELECT max(request.solicitada_em)
      FROM public.etiqueta_solicitacao_itens AS item
      JOIN public.etiqueta_solicitacoes AS request
        ON request.empresa_id=item.empresa_id AND request.id=item.solicitacao_id
      WHERE item.empresa_id=material.empresa_id AND item.material_id=material.id),
    'total_impresso', (SELECT COALESCE(sum(item.quantidade),0)
      FROM public.etiqueta_solicitacao_itens AS item
      WHERE item.empresa_id=material.empresa_id AND item.material_id=material.id)
  )
  FROM public.materiais AS material
  JOIN public.categorias_materiais AS category
    ON category.empresa_id=material.empresa_id AND category.id=material.categoria_id
  WHERE material.empresa_id=v_company_id AND material.ativo
    AND (nullif(btrim(_busca),'') IS NULL
      OR material.nome ILIKE '%'||btrim(_busca)||'%'
      OR material.codigo_interno ILIKE '%'||btrim(_busca)||'%'
      OR COALESCE(material.codigo_barras,'')=btrim(_busca)
      OR material.identificador_unico::text=btrim(_busca)
      OR COALESCE(material.numero_serie,'') ILIKE '%'||btrim(_busca)||'%'
      OR COALESCE(material.numero_patrimonio,'') ILIKE '%'||btrim(_busca)||'%')
  ORDER BY material.nome,material.codigo_interno,material.id
  LIMIT greatest(1,least(COALESCE(_limite,50),100));
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_indicadores_etiquetas(_empresa_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  RETURN jsonb_build_object(
    'modelos_ativos', (SELECT count(*) FROM public.etiqueta_modelos WHERE empresa_id=v_company_id AND ativo),
    'materiais_identificados', (SELECT count(*) FROM public.materiais WHERE empresa_id=v_company_id AND ativo AND status_identificacao='ativa'),
    'solicitacoes_hoje', (SELECT count(*) FROM public.etiqueta_solicitacoes WHERE empresa_id=v_company_id AND solicitada_em>=CURRENT_DATE),
    'etiquetas_hoje', (SELECT COALESCE(sum(quantidade_etiquetas),0) FROM public.etiqueta_solicitacoes WHERE empresa_id=v_company_id AND solicitada_em>=CURRENT_DATE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_modelo_etiqueta_v2(
  _nome text,
  _largura_mm numeric,
  _altura_mm numeric,
  _tipo_identificacao text,
  _campos jsonb,
  _tamanho_fonte integer DEFAULT 10,
  _mostrar_borda boolean DEFAULT false,
  _margem_interna_mm numeric DEFAULT 1.50,
  _espacamento_interno_mm numeric DEFAULT 1.50,
  _descricao text DEFAULT NULL,
  _padrao boolean DEFAULT false,
  _modelo_id uuid DEFAULT NULL,
  _expected_updated_at timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_model jsonb; v_model_id uuid;
BEGIN
  IF COALESCE(_margem_interna_mm,-1) NOT BETWEEN 0 AND 10
     OR COALESCE(_espacamento_interno_mm,-1) NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION USING ERRCODE='LB004', MESSAGE='Margem e espacamento internos devem ficar entre 0 e 10 mm.';
  END IF;
  v_model := public.salvar_modelo_etiqueta(
    _nome,_largura_mm,_altura_mm,_tipo_identificacao,_campos,_tamanho_fonte,
    _mostrar_borda,_descricao,_padrao,_modelo_id,_expected_updated_at,_empresa_id
  );
  v_model_id := (v_model->>'id')::uuid;
  PERFORM set_config('backstage.material_labels_write','on',true);
  UPDATE public.etiqueta_modelos SET
    margem_interna_mm=_margem_interna_mm,
    espacamento_interno_mm=_espacamento_interno_mm,
    updated_at=clock_timestamp(), updated_by=auth.uid()
  WHERE id=v_model_id;
  RETURN (SELECT to_jsonb(model) FROM public.etiqueta_modelos AS model WHERE model.id=v_model_id);
END;
$$;

ALTER TABLE public.etiqueta_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etiqueta_solicitacao_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY etiqueta_solicitacoes_select ON public.etiqueta_solicitacoes
FOR SELECT TO authenticated USING (public.can_read_company_module(empresa_id,'etiquetas_materiais'));
CREATE POLICY etiqueta_solicitacao_itens_select ON public.etiqueta_solicitacao_itens
FOR SELECT TO authenticated USING (public.can_read_company_module(empresa_id,'etiquetas_materiais'));

REVOKE ALL ON public.etiqueta_solicitacoes,public.etiqueta_solicitacao_itens
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.etiqueta_solicitacoes,public.etiqueta_solicitacao_itens TO authenticated;

REVOKE ALL ON FUNCTION public.protect_material_label_batch_history() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.assert_material_label_batch_completeness(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.validate_material_label_batch_completeness() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.validate_material_label_batch_item_completeness() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.material_label_batch_json(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.registrar_solicitacao_impressao_lote_etiquetas(uuid,jsonb,uuid,timestamptz,uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.obter_solicitacao_impressao_etiqueta(uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.salvar_modelo_etiqueta_v2(text,numeric,numeric,text,jsonb,integer,boolean,numeric,numeric,text,boolean,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.registrar_solicitacao_impressao_lote_etiquetas(uuid,jsonb,uuid,timestamptz,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_solicitacao_impressao_etiqueta(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_modelo_etiqueta_v2(text,numeric,numeric,text,jsonb,integer,boolean,numeric,numeric,text,boolean,uuid,timestamptz,uuid) TO authenticated;

COMMENT ON TABLE public.etiqueta_solicitacoes IS
  'Immutable logical print requests. One request owns one to one hundred distinct material items.';
COMMENT ON TABLE public.etiqueta_solicitacao_itens IS
  'Immutable per-material quantities and canonical snapshots inside an atomic label print request.';
