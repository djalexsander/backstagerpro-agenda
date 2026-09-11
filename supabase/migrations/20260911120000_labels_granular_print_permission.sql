-- Backstage Pro - Etiquetas: a solicitacao de impressao (unica acao
-- operacional deste modulo, em oposicao a gerenciar modelos - uma
-- configuracao) passa a aceitar o "usuario" comum com o grant granular de
-- 'etiquetas_materiais' (user_module_permissions), mirando exatamente o
-- padrao ja usado por Locacao para retirada/devolucao
-- (20260902120000_scanner_remoto_locacao_granular_permissions.sql):
-- resolve_material_labels_company continua INALTERADA (ainda admin-only via
-- can_write_company_module) porque suas outras RPCs de escrita
-- (salvar_modelo_etiqueta/salvar_modelo_etiqueta_v2/inativar_modelo_etiqueta)
-- gerenciam MODELOS de etiqueta - uma configuracao da empresa, nao uma acao
-- operacional que um "usuario" deveria fazer. Apenas
-- registrar_solicitacao_impressao_lote_etiquetas ganha o gate granular
-- inline (resolve em modo leitura + gate de escrita reaplicado com o
-- caminho granular). registrar_solicitacao_impressao_etiqueta (versao de um
-- material so) delega inteiramente para esta funcao - nenhuma mudanca
-- adicional necessaria ali.
--
-- View permanece inalterada: can_read_company_module nao tem gate de papel.

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
  -- E5.1-style gate (mirrors 20260902120000_scanner_remoto_locacao_granular_permissions.sql):
  -- resolve in READ mode (tenant/module/dependencies, unchanged), then reapply
  -- the write gate accepting the granular etiquetas_materiais 'create' grant.
  -- salvar_modelo_etiqueta(_v2)/inativar_modelo_etiqueta stay admin-only via
  -- resolve_material_labels_company(_, true) unchanged - template management is
  -- a company-configuration concern, not the day-to-day 'imprimir' action.
  v_company_id := public.resolve_material_labels_company(_empresa_id, false);
  IF NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB010',
      MESSAGE = 'A empresa esta em modo somente leitura.';
  END IF;
  IF NOT (
    public.can_write_company_module(v_company_id, 'etiquetas_materiais')
    OR public.user_has_module_action(v_company_id, 'etiquetas_materiais', 'create')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Voce nao tem permissao para solicitar impressao de etiquetas.';
  END IF;
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

COMMENT ON FUNCTION public.registrar_solicitacao_impressao_lote_etiquetas(uuid, jsonb, uuid, timestamptz, uuid, uuid) IS
  'Registers a multi-material label print batch. Permission: admin_empresa/master OR usuario com grant granular etiquetas_materiais.create. Template management (salvar/inativar_modelo_etiqueta) stays admin-only via resolve_material_labels_company, unchanged.';
