-- ============================================================================
-- FIX: EXECUTE AUSENTE EM HELPERS DE RELACIONAMENTO CROSS-TABELA DE EVENTOS
-- ============================================================================
--
-- Auditoria: 20260730043000 criou event_belongs_to_company,
-- event_day_belongs_to_event, employee_belongs_to_company e
-- template_belongs_to_company como SECURITY DEFINER e corretamente revogou
-- EXECUTE de PUBLIC, anon e authenticated (linhas 283-294 daquela migration) -
-- mas, ao contrário de can_read_company_data/can_write_company_data/
-- can_read_company_module/can_write_company_module (mesma migration, GRANT
-- EXECUTE ... TO authenticated logo em seguida ao REVOKE), nenhum GRANT de
-- volta para authenticated foi emitido para essas 4 funções.
--
-- As 4 funções são chamadas diretamente dentro de USING/WITH CHECK de
-- policies em tabelas que o frontend escreve direto via PostgREST
-- (event_days, event_files, financials, event_funcionarios,
-- event_checklist_items, generated_documents) - não por trás de nenhuma RPC
-- SECURITY DEFINER. Policies de RLS avaliam chamadas de função com o
-- privilégio do papel que está executando o INSERT/UPDATE (authenticated),
-- não do dono da função - SECURITY DEFINER muda o contexto só de dentro para
-- fora, nunca dispensa o EXECUTE de quem chama de fora. Resultado: todo
-- INSERT/UPDATE que passa por uma dessas policies falha com "permission
-- denied for function event_belongs_to_company" (ou uma das 3 irmãs),
-- SQLSTATE 42501, para qualquer usuário, independentemente de plano, papel
-- ou módulo contratado - confirmado nos fluxos de criação de evento
-- (event_days), lançamento financeiro (financials) e checklist técnico
-- (event_checklist_items).
--
-- Mesmo padrão de bug já diagnosticado e corrigido neste repositório em
-- 20260806060000 (estoque_localizacoes) e documentado em
-- 20260807090000. A correção aqui segue a mesma direção do primeiro caso:
-- as 4 funções são chamadas em AND junto de can_write_company_data/
-- can_write_company_module na mesma policy (não são redundantes - conferem
-- o relacionamento pai-filho, algo que can_write_company_data não faz), então
-- não há wrapper canônico substituto como houve para
-- company_has_active_module/company_has_operational_access em
-- estoque_localizacoes. A correção precisa ser GRANT EXECUTE ... TO
-- authenticated nas próprias 4 funções, no mesmo molde de
-- can_read_company_data/can_write_company_data/can_read_company_module/
-- can_write_company_module.
--
-- Nenhuma das 4 funções concede acesso cross-tenant novo: nenhuma chama
-- is_master_admin nem qualquer outro bypass - são checagens relacionais
-- puras (o event_id/funcionario_id/template_id informado pertence à
-- empresa_id informada?). O acesso cross-tenant do Master é resolvido por
-- 20260808100000_enforce_master_tenant_isolation.sql, uma migration
-- separada e independente desta.
--
-- Esta migration é só de GRANT: nenhuma tabela, coluna, policy, dado ou
-- lógica de função é criada/alterada/removida.

GRANT EXECUTE ON FUNCTION public.event_belongs_to_company(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_day_belongs_to_event(uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_belongs_to_company(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.template_belongs_to_company(uuid, uuid)
  TO authenticated;

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
DO $$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public.event_belongs_to_company(uuid,uuid)',
    'public.event_day_belongs_to_event(uuid,uuid,uuid)',
    'public.employee_belongs_to_company(uuid,uuid)',
    'public.template_belongs_to_company(uuid,uuid)'
  ]::regprocedure[];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN100',
        MESSAGE = format('Fix falhou: %s ainda sem EXECUTE para authenticated.', v_fn);
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN101',
        MESSAGE = format('Fix quebrou isolamento: %s executavel por anon.', v_fn);
    END IF;
    RAISE NOTICE 'OK | % | authenticated=sim anon=nao', v_fn;
  END LOOP;
END;
$$;
