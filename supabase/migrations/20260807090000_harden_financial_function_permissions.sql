-- ============================================================================
-- HARDENING: PERMISSÕES DE FUNÇÕES INTERNAS DO MÓDULO FINANCEIRO
-- ============================================================================
--
-- Auditoria: 20260806090000 (integração locações x financeiro) e
-- 20260806100000 (config. de impressora) não erraram o desenho - erraram o
-- rodapé de GRANTs. O padrão já estabelecido pelo resto do repositório
-- (stage four/five/six - ver resolve_material_rental_company,
-- resolve_custody_company, resolve_equipment_maintenance_company,
-- resolve_material_labels_company, todos com REVOKE ALL ... FROM PUBLIC,
-- anon, authenticated, service_role logo após CREATE FUNCTION) é: toda
-- função SECURITY DEFINER que não é RPC pública chamada por
-- frontend/edge function recebe esse REVOKE explícito, porque o Postgres
-- concede EXECUTE a PUBLIC por padrão em CREATE FUNCTION (comportamento
-- documentado do Postgres para functions/procedures, não é bug do
-- Supabase). Nenhuma das duas migrations de 20260806 encontrou
-- ALTER DEFAULT PRIVILEGES neste repositório - a exposição vem só desse
-- default do Postgres combinado com a ausência do REVOKE de costume.
--
-- 20260806090000 aplicou o padrão às RPCs públicas (seção 10 - GRANT
-- explícito para authenticated) mas esqueceu de revogar os 4 helpers
-- internos que introduziu:
--   - sync_material_rental_financial_entry e resolve_financial_company
--     ficaram sem NENHUM REVOKE/GRANT (portanto no default do Postgres:
--     executável por anon e authenticated via PostgREST RPC);
--   - backfill_financeiro_locacoes recebeu só "REVOKE ALL FROM PUBLIC"
--     (sem anon/authenticated/service_role nomeados - o único REVOKE em
--     toda a base que não nomeia os 4 papéis; todo o resto do repositório
--     sempre nomeia explicitamente, provavelmente porque PUBLIC sozinho
--     não é garantia suficiente aqui);
--   - financeiro_status_from_valores (função pura) e o trigger
--     protect_financeiro_recebimentos_history também ficaram sem REVOKE,
--     por consistência com o padrão do resto do repositório.
--
-- Risco real do achado mais grave: sync_material_rental_financial_entry
-- recebe _company_id como parâmetro cru e NÃO valida por conta própria que
-- o chamador pertence àquela empresa (quem valida isso é
-- confirmar_reserva_locacao_material/cancelar_locacao_material, ANTES de
-- chamar o helper) - com EXECUTE direto, qualquer authenticated poderia
-- forjar/alterar lançamentos financeiros de empresa alheia.
-- backfill_financeiro_locacoes itera TODAS as locações de TODAS as
-- empresas quando _empresa_id é NULL, também sem checagem própria de
-- autorização.
--
-- Esta migration é só de PRIVILÉGIO: nenhuma tabela, coluna, policy,
-- dado ou lógica de função é criada/alterada/removida - só GRANT/REVOKE,
-- e é idempotente (REVOKE de algo já revogado não é erro).
--
-- Nenhuma RPC pública perde ou ganha privilégio aqui. O acesso INDIRETO
-- delas aos helpers revogados continua funcionando: toda RPC pública
-- listada no bloco de validação abaixo é SECURITY DEFINER, então dentro
-- do corpo dela current_user já é o owner da função (não o chamador
-- original) - a checagem de EXECUTE de uma chamada aninhada ao helper é
-- feita contra os privilégios do OWNER, que sempre pode executar o que
-- lhe pertence. É o mesmo mecanismo que já mantém
-- resolve_material_rental_company (zero grants para authenticated)
-- funcionando hoje através de confirmar_reserva_locacao_material.

REVOKE ALL ON FUNCTION public.sync_material_rental_financial_entry(uuid, uuid, text, date, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_financial_company(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.financeiro_status_from_valores(boolean, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_financeiro_recebimentos_history()
  FROM PUBLIC, anon, authenticated, service_role;

-- backfill_financeiro_locacoes já tinha "REVOKE ALL FROM PUBLIC" (ver
-- 20260806090000 seção 8). Reemitir com os 4 papéis nomeados é
-- idempotente para PUBLIC e fecha a lacuna para anon/authenticated/service_role.
REVOKE ALL ON FUNCTION public.backfill_financeiro_locacoes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
-- O Supabase CLI aplica cada arquivo de migration dentro de uma única
-- transação. Se qualquer asserção abaixo falhar, a exceção reverte a
-- migration inteira (nada fica parcialmente aplicado) - é a mesma garantia
-- que um teste manual com BEGIN/ROLLBACK daria, mas testando a própria SQL
-- que vai ser aplicada, sem risco de divergência entre "cópia de teste" e
-- "cópia real". RAISE NOTICE deixa um rastro legível no output do
-- "db push" para conferência pós-deploy.
DO $$
DECLARE
  v_internal regprocedure[];
  v_public regprocedure[];
  v_fn regprocedure;
  v_role text;
  v_owner text;
BEGIN
  v_internal := ARRAY[
    'public.sync_material_rental_financial_entry(uuid,uuid,text,date,jsonb)',
    'public.resolve_financial_company(uuid,boolean)',
    'public.financeiro_status_from_valores(boolean,numeric,numeric,numeric)',
    'public.protect_financeiro_recebimentos_history()',
    'public.backfill_financeiro_locacoes(uuid)'
  ]::regprocedure[];

  v_public := ARRAY[
    'public.confirmar_reserva_locacao_material(uuid,uuid,uuid,text,date,jsonb)',
    'public.cancelar_locacao_material(uuid,text,uuid,uuid)',
    'public.registrar_recebimento_locacao(uuid,numeric,text,uuid,timestamptz,text,uuid,uuid)',
    'public.estornar_recebimento_locacao(uuid,text,uuid,numeric,uuid)',
    'public.listar_contas_receber(text,text,boolean,integer,integer,uuid,boolean)',
    'public.listar_clientes_a_receber(uuid)',
    'public.obter_financeiro_locacao(uuid,uuid)',
    'public.obter_resumo_financeiro_locacoes(uuid)',
    'public.obter_configuracoes_impressora(uuid)',
    'public.salvar_configuracao_impressora(text,text,text,numeric,numeric,text,boolean,jsonb,uuid)'
  ]::regprocedure[];

  -- A) a E): nenhum helper interno pode continuar executável por anon,
  -- authenticated ou service_role.
  FOREACH v_fn IN ARRAY v_internal LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN090',
          MESSAGE = format('Hardening falhou: %s ainda executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
    SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_fn;
    RAISE NOTICE 'INTERNO BLOQUEADO | % | owner=% | PUBLIC=nao anon=nao authenticated=nao service_role=nao', v_fn, v_owner;
  END LOOP;

  -- F): nenhuma RPC pública pode ter perdido EXECUTE de authenticated.
  FOREACH v_fn IN ARRAY v_public LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN091',
        MESSAGE = format('Hardening quebrou RPC publica: %s perdeu EXECUTE de authenticated.', v_fn);
    END IF;
    SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_fn;
    RAISE NOTICE 'RPC PUBLICA INTACTA | % | owner=% | authenticated=sim', v_fn, v_owner;
  END LOOP;
END;
$$;
