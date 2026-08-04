-- Backstage Pro - Stage 6: material labels and printing.
-- Browser printing is auditable as a request, not as proof of physical output.

UPDATE public.module_catalog
SET nome = 'Etiquetas e Impressao',
    descricao = 'Modelos, pre-visualizacao, impressao e historico de etiquetas de materiais.',
    ativo = true,
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'planned')
      || jsonb_build_object('area', 'materiais', 'stage', 6, 'printing_audit', 'requested'),
    texto_venda = 'Crie e imprima etiquetas com QR Code e codigo de barras, mantendo historico por material.',
    updated_at = clock_timestamp()
WHERE feature_key = 'etiquetas_materiais';

CREATE TABLE public.etiqueta_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  largura_mm numeric(7, 2) NOT NULL,
  altura_mm numeric(7, 2) NOT NULL,
  tipo_identificacao public.material_identification_type NOT NULL DEFAULT 'qr_code',
  campos jsonb NOT NULL DEFAULT '["nome","codigo_interno"]'::jsonb,
  tamanho_fonte integer NOT NULL DEFAULT 10,
  mostrar_borda boolean NOT NULL DEFAULT false,
  padrao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  versao integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT etiqueta_modelos_nome_not_blank CHECK (btrim(nome) <> ''),
  CONSTRAINT etiqueta_modelos_dimensions CHECK (
    largura_mm BETWEEN 20 AND 210 AND altura_mm BETWEEN 10 AND 297
  ),
  CONSTRAINT etiqueta_modelos_font_size CHECK (tamanho_fonte BETWEEN 6 AND 24),
  CONSTRAINT etiqueta_modelos_version CHECK (versao > 0),
  CONSTRAINT etiqueta_modelos_fields_array CHECK (
    jsonb_typeof(campos) = 'array' AND jsonb_array_length(campos) BETWEEN 1 AND 8
  )
);

CREATE UNIQUE INDEX etiqueta_modelos_empresa_nome_uidx
  ON public.etiqueta_modelos (empresa_id, lower(btrim(nome)));
CREATE UNIQUE INDEX etiqueta_modelos_empresa_default_uidx
  ON public.etiqueta_modelos (empresa_id) WHERE padrao AND ativo;
CREATE UNIQUE INDEX etiqueta_modelos_empresa_id_uidx
  ON public.etiqueta_modelos (empresa_id, id);
CREATE INDEX etiqueta_modelos_empresa_ativo_idx
  ON public.etiqueta_modelos (empresa_id, ativo, nome);

CREATE TABLE public.etiqueta_impressoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modelo_id uuid,
  material_id uuid NOT NULL,
  quantidade integer NOT NULL,
  modelo_snapshot jsonb NOT NULL,
  material_snapshot jsonb NOT NULL,
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  solicitada_por uuid NOT NULL,
  solicitante_nome text NOT NULL,
  client_uuid uuid NOT NULL,
  payload_hash text NOT NULL,
  reimpressao_de_id uuid,
  CONSTRAINT etiqueta_impressoes_modelo_company_fk
    FOREIGN KEY (empresa_id, modelo_id)
    REFERENCES public.etiqueta_modelos (empresa_id, id) ON DELETE SET NULL,
  CONSTRAINT etiqueta_impressoes_material_company_fk
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT etiqueta_impressoes_reprint_company_fk
    FOREIGN KEY (empresa_id, reimpressao_de_id)
    REFERENCES public.etiqueta_impressoes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT etiqueta_impressoes_quantity CHECK (quantidade BETWEEN 1 AND 500),
  CONSTRAINT etiqueta_impressoes_actor_name CHECK (btrim(solicitante_nome) <> ''),
  CONSTRAINT etiqueta_impressoes_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT etiqueta_impressoes_snapshots CHECK (
    jsonb_typeof(modelo_snapshot) = 'object' AND jsonb_typeof(material_snapshot) = 'object'
  ),
  CONSTRAINT etiqueta_impressoes_not_self_reprint CHECK (reimpressao_de_id IS DISTINCT FROM id),
  CONSTRAINT etiqueta_impressoes_empresa_id_unique UNIQUE (empresa_id, id)
);

CREATE UNIQUE INDEX etiqueta_impressoes_empresa_client_uidx
  ON public.etiqueta_impressoes (empresa_id, client_uuid);
CREATE INDEX etiqueta_impressoes_empresa_date_idx
  ON public.etiqueta_impressoes (empresa_id, solicitada_em DESC, id DESC);
CREATE INDEX etiqueta_impressoes_material_date_idx
  ON public.etiqueta_impressoes (empresa_id, material_id, solicitada_em DESC);

CREATE OR REPLACE FUNCTION public.resolve_material_labels_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;
  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'LB011', MESSAGE = 'Selecione a empresa para operar etiquetas.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa invalida.';
    END IF;
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'etiquetas_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'LB009', MESSAGE = 'Etiquetas e Gestao de Materiais precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB010', MESSAGE = 'A empresa esta em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'etiquetas_materiais'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'etiquetas_materiais')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Voce nao tem permissao para esta operacao.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_material_label_fields(_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_field jsonb;
  v_value text;
  v_result jsonb := '[]'::jsonb;
  v_allowed constant text[] := ARRAY[
    'nome', 'codigo_interno', 'categoria', 'marca_modelo', 'numero_serie',
    'numero_patrimonio', 'localizacao', 'empresa'
  ];
BEGIN
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'array'
     OR jsonb_array_length(_fields) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Selecione entre 1 e 8 campos para a etiqueta.';
  END IF;
  FOR v_field IN SELECT value FROM jsonb_array_elements(_fields)
  LOOP
    IF jsonb_typeof(v_field) <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Campo de etiqueta invalido.';
    END IF;
    v_value := v_field #>> '{}';
    IF NOT (v_value = ANY(v_allowed)) THEN
      RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Campo de etiqueta nao permitido.';
    END IF;
    IF v_result @> jsonb_build_array(v_value) THEN
      RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Campos repetidos nao sao permitidos.';
    END IF;
    v_result := v_result || jsonb_build_array(v_value);
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_label_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('backstage.material_labels_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use as operacoes oficiais de etiquetas.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_label_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'LB014', MESSAGE = 'O historico de impressoes e imutavel.';
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_modelo_etiqueta(
  _nome text,
  _largura_mm numeric,
  _altura_mm numeric,
  _tipo_identificacao text,
  _campos jsonb,
  _tamanho_fonte integer DEFAULT 10,
  _mostrar_borda boolean DEFAULT false,
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
DECLARE
  v_company_id uuid;
  v_model public.etiqueta_modelos%ROWTYPE;
  v_identification public.material_identification_type;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, true);
  IF nullif(btrim(_nome), '') IS NULL OR length(btrim(_nome)) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Informe um nome com ate 80 caracteres.';
  END IF;
  BEGIN v_identification := _tipo_identificacao::public.material_identification_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Tipo de identificacao invalido.';
  END;
  _campos := public.validate_material_label_fields(_campos);
  PERFORM set_config('backstage.material_labels_write', 'on', true);
  IF _padrao THEN
    UPDATE public.etiqueta_modelos SET padrao = false, updated_at = clock_timestamp(), updated_by = auth.uid(), versao = versao + 1
    WHERE empresa_id = v_company_id AND padrao AND ativo AND (_modelo_id IS NULL OR id <> _modelo_id);
  END IF;
  IF _modelo_id IS NULL THEN
    INSERT INTO public.etiqueta_modelos (
      empresa_id, nome, descricao, largura_mm, altura_mm, tipo_identificacao,
      campos, tamanho_fonte, mostrar_borda, padrao, created_by, updated_by
    ) VALUES (
      v_company_id, btrim(_nome), nullif(btrim(_descricao), ''), _largura_mm, _altura_mm,
      v_identification, _campos, _tamanho_fonte, COALESCE(_mostrar_borda, false),
      COALESCE(_padrao, false), auth.uid(), auth.uid()
    ) RETURNING * INTO v_model;
  ELSE
    SELECT * INTO v_model FROM public.etiqueta_modelos
    WHERE empresa_id = v_company_id AND id = _modelo_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Modelo nao encontrado.'; END IF;
    IF _expected_updated_at IS NULL OR v_model.updated_at <> _expected_updated_at THEN
      RAISE EXCEPTION USING ERRCODE = 'LB015', MESSAGE = 'O modelo foi alterado em outra sessao.';
    END IF;
    UPDATE public.etiqueta_modelos SET
      nome = btrim(_nome), descricao = nullif(btrim(_descricao), ''),
      largura_mm = _largura_mm, altura_mm = _altura_mm,
      tipo_identificacao = v_identification, campos = _campos,
      tamanho_fonte = _tamanho_fonte, mostrar_borda = COALESCE(_mostrar_borda, false),
      padrao = COALESCE(_padrao, false), ativo = true, versao = versao + 1,
      updated_at = clock_timestamp(), updated_by = auth.uid()
    WHERE empresa_id = v_company_id AND id = _modelo_id RETURNING * INTO v_model;
  END IF;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('etiquetas', CASE WHEN _modelo_id IS NULL THEN 'modelo_criado' ELSE 'modelo_atualizado' END,
    'Modelo de etiqueta salvo', auth.uid(), v_company_id,
    jsonb_build_object('modelo_id', v_model.id, 'nome', v_model.nome, 'versao', v_model.versao));
  RETURN to_jsonb(v_model);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE = 'LB006', MESSAGE = 'Ja existe um modelo ativo com esse nome ou outro modelo padrao.';
END;
$$;

CREATE OR REPLACE FUNCTION public.inativar_modelo_etiqueta(
  _modelo_id uuid,
  _expected_updated_at timestamptz,
  _empresa_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid; v_changed integer;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, true);
  PERFORM set_config('backstage.material_labels_write', 'on', true);
  UPDATE public.etiqueta_modelos
  SET ativo = false, padrao = false, versao = versao + 1,
      updated_at = clock_timestamp(), updated_by = auth.uid()
  WHERE empresa_id = v_company_id AND id = _modelo_id AND ativo
    AND updated_at = _expected_updated_at;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.etiqueta_modelos WHERE empresa_id = v_company_id AND id = _modelo_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Modelo nao encontrado.';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'LB015', MESSAGE = 'O modelo foi alterado em outra sessao.';
  END IF;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('etiquetas', 'modelo_inativado', 'Modelo de etiqueta inativado', auth.uid(), v_company_id,
    jsonb_build_object('modelo_id', _modelo_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_modelos_etiqueta(_empresa_id uuid DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  RETURN QUERY SELECT to_jsonb(m) FROM public.etiqueta_modelos AS m
  WHERE m.empresa_id = v_company_id AND m.ativo
  ORDER BY m.padrao DESC, m.nome, m.id;
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
    'id', m.id, 'nome', m.nome, 'codigo_interno', m.codigo_interno,
    'categoria', c.nome, 'marca', m.marca, 'modelo', m.modelo,
    'numero_serie', m.numero_serie, 'numero_patrimonio', m.numero_patrimonio,
    'localizacao', m.localizacao, 'identificador_unico', m.identificador_unico,
    'tipo_identificacao', m.tipo_identificacao, 'status_identificacao', m.status_identificacao,
    'conteudo_qr_code', m.conteudo_qr_code, 'codigo_barras', m.codigo_barras,
    'ativo', m.ativo,
    'ultima_impressao_em', (SELECT max(i.solicitada_em) FROM public.etiqueta_impressoes AS i
      WHERE i.empresa_id = m.empresa_id AND i.material_id = m.id),
    'total_impresso', (SELECT COALESCE(sum(i.quantidade), 0) FROM public.etiqueta_impressoes AS i
      WHERE i.empresa_id = m.empresa_id AND i.material_id = m.id)
  )
  FROM public.materiais AS m
  JOIN public.categorias_materiais AS c ON c.empresa_id = m.empresa_id AND c.id = m.categoria_id
  WHERE m.empresa_id = v_company_id AND m.ativo
    AND (nullif(btrim(_busca), '') IS NULL
      OR m.nome ILIKE '%' || btrim(_busca) || '%'
      OR m.codigo_interno ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(m.codigo_barras, '') = btrim(_busca)
      OR m.identificador_unico::text = btrim(_busca)
      OR COALESCE(m.numero_serie, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(m.numero_patrimonio, '') ILIKE '%' || btrim(_busca) || '%')
  ORDER BY m.nome, m.codigo_interno, m.id
  LIMIT greatest(1, least(COALESCE(_limite, 50), 100));
END;
$$;

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
  v_model public.etiqueta_modelos%ROWTYPE;
  v_material record;
  v_actor_name text;
  v_model_snapshot jsonb;
  v_material_snapshot jsonb;
  v_hash text;
  v_print public.etiqueta_impressoes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_labels_company(_empresa_id, true);
  IF _client_uuid IS NULL OR COALESCE(_quantidade, 0) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'LB004', MESSAGE = 'Quantidade ou identificador da operacao invalido.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || _client_uuid::text, 0));
  SELECT * INTO v_model FROM public.etiqueta_modelos
  WHERE empresa_id = v_company_id AND id = _modelo_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Modelo ativo nao encontrado.'; END IF;
  SELECT m.*, c.nome AS categoria_nome, e.nome_empresa
  INTO v_material
  FROM public.materiais AS m
  JOIN public.categorias_materiais AS c ON c.empresa_id = m.empresa_id AND c.id = m.categoria_id
  JOIN public.empresas AS e ON e.id = m.empresa_id
  WHERE m.empresa_id = v_company_id AND m.id = _material_id AND m.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Material ativo nao encontrado.'; END IF;
  IF v_model.tipo_identificacao IN ('qr_code', 'ambos') AND v_material.conteudo_qr_code IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LB012', MESSAGE = 'Gere o QR Code do material antes de imprimir.';
  END IF;
  IF v_model.tipo_identificacao IN ('codigo_barras', 'ambos') AND v_material.codigo_barras IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LB013', MESSAGE = 'Gere o codigo de barras do material antes de imprimir.';
  END IF;
  IF _reimpressao_de_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.etiqueta_impressoes
    WHERE empresa_id = v_company_id AND id = _reimpressao_de_id AND material_id = _material_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB005', MESSAGE = 'Impressao original nao encontrada para o material.';
  END IF;
  SELECT COALESCE(p.full_name, auth.uid()::text) INTO v_actor_name
  FROM (SELECT auth.uid() AS user_id) AS actor
  LEFT JOIN public.profiles AS p ON p.user_id = actor.user_id;
  v_model_snapshot := jsonb_build_object(
    'id', v_model.id, 'nome', v_model.nome, 'largura_mm', v_model.largura_mm,
    'altura_mm', v_model.altura_mm, 'tipo_identificacao', v_model.tipo_identificacao,
    'campos', v_model.campos, 'tamanho_fonte', v_model.tamanho_fonte,
    'mostrar_borda', v_model.mostrar_borda, 'versao', v_model.versao
  );
  v_material_snapshot := jsonb_build_object(
    'id', v_material.id, 'nome', v_material.nome, 'codigo_interno', v_material.codigo_interno,
    'categoria', v_material.categoria_nome, 'marca', v_material.marca, 'modelo', v_material.modelo,
    'numero_serie', v_material.numero_serie, 'numero_patrimonio', v_material.numero_patrimonio,
    'localizacao', v_material.localizacao, 'empresa', v_material.nome_empresa,
    'identificador_unico', v_material.identificador_unico,
    'conteudo_qr_code', v_material.conteudo_qr_code, 'codigo_barras', v_material.codigo_barras
  );
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'modelo_id', _modelo_id, 'material_id', _material_id, 'quantidade', _quantidade,
    'reimpressao_de_id', _reimpressao_de_id, 'modelo', v_model_snapshot, 'material', v_material_snapshot
  )::text, 'UTF8')), 'hex');
  SELECT * INTO v_print FROM public.etiqueta_impressoes
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_print.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'LB016', MESSAGE = 'A operacao foi repetida com dados diferentes.';
    END IF;
    RETURN to_jsonb(v_print);
  END IF;
  PERFORM set_config('backstage.material_labels_write', 'on', true);
  INSERT INTO public.etiqueta_impressoes (
    empresa_id, modelo_id, material_id, quantidade, modelo_snapshot, material_snapshot,
    solicitada_por, solicitante_nome, client_uuid, payload_hash, reimpressao_de_id
  ) VALUES (
    v_company_id, _modelo_id, _material_id, _quantidade, v_model_snapshot, v_material_snapshot,
    auth.uid(), COALESCE(nullif(btrim(v_actor_name), ''), auth.uid()::text), _client_uuid, v_hash, _reimpressao_de_id
  ) RETURNING * INTO v_print;
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('etiquetas', 'impressao_solicitada', 'Impressao de etiquetas solicitada', auth.uid(), v_company_id,
    jsonb_build_object('impressao_id', v_print.id, 'modelo_id', _modelo_id,
      'material_id', _material_id, 'quantidade', _quantidade, 'reimpressao_de_id', _reimpressao_de_id));
  RETURN to_jsonb(v_print);
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
    SELECT i.*, count(*) OVER() AS total
    FROM public.etiqueta_impressoes AS i
    WHERE i.empresa_id = v_company_id AND (_material_id IS NULL OR i.material_id = _material_id)
    ORDER BY i.solicitada_em DESC, i.id DESC
    OFFSET (_pagina - 1) * _por_pagina LIMIT _por_pagina
  )
  SELECT jsonb_build_object(
    'id', f.id, 'modelo_id', f.modelo_id, 'material_id', f.material_id,
    'quantidade', f.quantidade, 'modelo_snapshot', f.modelo_snapshot,
    'material_snapshot', f.material_snapshot, 'solicitada_em', f.solicitada_em,
    'solicitante_nome', f.solicitante_nome, 'reimpressao_de_id', f.reimpressao_de_id
  ), f.total FROM filtered AS f;
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
    'modelos_ativos', (SELECT count(*) FROM public.etiqueta_modelos WHERE empresa_id = v_company_id AND ativo),
    'materiais_identificados', (SELECT count(*) FROM public.materiais WHERE empresa_id = v_company_id AND ativo AND status_identificacao = 'ativa'),
    'solicitacoes_hoje', (SELECT count(*) FROM public.etiqueta_impressoes WHERE empresa_id = v_company_id AND solicitada_em >= CURRENT_DATE),
    'etiquetas_hoje', (SELECT COALESCE(sum(quantidade), 0) FROM public.etiqueta_impressoes WHERE empresa_id = v_company_id AND solicitada_em >= CURRENT_DATE)
  );
END;
$$;

ALTER TABLE public.etiqueta_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etiqueta_impressoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY etiqueta_modelos_select ON public.etiqueta_modelos
FOR SELECT TO authenticated USING (public.can_read_company_module(empresa_id, 'etiquetas_materiais'));
CREATE POLICY etiqueta_impressoes_select ON public.etiqueta_impressoes
FOR SELECT TO authenticated USING (public.can_read_company_module(empresa_id, 'etiquetas_materiais'));

CREATE TRIGGER etiqueta_modelos_projection_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.etiqueta_modelos
FOR EACH ROW EXECUTE FUNCTION public.protect_material_label_projection();
CREATE TRIGGER etiqueta_impressoes_projection_guard
BEFORE INSERT ON public.etiqueta_impressoes
FOR EACH ROW EXECUTE FUNCTION public.protect_material_label_projection();
CREATE TRIGGER etiqueta_impressoes_history_guard
BEFORE UPDATE OR DELETE ON public.etiqueta_impressoes
FOR EACH ROW EXECUTE FUNCTION public.protect_material_label_history();

REVOKE ALL ON public.etiqueta_modelos, public.etiqueta_impressoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.etiqueta_modelos, public.etiqueta_impressoes TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_material_labels_company(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_material_label_fields(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_material_label_projection() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_material_label_history() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.salvar_modelo_etiqueta(text,numeric,numeric,text,jsonb,integer,boolean,text,boolean,uuid,timestamptz,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.inativar_modelo_etiqueta(uuid,timestamptz,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_modelos_etiqueta(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.buscar_materiais_etiqueta(text,integer,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_solicitacao_impressao_etiqueta(uuid,uuid,integer,uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_historico_impressoes_etiqueta(integer,integer,uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_indicadores_etiquetas(uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.salvar_modelo_etiqueta(text,numeric,numeric,text,jsonb,integer,boolean,text,boolean,uuid,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inativar_modelo_etiqueta(uuid,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_modelos_etiqueta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_materiais_etiqueta(text,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_solicitacao_impressao_etiqueta(uuid,uuid,integer,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_historico_impressoes_etiqueta(integer,integer,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_indicadores_etiquetas(uuid) TO authenticated;

COMMENT ON TABLE public.etiqueta_modelos IS
  'Versioned company label layouts. Print history stores a complete immutable snapshot.';
COMMENT ON TABLE public.etiqueta_impressoes IS
  'Append-only browser print requests. A row does not claim that physical output was completed.';
