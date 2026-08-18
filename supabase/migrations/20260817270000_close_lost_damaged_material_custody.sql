-- P1-7: encerra custodia perdida/avariada sem simular devolucao fisica.

ALTER TABLE public.material_custodias
  ADD COLUMN quantidade_baixada integer NOT NULL DEFAULT 0;

ALTER TABLE public.material_custodias
  DROP CONSTRAINT material_custodias_devolucao_range,
  DROP CONSTRAINT material_custodias_status_shape;

ALTER TABLE public.material_custodias
  ADD CONSTRAINT material_custodias_quantidades_contabilizadas_range CHECK (
    quantidade_devolvida >= 0
    AND quantidade_baixada >= 0
    AND quantidade_devolvida + quantidade_baixada <= quantidade_retirada
  ),
  ADD CONSTRAINT material_custodias_status_shape CHECK (
    (status = 'aberta' AND quantidade_devolvida = 0 AND quantidade_baixada = 0 AND encerrada_em IS NULL)
    OR (status = 'parcial' AND quantidade_devolvida + quantidade_baixada > 0
        AND quantidade_devolvida + quantidade_baixada < quantidade_retirada AND encerrada_em IS NULL)
    OR (status = 'concluida' AND quantidade_devolvida + quantidade_baixada = quantidade_retirada
        AND encerrada_em IS NOT NULL)
    OR (status = 'cancelada' AND quantidade_devolvida = 0 AND quantidade_baixada = 0
        AND encerrada_em IS NOT NULL)
  );

ALTER TABLE public.material_custodia_eventos
  ALTER COLUMN movimento_estoque_id DROP NOT NULL,
  ADD COLUMN status_operacional_resultante public.material_operational_status;

ALTER TABLE public.material_custodia_eventos
  DROP CONSTRAINT material_custodia_eventos_location_shape;

ALTER TABLE public.material_custodia_eventos
  ADD CONSTRAINT material_custodia_eventos_location_shape CHECK (
    (tipo = 'checkout' AND localizacao_origem_id IS NOT NULL AND localizacao_destino_id IS NULL)
    OR (tipo = 'checkin' AND localizacao_origem_id IS NULL AND localizacao_destino_id IS NOT NULL)
    OR (tipo = 'cancelamento' AND (localizacao_origem_id IS NOT NULL OR localizacao_destino_id IS NOT NULL))
    OR (tipo = 'correcao' AND localizacao_origem_id IS NULL AND localizacao_destino_id IS NULL)
  ),
  ADD CONSTRAINT material_custodia_eventos_movement_shape CHECK (
    (tipo = 'correcao' AND movimento_estoque_id IS NULL)
    OR (tipo <> 'correcao' AND movimento_estoque_id IS NOT NULL)
  ),
  ADD CONSTRAINT material_custodia_eventos_correction_status_shape CHECK (
    (tipo = 'correcao' AND status_operacional_resultante IN ('extraviado', 'avariado', 'baixado'))
    OR (tipo <> 'correcao' AND status_operacional_resultante IS NULL)
  );

ALTER TYPE public.material_rental_event_type ADD VALUE IF NOT EXISTS 'correcao';

CREATE OR REPLACE FUNCTION public.material_rental_item_operational_totals(_item_id uuid)
RETURNS TABLE (retirada bigint, devolvida bigint, com_cliente bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE(sum(c.quantidade_retirada) FILTER (WHERE c.status <> 'cancelada'), 0)::bigint,
    COALESCE(sum(c.quantidade_devolvida) FILTER (WHERE c.status <> 'cancelada'), 0)::bigint,
    COALESCE(sum(c.quantidade_retirada - c.quantidade_devolvida - c.quantidade_baixada)
      FILTER (WHERE c.status IN ('aberta', 'parcial')), 0)::bigint
  FROM public.material_custodias AS c
  WHERE c.referencia_tipo = 'locacao_item' AND c.referencia_id = _item_id
$$;

CREATE OR REPLACE FUNCTION public.sync_material_rental_status(_company_id uuid, _locacao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rental public.material_locacoes%ROWTYPE;
  v_pending bigint;
  v_returned bigint;
  v_written_off bigint;
  v_all_delivered boolean;
  v_new_status public.material_rental_status;
BEGIN
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = _company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND OR v_rental.status NOT IN ('em_andamento', 'parcialmente_devolvida') THEN RETURN; END IF;

  SELECT COALESCE(sum(operational.com_cliente), 0),
         COALESCE(sum(operational.devolvida), 0),
         COALESCE(sum(operational.retirada - operational.devolvida - operational.com_cliente), 0),
         COALESCE(bool_and(operational.retirada >= item.quantidade_contratada), false)
  INTO v_pending, v_returned, v_written_off, v_all_delivered
  FROM public.material_locacao_itens AS item
  CROSS JOIN LATERAL public.material_rental_item_operational_totals(item.id) AS operational
  WHERE item.empresa_id = _company_id AND item.locacao_id = _locacao_id;

  IF v_pending = 0 AND v_all_delivered THEN v_new_status := 'concluida';
  ELSIF v_pending > 0 AND (v_returned > 0 OR v_written_off > 0) THEN v_new_status := 'parcialmente_devolvida';
  ELSE v_new_status := 'em_andamento'; END IF;
  IF v_new_status = v_rental.status THEN RETURN; END IF;

  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = v_new_status,
      encerrada_em = CASE WHEN v_new_status = 'concluida' THEN clock_timestamp() ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE empresa_id = _company_id AND id = _locacao_id;

  IF v_new_status = 'concluida' THEN
    INSERT INTO public.material_locacao_eventos (
      empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash, dados
    ) VALUES (
      _company_id, _locacao_id, 'conclusao',
      CASE WHEN v_written_off > 0 THEN 'Locacao concluida apos devolucao e/ou baixa de custodia'
           ELSE 'Locacao concluida apos devolucao integral' END,
      auth.uid(), gen_random_uuid(), encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
      jsonb_build_object('devolvida_total', v_returned, 'baixada_total', v_written_off)
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_baixa_custodia_material(
  _custodia_id uuid,
  _quantidade integer,
  _classificacao text,
  _justificativa text,
  _client_uuid uuid,
  _observacao text DEFAULT NULL,
  _data_efetiva timestamptz DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS public.material_custodias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_custody public.material_custodias%ROWTYPE;
  v_result public.material_custodias%ROWTYPE;
  v_existing public.material_custodia_eventos%ROWTYPE;
  v_material public.materiais%ROWTYPE;
  v_status public.material_operational_status;
  v_hash text;
  v_pending integer;
  v_new_written_off integer;
  v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp());
  v_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF _custodia_id IS NULL OR _client_uuid IS NULL OR nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Custodia, justificativa e identificador sao obrigatorios.';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Informe uma quantidade baixada maior que zero.';
  END IF;
  BEGIN v_status := _classificacao::public.material_operational_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Classificacao de baixa invalida.';
  END;
  IF v_status NOT IN ('extraviado', 'avariado', 'baixado') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Classificacao de baixa invalida.';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'custodia', _custodia_id, 'quantidade', _quantidade, 'classificacao', v_status,
    'justificativa', btrim(_justificativa), 'observacao', nullif(btrim(_observacao), ''),
    'data', _data_efetiva
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text, 0));

  SELECT * INTO v_existing FROM public.material_custodia_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing.tipo <> 'correcao' OR v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CI013', MESSAGE = 'Esta operacao ja foi enviada com dados diferentes.';
    END IF;
    SELECT * INTO v_result FROM public.material_custodias
    WHERE empresa_id = v_company_id AND id = v_existing.custodia_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_custody FROM public.material_custodias
  WHERE empresa_id = v_company_id AND id = _custodia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'CI005', MESSAGE = 'Operacao de custodia nao encontrada.';
  END IF;
  IF v_custody.status NOT IN ('aberta', 'parcial') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI014', MESSAGE = 'Esta operacao nao possui quantidade pendente.';
  END IF;
  v_pending := v_custody.quantidade_retirada - v_custody.quantidade_devolvida - v_custody.quantidade_baixada;
  IF _quantidade > v_pending THEN
    RAISE EXCEPTION USING ERRCODE = 'CI021', MESSAGE = 'A quantidade baixada supera a quantidade ainda em custodia.';
  END IF;
  IF v_custody.tipo_controle = 'individual' AND _quantidade <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'CI002', MESSAGE = 'Material individual deve usar quantidade um.';
  END IF;

  SELECT * INTO v_material FROM public.materiais
  WHERE empresa_id = v_company_id AND id = v_custody.material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'CI005', MESSAGE = 'Material nao encontrado.'; END IF;

  v_new_written_off := v_custody.quantidade_baixada + _quantidade;
  PERFORM set_config('backstage.custody_projection_write', 'on', true);
  UPDATE public.material_custodias
  SET quantidade_baixada = v_new_written_off,
      status = CASE WHEN quantidade_devolvida + v_new_written_off = quantidade_retirada
        THEN 'concluida'::public.material_custody_status ELSE 'parcial'::public.material_custody_status END,
      encerrada_em = CASE WHEN quantidade_devolvida + v_new_written_off = quantidade_retirada THEN v_effective_at ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = v_custody.id RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write', 'off', true);

  IF v_material.tipo_controle = 'individual' THEN
    UPDATE public.materiais SET status_operacional = v_status,
      justificativa_status = btrim(_justificativa), updated_at = clock_timestamp()
    WHERE empresa_id = v_company_id AND id = v_material.id;
  END IF;

  INSERT INTO public.material_custodia_eventos (
    empresa_id, custodia_id, material_id, tipo, quantidade, condicao,
    observacao, justificativa, data_efetiva, executado_por,
    movimento_estoque_id, status_operacional_resultante, client_uuid, payload_hash
  ) VALUES (
    v_company_id, v_custody.id, v_custody.material_id, 'correcao', _quantidade,
    CASE WHEN v_status = 'avariado' THEN 'danificado'::public.material_custody_condition ELSE NULL END,
    nullif(btrim(_observacao), ''), btrim(_justificativa), v_effective_at, auth.uid(),
    NULL, v_status, _client_uuid, v_hash
  );

  INSERT INTO public.system_logs(tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('custodia', 'material_custodia_baixa', 'Baixa definitiva de custodia registrada', auth.uid(), v_company_id,
    jsonb_build_object('custodia_id', v_result.id, 'material_id', v_result.material_id,
      'quantidade', _quantidade, 'classificacao', v_status, 'justificativa', btrim(_justificativa)));

  IF v_result.referencia_tipo = 'locacao_item' THEN
    SELECT locacao_id INTO v_rental_id FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND id = v_result.referencia_id;
    IF v_rental_id IS NOT NULL THEN
      INSERT INTO public.material_locacao_eventos(
        empresa_id, locacao_id, item_id, custodia_id, tipo, descricao, dados,
        executado_por, data_efetiva, client_uuid, payload_hash
      ) VALUES (
        v_company_id, v_rental_id, v_result.referencia_id, v_result.id, 'correcao',
        'Baixa de custodia: ' || btrim(_justificativa),
        jsonb_build_object('quantidade', _quantidade, 'classificacao', v_status, 'justificativa', btrim(_justificativa)),
        auth.uid(), v_effective_at, _client_uuid, v_hash
      );
      PERFORM public.sync_material_rental_status(v_company_id, v_rental_id);
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- Check-in posterior a uma baixa parcial considera somente a quantidade ainda pendente.
CREATE OR REPLACE FUNCTION public.registrar_checkin_material(_custodia_id uuid, _quantidade integer, _localizacao_destino_id uuid, _condicao_retorno text, _client_uuid uuid, _observacao text DEFAULT NULL::text, _ocorrencia text DEFAULT NULL::text, _data_efetiva timestamp with time zone DEFAULT NULL::timestamp with time zone, _empresa_id uuid DEFAULT NULL::uuid)
RETURNS material_custodias LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_company_id uuid; v_custody public.material_custodias%ROWTYPE; v_result public.material_custodias%ROWTYPE;
  v_existing_event public.material_custodia_eventos%ROWTYPE; v_movement public.estoque_movimentacoes%ROWTYPE;
  v_condition public.material_custody_condition; v_hash text; v_stock_hash text; v_pending integer;
  v_new_returned integer; v_effective_at timestamptz := COALESCE(_data_efetiva, clock_timestamp()); v_rental_id uuid;
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, true);
  IF _custodia_id IS NULL OR _localizacao_destino_id IS NULL OR _client_uuid IS NULL THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Operacao, localizacao de retorno e identificador sao obrigatorios.'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Informe uma quantidade devolvida maior que zero.'; END IF;
  BEGIN v_condition := _condicao_retorno::public.material_custody_condition; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Condicao de retorno invalida.'; END;
  IF v_condition IS NULL THEN RAISE EXCEPTION USING ERRCODE='CI004', MESSAGE='Informe a condicao de retorno.'; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('custodia',_custodia_id,'quantidade',_quantidade,'destino',_localizacao_destino_id,'condicao',v_condition,'observacao',nullif(btrim(_observacao),''),'ocorrencia',nullif(btrim(_ocorrencia),''),'data',_data_efetiva)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':custody:' || _client_uuid::text,0));
  SELECT * INTO v_existing_event FROM public.material_custodia_eventos WHERE empresa_id=v_company_id AND client_uuid=_client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash<>v_hash OR v_existing_event.tipo<>'checkin' THEN RAISE EXCEPTION USING ERRCODE='CI013', MESSAGE='Esta operacao ja foi enviada com dados diferentes.'; END IF;
    SELECT * INTO v_result FROM public.material_custodias WHERE empresa_id=v_company_id AND id=v_existing_event.custodia_id; RETURN v_result;
  END IF;
  SELECT * INTO v_custody FROM public.material_custodias WHERE empresa_id=v_company_id AND id=_custodia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='CI005', MESSAGE='Operacao de custodia nao encontrada.'; END IF;
  IF v_custody.status NOT IN ('aberta','parcial') THEN RAISE EXCEPTION USING ERRCODE='CI014', MESSAGE='Esta operacao nao possui quantidade pendente para retorno.'; END IF;
  v_pending := v_custody.quantidade_retirada-v_custody.quantidade_devolvida-v_custody.quantidade_baixada;
  IF _quantidade>v_pending THEN RAISE EXCEPTION USING ERRCODE='CI001', MESSAGE='A quantidade devolvida supera a quantidade ainda em custodia.'; END IF;
  IF v_custody.tipo_controle='individual' AND _quantidade<>1 THEN RAISE EXCEPTION USING ERRCODE='CI002', MESSAGE='Material individual deve retornar com quantidade um.'; END IF;
  v_stock_hash := encode(sha256(convert_to(jsonb_build_object('custodia',v_custody.id,'material',v_custody.material_id,'quantidade',_quantidade,'destino',_localizacao_destino_id,'data',_data_efetiva,'operacao','checkin')::text,'UTF8')),'hex');
  v_movement := public.apply_stock_movement(v_company_id,v_custody.material_id,'entrada',_quantidade,NULL,_localizacao_destino_id,'Check-in de material',NULL,_observacao,NULL,_data_efetiva,'checkin_checkout',v_custody.id,_client_uuid,v_stock_hash,NULL);
  v_new_returned := v_custody.quantidade_devolvida+_quantidade;
  PERFORM set_config('backstage.custody_projection_write','on',true);
  UPDATE public.material_custodias SET quantidade_devolvida=v_new_returned,
    status=CASE WHEN v_new_returned+quantidade_baixada=quantidade_retirada THEN 'concluida'::public.material_custody_status ELSE 'parcial'::public.material_custody_status END,
    encerrada_em=CASE WHEN v_new_returned+quantidade_baixada=quantidade_retirada THEN v_effective_at ELSE NULL END, updated_at=clock_timestamp()
  WHERE empresa_id=v_company_id AND id=v_custody.id RETURNING * INTO v_result;
  PERFORM set_config('backstage.custody_projection_write','off',true);
  INSERT INTO public.material_custodia_eventos(empresa_id,custodia_id,material_id,tipo,quantidade,localizacao_destino_id,condicao,ocorrencia,observacao,data_efetiva,executado_por,movimento_estoque_id,client_uuid,payload_hash)
  VALUES(v_company_id,v_custody.id,v_custody.material_id,'checkin',_quantidade,_localizacao_destino_id,v_condition,nullif(btrim(_ocorrencia),''),nullif(btrim(_observacao),''),v_effective_at,auth.uid(),v_movement.id,_client_uuid,v_hash);
  INSERT INTO public.system_logs(tipo,acao,descricao,user_id,empresa_id,dados) VALUES('custodia',CASE WHEN v_result.status='concluida' THEN 'material_checkin_total' ELSE 'material_checkin_parcial' END,CASE WHEN v_result.status='concluida' THEN 'Retorno total de material registrado' ELSE 'Retorno parcial de material registrado' END,auth.uid(),v_company_id,jsonb_build_object('custodia_id',v_result.id,'material_id',v_result.material_id,'quantidade',_quantidade,'condicao',v_condition,'ocorrencia',nullif(btrim(_ocorrencia),''),'movimento_estoque_id',v_movement.id));
  IF v_result.referencia_tipo='locacao_item' THEN SELECT locacao_id INTO v_rental_id FROM public.material_locacao_itens WHERE empresa_id=v_company_id AND id=v_result.referencia_id; IF v_rental_id IS NOT NULL THEN PERFORM public.sync_material_rental_status(v_company_id,v_rental_id); END IF; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.buscar_materiais_custodia(_busca text, _empresa_id uuid DEFAULT NULL, _limite integer DEFAULT 12)
RETURNS TABLE(item jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company_id uuid; v_search text:=btrim(COALESCE(_busca,''));
BEGIN
 v_company_id:=public.resolve_custody_company(_empresa_id,false); IF v_search='' THEN RETURN; END IF;
 RETURN QUERY SELECT jsonb_build_object(
  'id',material.id,'nome',material.nome,'codigo_interno',material.codigo_interno,
  'identificador_unico',material.identificador_unico,'codigo_barras',material.codigo_barras,
  'conteudo_qr_code',material.conteudo_qr_code,'numero_patrimonio',material.numero_patrimonio,
  'numero_serie',material.numero_serie,'tipo_controle',material.tipo_controle,
  'status_operacional',material.status_operacional,'ativo',material.ativo,
  'unidade_medida',material.unidade_medida,
  'foto_path',(SELECT photo.storage_path FROM public.materiais_fotos photo WHERE photo.empresa_id=material.empresa_id AND photo.material_id=material.id ORDER BY photo.foto_principal DESC,photo.created_at,photo.id LIMIT 1),
  'saldos',COALESCE((SELECT jsonb_agg(jsonb_build_object('localizacao_id',balance.localizacao_id,'localizacao_codigo',location.codigo,'localizacao_nome',location.nome,'localizacao_ativa',location.ativa,'quantidade',balance.quantidade) ORDER BY location.nome) FROM public.estoque_saldos balance JOIN public.estoque_localizacoes location ON location.empresa_id=balance.empresa_id AND location.id=balance.localizacao_id WHERE balance.empresa_id=material.empresa_id AND balance.material_id=material.id AND balance.quantidade>0),'[]'::jsonb),
  'custodias_abertas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',custody.id,'quantidade_retirada',custody.quantidade_retirada,'quantidade_devolvida',custody.quantidade_devolvida,'quantidade_baixada',custody.quantidade_baixada,'quantidade_pendente',custody.quantidade_retirada-custody.quantidade_devolvida-custody.quantidade_baixada,'responsavel_nome',custody.responsavel_nome,'retirada_em',custody.retirada_em,'previsao_retorno',custody.previsao_retorno,'status',custody.status) ORDER BY custody.retirada_em) FROM public.material_custodias custody WHERE custody.empresa_id=material.empresa_id AND custody.material_id=material.id AND custody.status IN ('aberta','parcial')),'[]'::jsonb)
 ) FROM public.materiais material WHERE material.empresa_id=v_company_id AND (
   lower(material.id::text)=lower(v_search) OR lower(COALESCE(material.identificador_unico::text,''))=lower(v_search)
   OR lower(COALESCE(material.conteudo_qr_code,''))=lower(v_search) OR lower(COALESCE(material.codigo_barras,''))=lower(v_search)
   OR lower(material.codigo_interno)=lower(v_search) OR lower(COALESCE(material.numero_patrimonio,''))=lower(v_search)
   OR lower(COALESCE(material.numero_serie,''))=lower(v_search) OR material.nome ILIKE '%'||v_search||'%' OR material.codigo_interno ILIKE '%'||v_search||'%'
 ) ORDER BY CASE WHEN lower(material.id::text)=lower(v_search) OR lower(COALESCE(material.identificador_unico::text,''))=lower(v_search) OR lower(COALESCE(material.conteudo_qr_code,''))=lower(v_search) OR lower(COALESCE(material.codigo_barras,''))=lower(v_search) OR lower(material.codigo_interno)=lower(v_search) OR lower(COALESCE(material.numero_patrimonio,''))=lower(v_search) OR lower(COALESCE(material.numero_serie,''))=lower(v_search) THEN 0 ELSE 1 END,material.nome,material.id
 LIMIT LEAST(GREATEST(COALESCE(_limite,12),1),30);
END; $$;

CREATE OR REPLACE FUNCTION public.listar_custodias_materiais(
 _pagina integer DEFAULT 1,_tamanho_pagina integer DEFAULT 10,_busca text DEFAULT NULL,
 _status text DEFAULT NULL,_finalidade text DEFAULT NULL,_responsavel text DEFAULT NULL,
 _executor_id uuid DEFAULT NULL,_localizacao_id uuid DEFAULT NULL,_data_inicio date DEFAULT NULL,
 _data_fim date DEFAULT NULL,_somente_abertas boolean DEFAULT NULL,_empresa_id uuid DEFAULT NULL)
RETURNS TABLE(item jsonb,total_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company_id uuid; v_page integer:=GREATEST(COALESCE(_pagina,1),1); v_size integer:=LEAST(GREATEST(COALESCE(_tamanho_pagina,10),1),100);
BEGIN
 v_company_id:=public.resolve_custody_company(_empresa_id,false);
 RETURN QUERY SELECT jsonb_build_object(
  'id',custody.id,'empresa_id',custody.empresa_id,'material_id',custody.material_id,'material_nome',material.nome,
  'material_codigo',material.codigo_interno,'material_identificador',COALESCE(material.numero_patrimonio,material.numero_serie,material.codigo_barras,material.identificador_unico::text),
  'foto_path',(SELECT photo.storage_path FROM public.materiais_fotos photo WHERE photo.empresa_id=custody.empresa_id AND photo.material_id=custody.material_id ORDER BY photo.foto_principal DESC,photo.created_at,photo.id LIMIT 1),
  'tipo_controle',custody.tipo_controle,'quantidade_retirada',custody.quantidade_retirada,
  'quantidade_devolvida',custody.quantidade_devolvida,'quantidade_baixada',custody.quantidade_baixada,
  'quantidade_pendente',custody.quantidade_retirada-custody.quantidade_devolvida-custody.quantidade_baixada,
  'localizacao_origem_id',custody.localizacao_origem_id,'localizacao_origem_nome',origin.nome,
  'retirada_em',custody.retirada_em,'previsao_retorno',custody.previsao_retorno,'executado_por',custody.executado_por,
  'executor_nome',COALESCE(actor.full_name,'Usuario'),'responsavel_tipo',custody.responsavel_tipo,
  'responsavel_usuario_id',custody.responsavel_usuario_id,'responsavel_funcionario_id',custody.responsavel_funcionario_id,
  'responsavel_nome',custody.responsavel_nome,'finalidade',custody.finalidade,'referencia_tipo',custody.referencia_tipo,
  'referencia_id',custody.referencia_id,'observacao_saida',custody.observacao_saida,'condicao_saida',custody.condicao_saida,
  'status',custody.status,'movimento_saida_id',custody.movimento_saida_id,'encerrada_em',custody.encerrada_em,
  'created_at',custody.created_at,'updated_at',custody.updated_at
 ),count(*) OVER() FROM public.material_custodias custody
 JOIN public.materiais material ON material.empresa_id=custody.empresa_id AND material.id=custody.material_id
 JOIN public.estoque_localizacoes origin ON origin.empresa_id=custody.empresa_id AND origin.id=custody.localizacao_origem_id
 LEFT JOIN public.profiles actor ON actor.user_id=custody.executado_por
 WHERE custody.empresa_id=v_company_id
 AND (nullif(btrim(_busca),'') IS NULL OR material.nome ILIKE '%'||btrim(_busca)||'%' OR material.codigo_interno ILIKE '%'||btrim(_busca)||'%' OR custody.responsavel_nome ILIKE '%'||btrim(_busca)||'%')
 AND (_status IS NULL OR custody.status::text=_status) AND (_finalidade IS NULL OR custody.finalidade::text=_finalidade)
 AND (nullif(btrim(_responsavel),'') IS NULL OR custody.responsavel_nome ILIKE '%'||btrim(_responsavel)||'%')
 AND (_executor_id IS NULL OR custody.executado_por=_executor_id) AND (_localizacao_id IS NULL OR custody.localizacao_origem_id=_localizacao_id)
 AND (_data_inicio IS NULL OR custody.retirada_em>=_data_inicio::timestamptz) AND (_data_fim IS NULL OR custody.retirada_em<(_data_fim+1)::timestamptz)
 AND (_somente_abertas IS NULL OR (_somente_abertas AND custody.status IN ('aberta','parcial')) OR (NOT _somente_abertas AND custody.status NOT IN ('aberta','parcial')))
 ORDER BY custody.retirada_em DESC,custody.id DESC OFFSET (v_page-1)*v_size LIMIT v_size;
END; $$;

CREATE OR REPLACE FUNCTION public.obter_indicadores_custodia(_empresa_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company_id uuid; v_result jsonb;
BEGIN
  v_company_id:=public.resolve_custody_company(_empresa_id,false);
  SELECT jsonb_build_object(
    'itens_fora',COALESCE(sum(CASE WHEN custody.status IN ('aberta','parcial') THEN custody.quantidade_retirada-custody.quantidade_devolvida-custody.quantidade_baixada ELSE 0 END),0),
    'previstos_hoje',count(*) FILTER(WHERE custody.status IN ('aberta','parcial') AND custody.previsao_retorno>=current_date AND custody.previsao_retorno<current_date+interval '1 day'),
    'atrasados',count(*) FILTER(WHERE custody.status IN ('aberta','parcial') AND custody.previsao_retorno<clock_timestamp()),
    'ocorrencias',(SELECT count(*) FROM public.material_custodia_eventos event WHERE event.empresa_id=v_company_id AND ((event.tipo='checkin' AND (event.ocorrencia IS NOT NULL OR event.condicao<>'bom')) OR event.tipo='correcao'))
  ) INTO v_result FROM public.material_custodias custody WHERE custody.empresa_id=v_company_id;
  RETURN v_result;
END; $$;

-- Mantem as interfaces JSON existentes, acrescentando a baixa separadamente.
CREATE OR REPLACE FUNCTION public.listar_eventos_custodia(_custodia_id uuid,_empresa_id uuid DEFAULT NULL)
RETURNS TABLE(item jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company_id uuid;
BEGIN
 v_company_id:=public.resolve_custody_company(_empresa_id,false);
 IF NOT EXISTS(SELECT 1 FROM public.material_custodias WHERE empresa_id=v_company_id AND id=_custodia_id) THEN RAISE EXCEPTION USING ERRCODE='CI005',MESSAGE='Operacao de custodia nao encontrada.'; END IF;
 RETURN QUERY SELECT jsonb_build_object('id',event.id,'tipo',event.tipo,'quantidade',event.quantidade,'localizacao_origem_nome',origin.nome,'localizacao_destino_nome',destination.nome,'condicao',event.condicao,'ocorrencia',event.ocorrencia,'observacao',event.observacao,'justificativa',event.justificativa,'status_operacional_resultante',event.status_operacional_resultante,'data_efetiva',event.data_efetiva,'executado_por',event.executado_por,'executor_nome',COALESCE(actor.full_name,'Usuario'),'movimento_estoque_id',event.movimento_estoque_id,'created_at',event.created_at)
 FROM public.material_custodia_eventos event LEFT JOIN public.estoque_localizacoes origin ON origin.empresa_id=event.empresa_id AND origin.id=event.localizacao_origem_id LEFT JOIN public.estoque_localizacoes destination ON destination.empresa_id=event.empresa_id AND destination.id=event.localizacao_destino_id LEFT JOIN public.profiles actor ON actor.user_id=event.executado_por WHERE event.empresa_id=v_company_id AND event.custodia_id=_custodia_id ORDER BY event.data_efetiva,event.created_at,event.id;
END; $$;

REVOKE ALL ON FUNCTION public.registrar_baixa_custodia_material(uuid,integer,text,text,uuid,text,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_baixa_custodia_material(uuid,integer,text,text,uuid,text,timestamptz,uuid) TO authenticated;

COMMENT ON FUNCTION public.registrar_baixa_custodia_material(uuid,integer,text,text,uuid,text,timestamptz,uuid) IS
  'Baixa auditavel de quantidade perdida, avariada sem retorno ou baixada; nao movimenta estoque e e idempotente por empresa/client_uuid.';
COMMENT ON COLUMN public.material_custodias.quantidade_baixada IS
  'Quantidade encerrada sem retorno fisico; nunca compoe entrada de estoque.';
