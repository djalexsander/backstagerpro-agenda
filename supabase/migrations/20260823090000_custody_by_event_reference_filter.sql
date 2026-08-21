-- Backstage Pro - Primeira etapa da conferência de retorno por Evento:
-- permite listar as custódias vinculadas a um evento específico
-- (material_custodias.referencia_tipo='evento' + referencia_id=events.id).
--
-- Reaproveita listar_custodias_materiais (só acrescenta dois filtros
-- opcionais, mesmo padrão dos filtros existentes) em vez de criar uma RPC
-- nova - o formato de linha já devolvido (inclusive quantidade_pendente já
-- calculada) é suficiente; a agregação por material (total retirado/
-- devolvido/pendente, materiais pendentes vs. totalmente devolvidos) é
-- puramente client-side sobre essas linhas (src/lib/event-custody-domain.ts),
-- o mesmo padrão já usado por rental-operations-domain.ts para a fila de
-- locações - não existe, nem deveria existir, uma RPC dedicada só para essa
-- soma. Nenhuma RPC de escrita muda; check-in continua exatamente como é.

CREATE OR REPLACE FUNCTION public.listar_custodias_materiais(
 _pagina integer DEFAULT 1,_tamanho_pagina integer DEFAULT 10,_busca text DEFAULT NULL,
 _status text DEFAULT NULL,_finalidade text DEFAULT NULL,_responsavel text DEFAULT NULL,
 _executor_id uuid DEFAULT NULL,_localizacao_id uuid DEFAULT NULL,_data_inicio date DEFAULT NULL,
 _data_fim date DEFAULT NULL,_somente_abertas boolean DEFAULT NULL,
 _referencia_tipo text DEFAULT NULL,_referencia_id uuid DEFAULT NULL,
 _empresa_id uuid DEFAULT NULL)
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
 AND (_referencia_tipo IS NULL OR custody.referencia_tipo=_referencia_tipo)
 AND (_referencia_id IS NULL OR custody.referencia_id=_referencia_id)
 ORDER BY custody.retirada_em DESC,custody.id DESC OFFSET (v_page-1)*v_size LIMIT v_size;
END; $$;
