-- Backstage Pro - ETAPA 7: paginacao REAL para a Conferencia por Evento
-- (EventCustodyPanel.tsx).
--
-- Problema: 20260823090000_custody_by_event_reference_filter.sql documentou
-- deliberadamente que a agregacao por material (retirado/devolvido/pendente
-- por material_id) deveria ficar "puramente client-side" sobre as linhas cruas
-- de listar_custodias_materiais, com o argumento de que "nao existe, nem
-- deveria existir, uma RPC dedicada so para essa soma". Na pratica,
-- listCustodyOperationsByReference (checkin-checkout-service.ts) precisava
-- entao percorrer TODAS as paginas cruas do evento (ate 1000 paginas de 100
-- linhas) so para montar, no cliente, um resumo por material que a
-- interface exibe paginado. Isso nao e mais sustentavel para eventos com
-- historico extenso de checkout/checkin/correcao - o volume de LINHAS
-- (custodias + reaberturas parciais) cresce muito mais rapido que o volume
-- de MATERIAIS distintos.
--
-- Esta migration nao contraria a decisao arquitetural registrada em
-- 20260821090000_checkout_event_reference.sql / 20260823090000 - aquela
-- decisao e sobre NAO criar tabela movimentacao_sessao nem coluna evento_id
-- em material_custodias (continua vinculando por
-- referencia_tipo='evento'+referencia_id=events.id, inalterado aqui). Ela e
-- omissa sobre se uma RPC de leitura agregada pode existir; dado o requisito
-- explicito de paginacao real por material, uma RPC dedicada e a unica forma
-- correta de paginar um resumo agrupado (paginar as linhas cruas e reagrupar
-- por pagina no cliente produziria totais errados sempre que as linhas de um
-- mesmo material cruzassem o limite de pagina).
--
-- Duas RPCs novas, mesmo padrao de leitura do modulo (resolve_custody_company
-- com _write=false, sem checagem de acao granular adicional - igual a
-- listar_custodias_materiais/obter_indicadores_custodia, que tambem so
-- exigem can_read_company_module via resolve_custody_company):
--
--   1. listar_custodias_evento_por_material - GROUP BY material_id com
--      LIMIT/OFFSET aplicado ao resultado JA AGRUPADO (nao as linhas cruas),
--      contagem total via count(*) OVER() sobre os grupos (mesmo padrao de
--      listar_custodias_materiais). _pendente filtra por
--      NULL=todos/true=so pendentes/false=so totalmente devolvidos - a mesma
--      divisao que summarizeEventCustody fazia no cliente
--      (quantidade_pendente > 0 vs = 0), agora feita no SQL via HAVING
--      (aqui expressa como WHERE sobre o CTE ja agregado, mais legivel).
--      custodias_abertas replica o mesmo formato de linha (jsonb) que
--      listar_custodias_materiais ja devolve, para que CustodyOperationView
--      no frontend continue identico - CheckinDialog/registrar_checkin_material
--      nao mudam.
--   2. obter_totais_custodia_evento - os 3 cards de total (retirado/
--      devolvido/pendente) do evento inteiro, independente de paginacao;
--      soma pura em SQL, nao carrega nenhuma linha para o cliente alem dos 3
--      numeros (mesmo espirito de obter_indicadores_custodia).
--
-- Ambas aceitam os mesmos dois filtros operacionais novos, compativeis com
-- dados ja existentes (nenhuma coluna nova): _busca (nome/codigo do
-- material, mesmo ILIKE que listar_custodias_materiais ja usa) e
-- _localizacao_id (localizacao de origem da retirada, mesma coluna que o
-- filtro "Localizacao de saida" da aba Historico ja usa). O filtro de
-- evento (_evento_id) continua obrigatorio - a funcao rejeita NULL
-- explicitamente (CI004), nao apenas por convencao de UI.
--
-- Nao mudam: registrar_checkout_material, registrar_checkin_material,
-- cancelar_checkout_material, registrar_baixa_custodia_material,
-- listar_custodias_materiais (continua servindo a aba "Operacoes em aberto"
-- e o Historico, ambas sem agrupamento por material).

CREATE OR REPLACE FUNCTION public.listar_custodias_evento_por_material(
  _evento_id uuid DEFAULT NULL,
  _pendente boolean DEFAULT NULL,
  _pagina integer DEFAULT 1,
  _tamanho_pagina integer DEFAULT 20,
  _busca text DEFAULT NULL,
  _localizacao_id uuid DEFAULT NULL,
  _empresa_id uuid DEFAULT NULL
)
RETURNS TABLE(item jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_page integer := GREATEST(COALESCE(_pagina, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(_tamanho_pagina, 20), 1), 100);
BEGIN
  v_company_id := public.resolve_custody_company(_empresa_id, false);
  IF _evento_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Evento e obrigatorio.';
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT
      material.id AS material_id,
      material.nome AS material_nome,
      material.codigo_interno AS material_codigo,
      SUM(custody.quantidade_retirada) AS quantidade_retirada,
      SUM(custody.quantidade_devolvida) AS quantidade_devolvida,
      SUM(custody.quantidade_retirada - custody.quantidade_devolvida - custody.quantidade_baixada) AS quantidade_pendente,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', custody.id, 'empresa_id', custody.empresa_id, 'material_id', custody.material_id,
            'material_nome', material.nome, 'material_codigo', material.codigo_interno,
            'material_identificador', COALESCE(material.numero_patrimonio, material.numero_serie, material.codigo_barras, material.identificador_unico::text),
            'foto_path', (SELECT photo.storage_path FROM public.materiais_fotos photo WHERE photo.empresa_id = custody.empresa_id AND photo.material_id = custody.material_id ORDER BY photo.foto_principal DESC, photo.created_at, photo.id LIMIT 1),
            'tipo_controle', custody.tipo_controle, 'quantidade_retirada', custody.quantidade_retirada,
            'quantidade_devolvida', custody.quantidade_devolvida, 'quantidade_baixada', custody.quantidade_baixada,
            'quantidade_pendente', custody.quantidade_retirada - custody.quantidade_devolvida - custody.quantidade_baixada,
            'localizacao_origem_id', custody.localizacao_origem_id, 'localizacao_origem_nome', origin.nome,
            'retirada_em', custody.retirada_em, 'previsao_retorno', custody.previsao_retorno, 'executado_por', custody.executado_por,
            'executor_nome', COALESCE(actor.full_name, 'Usuario'), 'responsavel_tipo', custody.responsavel_tipo,
            'responsavel_usuario_id', custody.responsavel_usuario_id, 'responsavel_funcionario_id', custody.responsavel_funcionario_id,
            'responsavel_nome', custody.responsavel_nome, 'finalidade', custody.finalidade, 'referencia_tipo', custody.referencia_tipo,
            'referencia_id', custody.referencia_id, 'observacao_saida', custody.observacao_saida, 'condicao_saida', custody.condicao_saida,
            'status', custody.status, 'movimento_saida_id', custody.movimento_saida_id, 'encerrada_em', custody.encerrada_em,
            'created_at', custody.created_at, 'updated_at', custody.updated_at
          ) ORDER BY custody.retirada_em ASC, custody.id ASC
        ) FILTER (WHERE custody.quantidade_retirada - custody.quantidade_devolvida - custody.quantidade_baixada > 0),
        '[]'::jsonb
      ) AS custodias_abertas
    FROM public.material_custodias custody
    JOIN public.materiais material ON material.empresa_id = custody.empresa_id AND material.id = custody.material_id
    JOIN public.estoque_localizacoes origin ON origin.empresa_id = custody.empresa_id AND origin.id = custody.localizacao_origem_id
    LEFT JOIN public.profiles actor ON actor.user_id = custody.executado_por
    WHERE custody.empresa_id = v_company_id
      AND custody.referencia_tipo = 'evento'
      AND custody.referencia_id = _evento_id
      AND custody.status <> 'cancelada'
      AND (nullif(btrim(_busca), '') IS NULL OR material.nome ILIKE '%' || btrim(_busca) || '%' OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%')
      AND (_localizacao_id IS NULL OR custody.localizacao_origem_id = _localizacao_id)
    GROUP BY material.id, material.nome, material.codigo_interno
  )
  SELECT
    jsonb_build_object(
      'material_id', grouped.material_id,
      'material_nome', grouped.material_nome,
      'material_codigo', grouped.material_codigo,
      'quantidade_retirada', grouped.quantidade_retirada,
      'quantidade_devolvida', grouped.quantidade_devolvida,
      'quantidade_pendente', grouped.quantidade_pendente,
      'custodias_abertas', grouped.custodias_abertas
    ),
    count(*) OVER()
  FROM grouped
  WHERE _pendente IS NULL
    OR (_pendente AND grouped.quantidade_pendente > 0)
    OR (NOT _pendente AND grouped.quantidade_pendente = 0)
  ORDER BY grouped.material_nome ASC, grouped.material_id ASC
  OFFSET (v_page - 1) * v_size LIMIT v_size;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_custodias_evento_por_material(uuid, boolean, integer, integer, text, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.listar_custodias_evento_por_material(uuid, boolean, integer, integer, text, uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.listar_custodias_evento_por_material(uuid, boolean, integer, integer, text, uuid, uuid) IS
  'Resumo de custodias de um evento agrupado por material, paginado no resultado ja agregado (nao nas linhas cruas). _pendente: NULL=todos, true=so com saldo pendente, false=so totalmente devolvidos. custodias_abertas replica o mesmo formato de linha de listar_custodias_materiais.';

CREATE OR REPLACE FUNCTION public.obter_totais_custodia_evento(
  _evento_id uuid DEFAULT NULL,
  _busca text DEFAULT NULL,
  _localizacao_id uuid DEFAULT NULL,
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
  IF _evento_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'CI004', MESSAGE = 'Evento e obrigatorio.';
  END IF;

  SELECT jsonb_build_object(
    'total_retirado', COALESCE(SUM(custody.quantidade_retirada), 0),
    'total_devolvido', COALESCE(SUM(custody.quantidade_devolvida), 0),
    'total_pendente', COALESCE(SUM(custody.quantidade_retirada - custody.quantidade_devolvida - custody.quantidade_baixada), 0)
  ) INTO v_result
  FROM public.material_custodias custody
  JOIN public.materiais material ON material.empresa_id = custody.empresa_id AND material.id = custody.material_id
  WHERE custody.empresa_id = v_company_id
    AND custody.referencia_tipo = 'evento'
    AND custody.referencia_id = _evento_id
    AND custody.status <> 'cancelada'
    AND (nullif(btrim(_busca), '') IS NULL OR material.nome ILIKE '%' || btrim(_busca) || '%' OR material.codigo_interno ILIKE '%' || btrim(_busca) || '%')
    AND (_localizacao_id IS NULL OR custody.localizacao_origem_id = _localizacao_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.obter_totais_custodia_evento(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.obter_totais_custodia_evento(uuid, text, uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.obter_totais_custodia_evento(uuid, text, uuid, uuid) IS
  'Totais (retirado/devolvido/pendente) de um evento inteiro, somados em SQL - alimenta os 3 cards de total de EventCustodyPanel sem depender da paginacao das listas por material.';
