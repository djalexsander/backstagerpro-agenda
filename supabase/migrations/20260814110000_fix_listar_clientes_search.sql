-- ============================================================================
-- FIX + EXTENSÃO: BUSCA EM listar_clientes
-- ============================================================================
--
-- Bug encontrado ao implementar o combobox pesquisável de cliente em Nova
-- Locação: o branch de cpf_cnpj normaliza a busca para dígitos
-- (regexp_replace(btrim(_busca), '[^0-9]', '', 'g')) mas nunca checava se
-- sobrou algo depois de normalizar. Para qualquer busca sem nenhum dígito
-- (ex.: "DJ ALEX", "Jo", qualquer nome) o resultado é
-- COALESCE(cpf_cnpj, '') ILIKE '%' || '' || '%', ou seja ILIKE '%%' - que
-- casa com QUALQUER linha, inclusive cpf_cnpj NULL. Como esse branch está em
-- OR com os demais, ele anulava o filtro inteiro: toda busca só-texto
-- retornava todos os clientes da empresa, sem filtrar por nome/fantasia.
-- Isso nunca foi percebido porque o único caller que já passava _busca
-- (a tela Clientes) não tinha teste cobrindo "poucos resultados esperados",
-- e o fluxo de Nova Locação sempre chamava sem busca (select tradicional
-- com a lista inteira).
--
-- Esta migration:
-- 1) Corrige o bug acima guardando os branches numéricos (cpf_cnpj e o novo
--    telefone) atrás de "sobrou algum dígito depois de normalizar".
-- 2) Adiciona busca por e-mail (texto direto) e telefone (normalizado por
--    dígitos, mesma lógica já usada em cpf_cnpj) - campos que já existem em
--    public.clientes, nenhum campo novo foi inventado.
--
-- Mesma assinatura de antes (_busca text, _somente_ativos boolean,
-- _limite integer, _empresa_id uuid) - CREATE OR REPLACE preserva os grants
-- existentes (authenticated), sem precisar de DROP+GRANT. Nenhuma tabela,
-- RLS ou outro RPC é tocado.

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
  v_busca_digitos text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, false);
  v_busca_digitos := nullif(regexp_replace(btrim(COALESCE(_busca, '')), '[^0-9]', '', 'g'), '');
  RETURN QUERY
  SELECT customer.*
  FROM public.clientes AS customer
  WHERE customer.empresa_id = v_company_id
    AND (NOT _somente_ativos OR customer.ativo)
    AND (
      nullif(btrim(_busca), '') IS NULL
      OR customer.nome ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(customer.nome_fantasia, '') ILIKE '%' || btrim(_busca) || '%'
      OR COALESCE(customer.email, '') ILIKE '%' || btrim(_busca) || '%'
      OR (
        v_busca_digitos IS NOT NULL
        AND (
          COALESCE(customer.cpf_cnpj, '') ILIKE '%' || v_busca_digitos || '%'
          OR regexp_replace(COALESCE(customer.telefone, ''), '[^0-9]', '', 'g') ILIKE '%' || v_busca_digitos || '%'
        )
      )
    )
  ORDER BY customer.nome, customer.id
  LIMIT greatest(1, least(COALESCE(_limite, 100), 200));
END;
$$;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
DO $$
DECLARE
  v_fn regprocedure := 'public.listar_clientes(text, boolean, integer, uuid)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN093',
      MESSAGE = 'listar_clientes perdeu EXECUTE de authenticated ao ser recriada.';
  END IF;
  RAISE NOTICE 'OK: listar_clientes recriada, authenticated ainda com EXECUTE.';
END;
$$;
