-- ============================================================================
-- FIX CRÍTICO: MASTER_ADMIN TINHA BYPASS GLOBAL DE ISOLAMENTO OPERACIONAL
-- ============================================================================
--
-- Auditoria de segurança multiempresa (visual: seletor de empresa aparecendo
-- em Estoque/Clientes/Materiais/Locações/Check-in-Check-out/Manutenções/
-- Etiquetas/Impressoras para uma conta master_admin, listando mais de uma
-- empresa). Causa raiz: is_master_admin(auth.uid()) era usado como bypass
-- incondicional de empresa_id em ~13 funções compartilhadas (helpers
-- centrais de RLS e resolvers de RPC), em vez de substituir apenas a
-- exigência de papel admin_empresa. Isso permitia que qualquer conta
-- master_admin lesse E escrevesse dados operacionais (eventos, financeiro,
-- funcionários, checklist, documentos, backups, estoque, materiais,
-- check-in/check-out, locações, clientes, manutenções, etiquetas,
-- impressoras) de QUALQUER empresa, bastando informar o empresa_id/
-- company_id desejado como parâmetro - o frontend expunha isso com um
-- seletor "Selecione uma empresa" alimentado por um SELECT sem filtro em
-- public.empresas, e o parâmetro ?empresa=<uuid> na própria URL.
--
-- Regra corrigida (autorizada explicitamente para esta correção):
--   - Isolamento por empresa_id é obrigatório também para master_admin nas
--     áreas operacionais (Dashboard, Agenda, Financeiro, Funcionários,
--     Documentos, Backups, Materiais, Estoque, Check-in/Check-out,
--     Locações, Clientes, Manutenções, Etiquetas, Impressoras, Painel
--     Operacional, Checklist);
--   - um master_admin com profiles.empresa_id preenchido opera SOMENTE essa
--     empresa, e para escrita é tratado como se tivesse o papel
--     admin_empresa nela (sem precisar de uma segunda role separada);
--   - um master_admin sem empresa_id vinculado não tem acesso operacional a
--     nenhuma empresa;
--   - o Painel Master administrativo (empresas, planos, pagamentos Asaas,
--     módulos/lote de módulos, usuários globais, configurações e logs do
--     sistema) NÃO é tocado por esta migration - essas policies continuam
--     com is_master_admin(auth.uid()) irrestrito de propósito, porque são a
--     administração global do próprio SaaS, não dado operacional de
--     cliente. Especificamente NÃO alterados: policies de
--     empresas/planos/pagamentos/system_settings/notificacoes_master/
--     system_logs, "Master administrators manage module entitlements" e
--     "Master administrators manage company memberships" em
--     empresa_modules/empresa_usuarios (administração de módulos e de
--     usuários globais), e set_company_lifetime_subscription (concessão de
--     licença vitalícia, checagem própria de is_master_admin sem conceito
--     de empresa operante). check_event_limit()/check_user_limit() também
--     não são alterados: o bypass de limite de plano para master_admin não
--     expõe dado de outra empresa (é só isenção de cota na própria
--     operação), fora do escopo de isolamento cross-tenant desta migration.
--
-- Mecânica da correção: em todo helper/resolver abaixo, o branch
-- "IF is_master_admin THEN confia no parâmetro informado pelo chamador"
-- é removido. Todo ator (master_admin incluso) passa a cair no mesmo
-- caminho: v_company_id := get_user_empresa_id(auth.uid()), com o mesmo
-- REJECT já existente para NULL ou para um parâmetro que não bate com essa
-- empresa. Onde havia exigência de papel admin_empresa para escrita
-- (can_write_company_data, assert_actor_company_operational_access,
-- resolve_financial_company, salvar_configuracao_impressora),
-- is_master_admin(auth.uid()) passa a ser aceito como alternativa a esse
-- papel - nunca como alternativa à checagem de empresa_id, que se mantém
-- igual para todo mundo.
--
-- can_read_company_module/can_write_company_module perdem seu próprio OR
-- is_master_admin porque já delegam para can_read_company_data/
-- can_write_company_data, que agora fazem a checagem correta - manter o OR
-- aqui reintroduziria o mesmo bypass por um caminho redundante.
--
-- Nenhuma tabela, coluna, trigger ou dado é criado/alterado/removido.
-- Nenhuma migration já aplicada é modificada.

-- ----------------------------------------------------------------------------
-- 1. HELPERS CENTRAIS (public.can_read_company_data e derivados)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_company_data(
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _empresa_id = public.get_user_empresa_id(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_data(
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _empresa_id = public.get_user_empresa_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
      OR public.is_master_admin(auth.uid())
    )
    AND public.company_has_operational_access(_empresa_id)
$$;

CREATE OR REPLACE FUNCTION public.can_read_company_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.can_read_company_data(_empresa_id)
    AND public.company_has_active_module(_empresa_id, _feature_key)
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.can_write_company_data(_empresa_id)
    AND public.company_has_active_module(_empresa_id, _feature_key)
$$;

CREATE OR REPLACE FUNCTION public.assert_actor_company_operational_access(
  _actor_id uuid,
  _empresa_id uuid,
  _feature_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF _actor_id IS NULL OR _empresa_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor and company are required';
  END IF;

  IF NOT (
    public.has_role(_actor_id, 'admin_empresa'::public.app_role)
    OR public.is_master_admin(_actor_id)
  ) OR public.get_user_empresa_id(_actor_id) IS DISTINCT FROM _empresa_id THEN
    RAISE EXCEPTION 'Actor is not an administrator of the active company';
  END IF;

  IF NOT public.company_has_operational_access(_empresa_id) THEN
    RAISE EXCEPTION 'Company subscription does not allow operational writes';
  END IF;

  IF _feature_key IS NOT NULL
     AND NOT public.company_has_active_module(_empresa_id, _feature_key) THEN
    RAISE EXCEPTION 'Required company module is not active: %', _feature_key;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. STORAGE DE ARQUIVOS DE EVENTO (Documentos)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_event_storage_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_event_storage_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.event_files AS event_file
      JOIN public.events AS event
        ON event.id = event_file.event_id
      WHERE event_file.file_path = _file_path
        AND event.id::text = split_part(_file_path, '/', 1)
        AND event.empresa_id = public.get_user_empresa_id(auth.uid())
    )
$$;
-- can_manage_event_storage_object não é alterada: já delega inteiramente
-- para can_write_company_data (sem chamar is_master_admin diretamente),
-- então herda a correção do item 1 automaticamente.

-- ----------------------------------------------------------------------------
-- 3. RESOLVERS DE RPC (Materiais/Estoque, Check-in/Check-out, Locações,
--    Clientes, Manutenções, Etiquetas, Financeiro de locações, Impressoras)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_stock_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;

  IF NOT public.company_has_active_module(v_company_id, 'controle_estoque') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST009',
      MESSAGE = 'O módulo Controle de Estoque não está ativo para esta empresa.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'ST009',
      MESSAGE = 'A dependência Gestão de Materiais não está ativa para esta empresa.';
  END IF;

  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;

  IF (_write AND NOT public.can_write_company_module(v_company_id, 'controle_estoque'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'controle_estoque')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;

  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_custody_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;

  IF NOT public.company_has_active_module(v_company_id, 'checkin_checkout') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI009',
      MESSAGE = 'O módulo Check-in e Check-out não está ativo para esta empresa.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'gestao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'controle_estoque') THEN
    RAISE EXCEPTION USING ERRCODE = 'CI009',
      MESSAGE = 'As dependências de Materiais e Estoque precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'CI010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'checkin_checkout'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'checkin_checkout')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_material_rental_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'locacao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'controle_estoque')
     OR NOT public.company_has_active_module(v_company_id, 'checkin_checkout') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR009',
      MESSAGE = 'Locação e suas dependências precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR010',
      MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'locacao_materiais'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'locacao_materiais')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_equipment_maintenance_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'manutencao_equipamentos')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'MT009', MESSAGE = 'Manutenção e Gestão de Materiais precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'MT010', MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'manutencao_equipamentos'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'manutencao_equipamentos')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_material_labels_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa invalida.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'etiquetas_materiais')
     OR NOT public.company_has_active_module(v_company_id, 'gestao_materiais') THEN
    RAISE EXCEPTION USING ERRCODE = 'LB009', MESSAGE = 'Etiquetas e Gestao de Materiais precisam estar ativas.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LB010', MESSAGE = 'A empresa esta em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'etiquetas_materiais'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'etiquetas_materiais')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Voce nao tem permissao para esta operacao.';
  END IF;
  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_financial_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa acessam o financeiro.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL
     OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'financeiro_avancado') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN003', MESSAGE = 'O módulo Financeiro não está ativo para esta empresa.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'FN004', MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'financeiro_avancado'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'financeiro_avancado')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.obter_configuracoes_impressora(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.empresa_impressora_config
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  RETURN QUERY
  SELECT * FROM public.empresa_impressora_config
  WHERE empresa_id = v_company_id
  ORDER BY finalidade;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_configuracao_impressora(
  _finalidade text,
  _nome_impressora text DEFAULT NULL::text,
  _formato text DEFAULT NULL::text,
  _largura_mm numeric DEFAULT NULL::numeric,
  _altura_mm numeric DEFAULT NULL::numeric,
  _orientacao text DEFAULT 'retrato'::text,
  _ativo boolean DEFAULT true,
  _configuracoes jsonb DEFAULT '{}'::jsonb,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS public.empresa_impressora_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_result public.empresa_impressora_config%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF _finalidade NOT IN ('etiqueta', 'cupom', 'documento') THEN
    RAISE EXCEPTION USING ERRCODE = 'PR002', MESSAGE = 'Finalidade inválida.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram impressoras.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;

  INSERT INTO public.empresa_impressora_config (
    empresa_id, finalidade, nome_impressora, formato, largura_mm, altura_mm,
    orientacao, ativo, configuracoes, created_by, updated_by
  ) VALUES (
    v_company_id, _finalidade, nullif(btrim(_nome_impressora), ''), nullif(btrim(_formato), ''),
    _largura_mm, _altura_mm, COALESCE(_orientacao, 'retrato'), COALESCE(_ativo, true),
    COALESCE(_configuracoes, '{}'::jsonb), auth.uid(), auth.uid()
  )
  ON CONFLICT (empresa_id, finalidade) DO UPDATE
  SET nome_impressora = EXCLUDED.nome_impressora,
      formato = EXCLUDED.formato,
      largura_mm = EXCLUDED.largura_mm,
      altura_mm = EXCLUDED.altura_mm,
      orientacao = EXCLUDED.orientacao,
      ativo = EXCLUDED.ativo,
      configuracoes = EXCLUDED.configuracoes,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  RETURNING * INTO v_result;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', 'impressora_configurada',
    'Configuração de impressora atualizada (' || _finalidade || ')',
    auth.uid(), v_company_id,
    jsonb_build_object('finalidade', _finalidade, 'nome_impressora', v_result.nome_impressora));

  RETURN v_result;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. FINANCIALS, FINANCEIRO_LANCAMENTOS/PARCELAS/RECEBIMENTOS e BACKUPS (as
--    únicas policies operacionais com is_master_admin escrito direto no
--    USING, em vez de delegado a um helper - as demais policies dessas
--    tabelas, e todas as das outras tabelas do item 1, já usam
--    can_read/write_company_module e herdam a correção do item 1
--    automaticamente). O comentário original de
--    20260806090000_material_rental_financial_integration.sql:195-199
--    documenta que financeiro_lancamentos/parcelas/recebimentos foram
--    desenhadas para espelhar a policy de financials propositalmente -
--    herdaram o mesmo bypass por replicarem o mesmo desenho.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Licensed tenant administrators read financials" ON public.financials;
CREATE POLICY "Licensed tenant administrators read financials"
ON public.financials FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  )
  AND public.can_read_company_module(empresa_id, 'financeiro_avancado')
);

DROP POLICY IF EXISTS "Licensed tenant administrators read financeiro_lancamentos" ON public.financeiro_lancamentos;
CREATE POLICY "Licensed tenant administrators read financeiro_lancamentos"
ON public.financeiro_lancamentos FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  )
  AND public.can_read_company_module(empresa_id, 'financeiro_avancado')
);

DROP POLICY IF EXISTS "Licensed tenant administrators read financeiro_parcelas" ON public.financeiro_parcelas;
CREATE POLICY "Licensed tenant administrators read financeiro_parcelas"
ON public.financeiro_parcelas FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  )
  AND public.can_read_company_module(empresa_id, 'financeiro_avancado')
);

DROP POLICY IF EXISTS "Licensed tenant administrators read financeiro_recebimentos" ON public.financeiro_recebimentos;
CREATE POLICY "Licensed tenant administrators read financeiro_recebimentos"
ON public.financeiro_recebimentos FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  )
  AND public.can_read_company_module(empresa_id, 'financeiro_avancado')
);

DROP POLICY IF EXISTS "Licensed tenant administrators read backups" ON public.backups;
CREATE POLICY "Licensed tenant administrators read backups"
ON public.backups FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  )
  AND public.can_read_company_module(empresa_id, 'relatorios')
);

-- ============================================================================
-- VALIDAÇÃO EM TRANSAÇÃO
-- ============================================================================
DO $$
DECLARE
  v_fn regprocedure;
  v_role text;
  v_table text;
  -- can_read/write_company_data/module e as duas RPCs de impressora são
  -- pontos de entrada chamados direto (de policy ou de RPC) por
  -- authenticated e devem manter esse grant.
  v_granted regprocedure[] := ARRAY[
    'public.can_read_company_data(uuid)',
    'public.can_write_company_data(uuid)',
    'public.can_read_company_module(uuid,text)',
    'public.can_write_company_module(uuid,text)',
    'public.obter_configuracoes_impressora(uuid)',
    'public.salvar_configuracao_impressora(text,text,text,numeric,numeric,text,boolean,jsonb,uuid)'
  ]::regprocedure[];
  -- Os 6 resolvers são helpers internos: cada um já tem REVOKE ALL FROM
  -- PUBLIC, anon, authenticated(, service_role) desde a migration que os
  -- criou (resolve_stock_company em 20260730080000:1275,
  -- resolve_custody_company em 20260802160000:1277,
  -- resolve_material_rental_company em 20260802200000:1770,
  -- resolve_equipment_maintenance_company em 20260802230000:1326,
  -- resolve_material_labels_company em 20260804090000:527,
  -- resolve_financial_company revogado por 20260807090000:61) - só são
  -- chamados aninhados de dentro das RPCs públicas de cada módulo
  -- (registrar_movimentacao_estoque, criar_locacao_material,
  -- criar_ordem_manutencao, salvar_modelo_etiqueta,
  -- registrar_recebimento_locacao etc.), que são SECURITY DEFINER e já
  -- corretamente granted a authenticated - a chamada aninhada funciona pelo
  -- privilégio do dono dessas RPCs, não pelo do chamador original. CREATE
  -- OR REPLACE não altera esse REVOKE; esta validação confirma que
  -- continua assim, não que mudou.
  v_internal regprocedure[] := ARRAY[
    'public.resolve_stock_company(uuid,boolean)',
    'public.resolve_custody_company(uuid,boolean)',
    'public.resolve_material_rental_company(uuid,boolean)',
    'public.resolve_equipment_maintenance_company(uuid,boolean)',
    'public.resolve_material_labels_company(uuid,boolean)',
    'public.resolve_financial_company(uuid,boolean)'
  ]::regprocedure[];
  v_source text;
BEGIN
  -- A) Nenhuma RPC pública usada pelo frontend pode ter perdido EXECUTE de
  -- authenticated (CREATE OR REPLACE preserva grants, isto é uma checagem
  -- de sanidade, não uma correção de grant).
  FOREACH v_fn IN ARRAY v_granted LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN110',
        MESSAGE = format('Isolamento quebrou RPC publica: %s perdeu EXECUTE de authenticated.', v_fn);
    END IF;
    RAISE NOTICE 'RPC INTACTA | % | authenticated=sim', v_fn;
  END LOOP;

  -- A2) Nenhum dos 6 resolvers internos pode ter ganhado EXECUTE por
  -- acidente (permaneceriam chamáveis direto via supabase.rpc(),
  -- contornando a RPC pública que faz a validação de módulo/plano).
  FOREACH v_fn IN ARRAY v_internal LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'FN113',
          MESSAGE = format('Resolver interno %s ficou executavel por %s.', v_fn, v_role);
      END IF;
    END LOOP;
    RAISE NOTICE 'RESOLVER INTERNO OK | % | continua sem EXECUTE para anon/authenticated/service_role', v_fn;
  END LOOP;

  -- B) Nenhuma das funções corrigidas pode conter mais uma chamada
  -- "is_master_admin(...) THEN" seguida de atribuição direta de parâmetro -
  -- feito como leitura do bytecode-fonte (pg_get_functiondef) para pegar
  -- qualquer reintrodução acidental do padrão de bypass durante a escrita
  -- desta migration.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.resolve_stock_company(uuid,boolean)',
    'public.resolve_custody_company(uuid,boolean)',
    'public.resolve_material_rental_company(uuid,boolean)',
    'public.resolve_equipment_maintenance_company(uuid,boolean)',
    'public.resolve_material_labels_company(uuid,boolean)',
    'public.resolve_financial_company(uuid,boolean)',
    'public.obter_configuracoes_impressora(uuid)',
    'public.salvar_configuracao_impressora(text,text,text,numeric,numeric,text,boolean,jsonb,uuid)',
    'public.can_read_company_data(uuid)',
    'public.can_write_company_data(uuid)',
    'public.can_read_event_storage_object(text)'
  ]::regprocedure[] LOOP
    SELECT pg_get_functiondef(v_fn) INTO v_source;
    IF v_source ~* 'is_master_admin\s*\([^)]*\)\s*THEN\s*(IF[^;]*;)?\s*v_company_id\s*:=\s*_requested_company_id'
       OR v_source ~* 'is_master_admin\s*\([^)]*\)\s*THEN\s*(IF[^;]*;)?\s*v_company_id\s*:=\s*_empresa_id'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'FN111',
        MESSAGE = format('Bypass de master ainda presente em %s.', v_fn);
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: nenhum resolver confia mais em _requested_company_id/_empresa_id só por is_master_admin.';

  -- C) As policies de leitura de financials e backups não podem mais
  -- conceder acesso irrestrito só por is_master_admin sem exigir
  -- can_read_company_module - as duas únicas tabelas operacionais deste
  -- arquivo (fora dos helpers do item 1) que escrevem is_master_admin
  -- direto no USING em vez de delegar a um helper.
  FOREACH v_table IN ARRAY ARRAY[
    'financials', 'financeiro_lancamentos', 'financeiro_parcelas',
    'financeiro_recebimentos', 'backups'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND cmd = 'SELECT'
        AND qual ILIKE '%is_master_admin%'
        AND qual NOT ILIKE '%can_read_company_module%'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'FN112',
        MESSAGE = format('Policy de leitura de %s ainda tem bypass irrestrito de master.', v_table);
    END IF;
    RAISE NOTICE 'OK: policy de leitura de % exige can_read_company_module mesmo para master.', v_table;
  END LOOP;
END;
$$;
