-- ============================================================================
-- PERMISSÕES GRANULARES POR USUÁRIO E MÓDULO (Fase 1 - somente backend)
-- ============================================================================
--
-- Contexto (auditoria prévia, não repetida em detalhe aqui): hoje o modelo de
-- acesso é só de papel (has_role/is_master_admin) + entitlement de módulo por
-- empresa (company_has_active_module) - "usuario" sempre lê tudo que a
-- empresa contratou e nunca escreve nada; "admin_empresa" sempre lê e escreve
-- tudo que a empresa contratou. can_read_company_data/can_write_company_data
-- e can_read_company_module/can_write_company_module (20260730043000,
-- redefinidas por 20260808100000) continuam sendo a fronteira real de
-- segurança e NÃO são alteradas por esta migration - a tabela e as funções
-- abaixo são aditivas.
--
-- Esta etapa entrega só a fundação: tabela, RLS, função auxiliar e RPCs de
-- listar/salvar. Nenhuma policy de outra tabela é tocada (isso é a Fase 3,
-- módulo a módulo, começando por Check-in/Check-out) e nenhuma tela do
-- frontend consome isto ainda (Fase 2).
--
-- Decisões de produto confirmadas antes desta migration:
--   1. Rollout faseado (esta migration não altera comportamento de nenhuma
--      tabela operacional existente).
--   2. Granularidade fixa: 4 ações (visualizar/criar/editar/excluir),
--      mapeadas para o vocabulário de cada domínio nas fases seguintes.
--   3. Master não ganha NENHUM acesso extra: não lê, não escreve, nem em
--      modo somente-leitura, a configuração de permissões de nenhuma
--      empresa - nem mesmo a sua própria empresa operacional vinculada (ver
--      "acesso de master" abaixo). Mantém a fronteira que
--      20260808100000_enforce_master_tenant_isolation.sql fechou.
--   4. Backfill automático: todo "usuario" existente recebe can_view=true
--      nos módulos hoje ativos da sua empresa, para não quebrar o acesso de
--      leitura que já tem hoje no cutover.
--
-- Acesso de master (item 3): diferente de can_write_company_data (onde um
-- master com profiles.empresa_id vinculado é tratado como admin_empresa
-- daquela empresa), aqui isso é deliberadamente MAIS restrito - a tabela e
-- as duas RPCs de gestão abaixo nunca aceitam is_master_admin(auth.uid())
-- como caminho de acesso, mesmo para a própria empresa vinculada de um
-- master, e mesmo que o mesmo user_id também possua uma role admin_empresa
-- (checado explicitamente). Já o helper user_has_module_action - usado nas
-- fases seguintes para gate de DADO OPERACIONAL, não da configuração de
-- permissões em si - preserva o comportamento já existente e testado em
-- tenant_isolation_matrix_test.sql (master com empresa vinculada opera como
-- admin_empresa nela; sem empresa vinculada, zero acesso); isso não é acesso
-- novo, é o mesmo can_write_company_data/can_read_company_module de sempre.

-- ----------------------------------------------------------------------------
-- 1. TABELA
-- ----------------------------------------------------------------------------

CREATE TABLE public.user_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  feature_key text NOT NULL REFERENCES public.module_catalog(feature_key),
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_module_permissions_unique UNIQUE (empresa_id, user_id, feature_key),
  -- Não faz sentido conceder criar/editar/excluir sem visualizar - evita um
  -- estado que nenhuma tela jamais pretenderia produzir.
  CONSTRAINT user_module_permissions_view_required
    CHECK (can_view OR NOT (can_create OR can_edit OR can_delete))
);

COMMENT ON TABLE public.user_module_permissions IS
  'Permissão granular (visualizar/criar/editar/excluir) de um usuário "usuario" '
  'sobre um módulo ativo da sua empresa. Não se aplica a admin_empresa/master_admin '
  '(acesso deles continua vindo só do papel, via can_read/write_company_data). '
  'Acesso exclusivamente via RPC (list_user_module_permissions / '
  'set_user_module_permissions) - ver REVOKE abaixo.';

-- RLS habilitada de propósito sem nenhuma policy: esta tabela não tem
-- nenhuma leitura/escrita direta sancionada, nem para o próprio dono da
-- linha, nem para admin_empresa, nem para master_admin. O mesmo padrão de
-- "RPC é o único caminho" já usado em public.clientes
-- (20260806070000_complete_clientes_module.sql) e reforçado abaixo com
-- REVOKE ALL na própria tabela (segunda camada, independente da RLS).
ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_module_permissions FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. HELPER: user_has_module_action
-- ----------------------------------------------------------------------------
-- Uso previsto nas fases seguintes, dentro de USING/WITH CHECK de outras
-- tabelas (uma por vez, módulo a módulo) - não é chamada por nenhuma policy
-- ainda nesta migration. Mantém o mesmo teto de admin_empresa/master_admin
-- que can_write_company_data já aplica hoje (nenhum acesso novo para eles);
-- só adiciona o caminho de "usuario com grant explícito".
CREATE OR REPLACE FUNCTION public.user_has_module_action(
  _empresa_id uuid,
  _feature_key text,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR _empresa_id IS NULL
     OR _feature_key IS NULL
     OR _action NOT IN ('view', 'create', 'edit', 'delete')
     OR _empresa_id IS DISTINCT FROM public.get_user_empresa_id(auth.uid())
     OR NOT public.company_has_active_module(_empresa_id, _feature_key)
  THEN
    RETURN false;
  END IF;

  -- Assinatura bloqueada/trial expirado: ninguém escreve, igual a
  -- can_write_company_data. Leitura não exige operational_access (mesma
  -- regra de can_read_company_data hoje).
  IF _action <> 'view' AND NOT public.company_has_operational_access(_empresa_id) THEN
    RETURN false;
  END IF;

  IF public.is_master_admin(auth.uid())
     OR public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
  THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_module_permissions ump
    WHERE ump.empresa_id = _empresa_id
      AND ump.user_id = auth.uid()
      AND ump.feature_key = _feature_key
      AND (
        (_action = 'view' AND ump.can_view)
        OR (_action = 'create' AND ump.can_create)
        OR (_action = 'edit' AND ump.can_edit)
        OR (_action = 'delete' AND ump.can_delete)
      )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC: list_user_module_permissions
-- ----------------------------------------------------------------------------
-- Uma linha por módulo ATIVO da empresa (nunca lista módulo indisponível -
-- reforça "usuário só pode receber permissão para módulo ativo" desde a
-- leitura), com as flags concedidas (false por padrão quando não há linha em
-- user_module_permissions ainda). Dois chamadores válidos: o próprio usuário
-- lendo suas próprias permissões (_user_id omitido ou igual a auth.uid()), ou
-- um admin_empresa da mesma empresa lendo as de um terceiro. master_admin
-- nunca - ver nota "Acesso de master" no topo do arquivo.
CREATE OR REPLACE FUNCTION public.list_user_module_permissions(
  _empresa_id uuid,
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  feature_key text,
  module_nome text,
  can_view boolean,
  can_create boolean,
  can_edit boolean,
  can_delete boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_target_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Master admin não gerencia permissões de empresa.';
  END IF;

  v_target_user_id := COALESCE(_user_id, auth.uid());

  IF v_target_user_id = auth.uid() THEN
    IF _empresa_id IS DISTINCT FROM public.get_user_empresa_id(auth.uid()) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
       OR _empresa_id IS DISTINCT FROM public.get_user_empresa_id(auth.uid())
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sem permissão para consultar permissões de outro usuário.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.empresa_usuarios eu
    WHERE eu.empresa_id = _empresa_id AND eu.user_id = v_target_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'UP001', MESSAGE = 'Usuário não pertence a esta empresa.';
  END IF;

  RETURN QUERY
  SELECT
    mc.feature_key,
    mc.nome,
    COALESCE(ump.can_view, false),
    COALESCE(ump.can_create, false),
    COALESCE(ump.can_edit, false),
    COALESCE(ump.can_delete, false)
  FROM public.module_catalog mc
  LEFT JOIN public.user_module_permissions ump
    ON ump.empresa_id = _empresa_id
    AND ump.user_id = v_target_user_id
    AND ump.feature_key = mc.feature_key
  WHERE mc.ativo = true
    AND public.company_has_active_module(_empresa_id, mc.feature_key)
  ORDER BY mc.ordem, mc.feature_key;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. RPC: set_user_module_permissions
-- ----------------------------------------------------------------------------
-- Substituição completa do conjunto de permissões do usuário-alvo nesta
-- empresa (a tela em Fase 2 sempre envia o checklist inteiro): qualquer
-- feature_key hoje concedido e ausente do payload é removido; os presentes
-- são gravados. Só admin_empresa da própria empresa chama; alvo precisa
-- pertencer à empresa, não pode ser master_admin nem admin_empresa (esses
-- não são regidos por esta tabela), e todo feature_key do payload precisa
-- ser um módulo hoje ativo para a empresa.
CREATE OR REPLACE FUNCTION public.set_user_module_permissions(
  _empresa_id uuid,
  _user_id uuid,
  _permissions jsonb
)
RETURNS SETOF public.user_module_permissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_item jsonb;
  v_feature_key text;
  v_target_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Master admin não gerencia permissões de empresa.';
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
     OR _empresa_id IS DISTINCT FROM public.get_user_empresa_id(auth.uid())
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores desta empresa gerenciam permissões.';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'UP001', MESSAGE = 'Usuário é obrigatório.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.empresa_usuarios eu
    WHERE eu.empresa_id = _empresa_id AND eu.user_id = _user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'UP001', MESSAGE = 'Usuário não pertence a esta empresa.';
  END IF;

  -- Papel efetivo do alvo (prioridade master_admin > admin_empresa > usuario,
  -- mesmo critério de selectHighestPriorityRole no frontend) - cobre o caso
  -- de um user_id acumular mais de uma linha em user_roles.
  SELECT ur.role INTO v_target_role
  FROM public.user_roles ur
  WHERE ur.user_id = _user_id
  ORDER BY CASE ur.role::text
             WHEN 'master_admin' THEN 3
             WHEN 'admin_empresa' THEN 2
             WHEN 'admin' THEN 2
             ELSE 1
           END DESC
  LIMIT 1;

  IF v_target_role = 'master_admin'::public.app_role THEN
    RAISE EXCEPTION USING ERRCODE = 'UP002', MESSAGE = 'Contas master_admin não são afetadas por permissões de módulo.';
  END IF;

  IF v_target_role IN ('admin_empresa'::public.app_role, 'admin'::public.app_role) THEN
    RAISE EXCEPTION USING ERRCODE = 'UP003', MESSAGE = 'admin_empresa já possui acesso total; permissões granulares aplicam-se apenas a usuario.';
  END IF;

  IF _permissions IS NULL OR jsonb_typeof(_permissions) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'UP005', MESSAGE = 'Lista de permissões inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_permissions)
  LOOP
    v_feature_key := v_item->>'feature_key';
    IF v_feature_key IS NULL OR NOT public.company_has_active_module(_empresa_id, v_feature_key) THEN
      RAISE EXCEPTION USING ERRCODE = 'UP004',
        MESSAGE = 'Módulo indisponível ou inativo para esta empresa: ' || COALESCE(v_feature_key, '(vazio)');
    END IF;
  END LOOP;

  DELETE FROM public.user_module_permissions
  WHERE empresa_id = _empresa_id
    AND user_id = _user_id
    AND feature_key NOT IN (
      SELECT value->>'feature_key' FROM jsonb_array_elements(_permissions)
    );

  INSERT INTO public.user_module_permissions AS ump (
    empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete, granted_by
  )
  SELECT
    _empresa_id,
    _user_id,
    value->>'feature_key',
    COALESCE((value->>'can_view')::boolean, false),
    COALESCE((value->>'can_create')::boolean, false),
    COALESCE((value->>'can_edit')::boolean, false),
    COALESCE((value->>'can_delete')::boolean, false),
    auth.uid()
  FROM jsonb_array_elements(_permissions)
  ON CONFLICT (empresa_id, user_id, feature_key) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      granted_by = EXCLUDED.granted_by,
      updated_at = clock_timestamp();

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES (
    'permissoes', 'permissoes_usuario_atualizadas',
    'Permissões de módulo atualizadas para o usuário',
    auth.uid(), _empresa_id,
    jsonb_build_object('target_user_id', _user_id, 'permissions', _permissions)
  );

  RETURN QUERY
  SELECT * FROM public.user_module_permissions
  WHERE empresa_id = _empresa_id AND user_id = _user_id
  ORDER BY feature_key;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. BACKFILL (idempotente, reaproveitado pelo teste pgTAP)
-- ----------------------------------------------------------------------------
-- can_view=true para todo "usuario" hoje existente, em todo módulo hoje
-- ativo da sua empresa - preserva exatamente o acesso de leitura que
-- material-permissions.ts/stock-permissions.ts/etc já concedem a "usuario"
-- sem esta tabela. Não toca admin_empresa/master_admin (não são regidos por
-- esta tabela). ON CONFLICT DO NOTHING: nunca sobrescreve uma linha que já
-- exista (idempotente - reexecutável em teste ou, se necessário, manualmente).
CREATE OR REPLACE FUNCTION public.backfill_user_module_view_permissions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view)
  SELECT DISTINCT eu.empresa_id, eu.user_id, mc.feature_key, true
  FROM public.empresa_usuarios eu
  JOIN public.module_catalog mc ON mc.ativo = true
  WHERE eu.perfil = 'usuario'
    AND public.company_has_active_module(eu.empresa_id, mc.feature_key)
  ON CONFLICT (empresa_id, user_id, feature_key) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.backfill_user_module_view_permissions() FROM PUBLIC, anon, authenticated, service_role;

-- Backfill real, uma vez, para todo dado já existente no banco.
SELECT public.backfill_user_module_view_permissions();

-- ----------------------------------------------------------------------------
-- 6. GRANTS
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.user_has_module_action(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_module_action(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.list_user_module_permissions(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_user_module_permissions(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_user_module_permissions(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_module_permissions(uuid, uuid, jsonb) TO authenticated;
