-- ============================================================================
-- FIX: PRÓXIMO VENCIMENTO EM CLIENTES A RECEBER
-- ============================================================================
--
-- listar_clientes_a_receber (20260806090000) calculava proximo_vencimento
-- só a partir de financeiro_lancamentos.vencimento
-- (min(l.vencimento) FILTER (...)). Esse campo só é preenchido para
-- forma_cobranca = 'avista' por desenho (ver seção 1 daquela migration:
-- "Só usado quando forma_cobranca = 'avista'... quando 'parcelado', os
-- vencimentos reais vivem em financeiro_parcelas e este campo fica nulo").
-- Resultado: todo cliente cuja única pendência fosse parcelada aparecia
-- sempre com "—" em Próximo vencimento, mesmo com parcela vencendo amanhã.
--
-- total_vencido já tratava isso corretamente (CTE vencido_parcela, olha
-- financeiro_parcelas.vencimento) - só proximo_vencimento ficou pra trás.
-- Esta migration adiciona uma CTE análoga (proximo_parcela, mesma fonte de
-- vencido_parcela mas sem o filtro "< current_date" - aqui quero a parcela
-- aberta mais próxima, vencida ou não) e troca o cálculo por
-- LEAST(vencimento à vista, parcela mais próxima).
--
-- LEAST() no Postgres ignora NULL e só retorna NULL se todos os lados
-- forem NULL - exatamente o "não inventar data" pedido: histórico sem
-- vencimento (só possível em título à vista via backfill; parcela tem
-- vencimento NOT NULL no schema, nunca fica sem valor) continua "—".
--
-- Mesma assinatura de antes (_empresa_id uuid DEFAULT NULL) - CREATE OR
-- REPLACE preserva os grants existentes (authenticated), sem precisar de
-- DROP+GRANT. Só muda o cálculo da última coluna; nenhuma tabela, dado ou
-- outro RPC é tocado.

CREATE OR REPLACE FUNCTION public.listar_clientes_a_receber(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  cliente_id uuid,
  cliente_nome text,
  cliente_nome_fantasia text,
  quantidade_titulos bigint,
  total_devido numeric,
  total_vencido numeric,
  total_pendente_regularizacao numeric,
  proximo_vencimento date
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  WITH lancamentos AS (
    SELECT fl.*
    FROM public.financeiro_lancamentos fl
    WHERE fl.empresa_id = v_company_id AND fl.tipo = 'receita' AND fl.cliente_id IS NOT NULL
  ), vencido_parcela AS (
    SELECT l.cliente_id, sum(p.valor - p.valor_recebido) AS total
    FROM public.financeiro_parcelas p
    JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE p.status IN ('pendente', 'parcial') AND p.vencimento < current_date
    GROUP BY l.cliente_id
  ), proximo_parcela AS (
    SELECT l.cliente_id, min(p.vencimento) AS proximo
    FROM public.financeiro_parcelas p
    JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE p.status IN ('pendente', 'parcial')
    GROUP BY l.cliente_id
  )
  SELECT
    customer.id,
    customer.nome,
    customer.nome_fantasia,
    count(l.id) FILTER (WHERE l.status IN ('pendente', 'parcial'))::bigint,
    COALESCE(sum(l.valor_original - l.valor_recebido) FILTER (WHERE l.status IN ('pendente', 'parcial')), 0)::numeric,
    (
      COALESCE(sum(l.valor_original - l.valor_recebido) FILTER (
        WHERE l.status IN ('pendente', 'parcial') AND l.forma_cobranca = 'avista'
          AND l.vencimento IS NOT NULL AND l.vencimento < current_date
      ), 0)
      + COALESCE(max(vp.total), 0)
    )::numeric,
    COALESCE(sum(l.valor_recebido) FILTER (WHERE l.status = 'cancelado_pendente_regularizacao'), 0)::numeric,
    LEAST(
      min(l.vencimento) FILTER (WHERE l.status IN ('pendente', 'parcial') AND l.forma_cobranca = 'avista'),
      max(pp.proximo)
    )
  FROM lancamentos l
  JOIN public.clientes customer ON customer.empresa_id = l.empresa_id AND customer.id = l.cliente_id
  LEFT JOIN vencido_parcela vp ON vp.cliente_id = l.cliente_id
  LEFT JOIN proximo_parcela pp ON pp.cliente_id = l.cliente_id
  WHERE l.status IN ('pendente', 'parcial', 'cancelado_pendente_regularizacao')
  GROUP BY customer.id, customer.nome, customer.nome_fantasia
  -- ORDER BY posicional (5 = total_devido): o nome da coluna colide com o
  -- parâmetro de saída da função (RETURNS TABLE), então uma referência por
  -- nome aqui é ambígua para o Postgres.
  ORDER BY 5 DESC;
END;
$function$;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
-- Mesma garantia da migration de hardening anterior: se a asserção falhar,
-- a exceção reverte a migration inteira (Supabase CLI aplica cada arquivo
-- dentro de uma transação).
DO $$
DECLARE
  v_fn regprocedure := 'public.listar_clientes_a_receber(uuid)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN092',
      MESSAGE = 'listar_clientes_a_receber perdeu EXECUTE de authenticated ao ser recriada.';
  END IF;
  RAISE NOTICE 'OK: listar_clientes_a_receber recriada, authenticated ainda com EXECUTE.';
END;
$$;
