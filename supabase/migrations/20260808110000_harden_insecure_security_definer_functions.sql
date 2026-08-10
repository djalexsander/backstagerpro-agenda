-- ============================================================================
-- HARDENING: DUAS FUNÇÕES SECURITY DEFINER SEM NENHUM REVOKE/GRANT +
-- HIGIENE DE REVOKE EM RPCs PÚBLICAS QUE SÓ TINHAM GRANT
-- ============================================================================
--
-- Auditoria de isolamento multiempresa encontrou, fora do escopo do bypass
-- de master_admin corrigido em 20260808100000, dois SECURITY DEFINER sem
-- NENHUM REVOKE/GRANT em toda a base (grep completo em supabase/migrations
-- não retorna nenhuma linha REVOKE/GRANT para nenhum dos dois) - pelo
-- default do Postgres em CREATE FUNCTION (EXECUTE concedido a PUBLIC),
-- ambos são hoje executáveis diretamente via supabase.rpc(...) por
-- qualquer chamador, incluindo anon (não autenticado), e nenhum dos dois
-- valida o autor da chamada:
--
-- 1. public.provision_company_module_entitlements(uuid) -
--    20260804180000_fix_company_module_provisioning.sql - recebe
--    _empresa_id cru, sem checar auth.uid() nem pertencimento. Chamada
--    direta com um _empresa_id arbitrário funciona como oráculo de
--    existência de empresa (RAISE EXCEPTION 'Company not found' vs sucesso
--    silencioso) e força inserção de linhas em empresa_modules (status
--    'inactive') para qualquer empresa alvo - escrita cross-tenant não
--    autenticada, mesmo sem liberar módulo pago (status nunca fica
--    'active'). Único uso legítimo é aninhado, disparado pela trigger
--    handle_new_company_module_provisioning (AFTER INSERT ON
--    public.empresas), que é SECURITY DEFINER - a chamada aninhada
--    continua funcionando após o REVOKE porque roda com o privilégio do
--    dono da função-gatilho, não do chamador original.
--
-- 2. public.sync_material_rental_status(uuid, uuid) -
--    20260806080000_fix_rental_status_sync_on_generic_checkin.sql - mesma
--    ausência total de REVOKE/GRANT e mesma ausência de checagem de
--    auth.uid(), diferente de toda função-irmã resolve_*_company deste
--    repositório. Chamada direta com _company_id/_locacao_id arbitrários
--    (ambos UUID, não enumeráveis, mas o vetor existe) permite forçar a
--    transição de status de uma locação alheia em andamento para
--    'concluida'/'parcialmente_devolvida' e grava um evento de auditoria
--    com executado_por nulo para um chamador anônimo. Único uso legítimo é
--    aninhado, dentro de registrar_checkin_material (SECURITY DEFINER,
--    granted a authenticated) - mesma mecânica de proteção do item 1.
--
-- Nenhuma das duas perde funcionalidade: nenhuma RPC pública nem tela do
-- frontend chama qualquer uma diretamente (confirmado por busca em src/).
--
-- Além disso, hardening de higiene (sem risco de segurança ativo hoje,
-- porque todas as funções abaixo já validam auth.uid()/pertencimento como
-- primeira ação do próprio corpo - mas ficam fora do padrão do resto do
-- repositório, que sempre revoga de PUBLIC/anon/service_role explicitamente
-- nas RPCs públicas, além de conceder a authenticated): as RPCs abaixo
-- receberam GRANT EXECUTE ... TO authenticated nas migrations que as
-- criaram, mas nunca um REVOKE correspondente, deixando PUBLIC (e portanto
-- anon e service_role) com o EXECUTE default do Postgres também.
-- 20260807090000 já tinha corrigido os 5 helpers internos de
-- 20260806090000_material_rental_financial_integration.sql; esta migration
-- fecha a mesma lacuna nas 7 RPCs públicas daquele arquivo que ficaram de
-- fora daquela varredura, mais alternar_status_cliente
-- (20260806070000_complete_clientes_module.sql) e as duas RPCs de
-- impressora (20260806100000_printer_settings.sql, corpo já corrigido em
-- 20260808100000 - aqui só o GRANT/REVOKE).

-- ----------------------------------------------------------------------------
-- A) Bloqueio total dos dois SECURITY DEFINER sem REVOKE/GRANT
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.provision_company_module_entitlements(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_material_rental_status(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Higiene: REVOKE explícito de PUBLIC/anon/service_role nas RPCs públicas
--    que só tinham GRANT (authenticated preservado, nenhum GRANT reemitido -
--    CREATE OR REPLACE também não é usado aqui, só REVOKE)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.alternar_status_cliente(uuid, boolean, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.confirmar_reserva_locacao_material(uuid, uuid, uuid, text, date, jsonb)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_recebimento_locacao(uuid, numeric, text, uuid, timestamptz, text, uuid, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.estornar_recebimento_locacao(uuid, text, uuid, numeric, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_contas_receber(text, text, boolean, integer, integer, uuid, boolean)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.listar_clientes_a_receber(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_financeiro_locacao(uuid, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_resumo_financeiro_locacoes(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.obter_configuracoes_impressora(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_configuracao_impressora(text, text, text, numeric, numeric, text, boolean, jsonb, uuid)
  FROM PUBLIC, anon, service_role;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
DO $$
DECLARE
  v_internal regprocedure[];
  v_public regprocedure[];
  v_fn regprocedure;
  v_role text;
  v_owner text;
BEGIN
  v_internal := ARRAY[
    'public.provision_company_module_entitlements(uuid)',
    'public.sync_material_rental_status(uuid,uuid)'
  ]::regprocedure[];

  v_public := ARRAY[
    'public.alternar_status_cliente(uuid,boolean,uuid)',
    'public.confirmar_reserva_locacao_material(uuid,uuid,uuid,text,date,jsonb)',
    'public.registrar_recebimento_locacao(uuid,numeric,text,uuid,timestamptz,text,uuid,uuid)',
    'public.estornar_recebimento_locacao(uuid,text,uuid,numeric,uuid)',
    'public.listar_contas_receber(text,text,boolean,integer,integer,uuid,boolean)',
    'public.listar_clientes_a_receber(uuid)',
    'public.obter_financeiro_locacao(uuid,uuid)',
    'public.obter_resumo_financeiro_locacoes(uuid)',
    'public.obter_configuracoes_impressora(uuid)',
    'public.salvar_configuracao_impressora(text,text,text,numeric,numeric,text,boolean,jsonb,uuid)'
  ]::regprocedure[];

  -- A) nenhum dos 2 helpers internos pode continuar executável por
  -- anon, authenticated ou service_role.
  FOREACH v_fn IN ARRAY v_internal LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN120',
          MESSAGE = format('Hardening falhou: %s ainda executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
    SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_fn;
    RAISE NOTICE 'INTERNO BLOQUEADO | % | owner=% | PUBLIC=nao anon=nao authenticated=nao service_role=nao', v_fn, v_owner;
  END LOOP;

  -- B) nenhuma RPC pública pode ter perdido EXECUTE de authenticated, e
  -- nenhuma pode continuar executável por anon/service_role.
  FOREACH v_fn IN ARRAY v_public LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN121',
        MESSAGE = format('Hardening quebrou RPC publica: %s perdeu EXECUTE de authenticated.', v_fn);
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN122',
          MESSAGE = format('Higiene falhou: %s ainda executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
    SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_fn;
    RAISE NOTICE 'RPC PUBLICA INTACTA | % | owner=% | authenticated=sim anon=nao service_role=nao', v_fn, v_owner;
  END LOOP;
END;
$$;
