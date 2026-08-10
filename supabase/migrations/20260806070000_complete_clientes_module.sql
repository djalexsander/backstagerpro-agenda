-- Completes the canonical clientes module for its own dedicated screen:
--
-- 1. listar_clientes only matched nome/nome_fantasia/cpf_cnpj. The new
--    Clientes screen needs a single search box that also matches telefone
--    and email (client-side substring filtering does not scale once a
--    company has more than the RPC's page limit of clients).
--
-- 2. There was no RPC to activate/deactivate a client - clientes.ativo could
--    only ever be set to true, at INSERT time, by salvar_cliente. The new
--    Clientes screen needs to toggle it. alternar_status_cliente follows the
--    exact same authorization/logging pattern as salvar_cliente
--    (resolve_material_rental_company + system_logs entry), so it does not
--    introduce a new authorization model.
--
-- No RLS policy changes, no new grants: both functions are SECURITY DEFINER
-- and keep using resolve_material_rental_company for tenant/module/role
-- checks, exactly like the existing listar_clientes/salvar_cliente.

CREATE OR REPLACE FUNCTION public.listar_clientes(
  _busca text DEFAULT NULL::text,
  _somente_ativos boolean DEFAULT true,
  _limite integer DEFAULT 100,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF clientes
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      OR (v_busca_digitos IS NOT NULL AND COALESCE(customer.cpf_cnpj, '') ILIKE '%' || v_busca_digitos || '%')
      OR (v_busca_digitos IS NOT NULL AND regexp_replace(COALESCE(customer.telefone, ''), '[^0-9]', '', 'g') ILIKE '%' || v_busca_digitos || '%')
    )
  ORDER BY customer.nome, customer.id
  LIMIT greatest(1, least(COALESCE(_limite, 100), 200));
END;
$function$;

CREATE OR REPLACE FUNCTION public.alternar_status_cliente(
  _cliente_id uuid,
  _ativo boolean,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS clientes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_result public.clientes%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);

  UPDATE public.clientes
  SET ativo = _ativo,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _cliente_id
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Cliente não encontrado.';
  END IF;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES (
    'locacao',
    CASE WHEN _ativo THEN 'cliente_reativado' ELSE 'cliente_inativado' END,
    'Status do cliente alterado',
    auth.uid(), v_company_id,
    jsonb_build_object('cliente_id', v_result.id, 'ativo', v_result.ativo)
  );

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.alternar_status_cliente(uuid, boolean, uuid) TO authenticated;
