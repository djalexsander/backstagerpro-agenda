-- Backstage Pro - RFID UHF foundation (architecture only, no physical
-- reader integration yet).
--
-- Scope: a new way to identify/verify materials (rfid_tags) alongside the
-- existing internal code/barcode/QR Code, plus a session concept for batch
-- conference (rfid_read_sessions). Nothing here touches materiais,
-- categorias_materiais, material_custodias or material_locacoes, and the
-- existing check-in/check-out/rental flows are untouched - RFID conference
-- reads expected materials, it does not (yet) drive checkout/checkin.
--
-- Raw radio reads are never persisted (a UHF reader can report the same tag
-- hundreds of times/second): only the tag registry (one row per link/
-- replace/deactivate, never per read) and the session's finish-time summary
-- are stored. See rfid-domain.ts on the frontend for the in-memory
-- deduplication/reconciliation engine that produces that summary.
--
-- RFID is a commercial add-on module (rfid_materiais below), never a right
-- that comes free with gestao_materiais - see company_has_active_module
-- gating throughout. Authorization is per-user, not just per-company: every
-- RLS policy and every RPC here calls public.user_has_module_action(
-- empresa_id, 'rfid_materiais', 'view'|'create'|'delete'), defined in
-- 20260810090000_user_module_permissions.sql - THIS MIGRATION MUST BE
-- APPLIED AFTER THAT ONE (already true by filename/timestamp order; do not
-- rename either file). admin_empresa/master_admin (operating their own
-- linked company) keep unconditional access exactly as before, because
-- user_has_module_action() itself grants them that - see its definition.
-- A plain "usuario" needs an explicit grant in user_module_permissions
-- (set via the existing "Editar Usuário" screen, UserModulePermissionsFields)
-- for each action; with none, they see/do nothing here, even if their
-- company has the module active. RFID is the first module wired this way
-- (Fase 3 of that migration's plan, previously scoped to Check-in/Check-out
-- as a POC - not yet done for any module before this one).
--
-- Action mapping (4 fixed actions, reused across every module by design -
-- see 20260810090000's header):
--   view   -> ver a seção RFID de um material, seu histórico, resolver EPC,
--             ler o resultado de uma conferência.
--   create -> vincular/trocar tag (rfid_link_or_replace_tag - trocar é a
--             mesma operação, uma tag nova sendo criada) e iniciar/salvar
--             uma sessão de conferência (rfid_start_read_session/
--             rfid_finish_read_session - ambas produzem/concluem a mesma
--             linha, tratadas como uma ação só de propósito).
--   delete -> desativar/remover vínculo de tag (rfid_deactivate_tag).
--   edit   -> reservado para configuração de reader/antenas por terminal
--             (gate só de frontend hoje - terminal-rfid-config.ts não tem
--             tabela/RPC própria ainda, então não há o que gatear no banco).

CREATE TYPE public.rfid_tag_status AS ENUM (
  'ativa',
  'inativa',
  'danificada',
  'perdida'
);

CREATE TYPE public.rfid_read_session_type AS ENUM (
  'inventario',
  'conferencia_locacao',
  'checkout',
  'checkin',
  'conferencia_case',
  'conferencia_livre'
);

CREATE TYPE public.rfid_read_session_status AS ENUM (
  'em_andamento',
  'concluida',
  'cancelada'
);

-- ============================================================================
-- MÓDULO COMERCIAL
-- ============================================================================
-- Segue o mesmo padrão de cada estágio anterior da área de materiais
-- (controle_estoque, checkin_checkout, locacao_materiais, ...): módulo
-- próprio, dependente de gestao_materiais (tag RFID só existe presa a um
-- material). Preço/periodicidade ficam em 0/mensal até o master configurar
-- via painel - esta migration não decide política comercial.

INSERT INTO public.module_catalog (
  nome,
  descricao,
  valor,
  periodicidade,
  ativo,
  ordem,
  tipo_modulo,
  feature_key,
  metadata,
  is_capacity_module,
  categoria,
  texto_venda
)
VALUES (
  'Identificação RFID UHF',
  'Vínculo de tags RFID UHF a materiais e conferência em lote contra o esperado.',
  0,
  'mensal',
  true,
  47,
  'addon',
  'rfid_materiais',
  jsonb_build_object(
    'area', 'materiais',
    'stage', 1,
    'base_module', false
  ),
  false,
  'operacional',
  'Leia várias tags RFID de uma vez e confira automaticamente contra o esperado.'
)
ON CONFLICT (feature_key) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    ativo = true,
    metadata = COALESCE(public.module_catalog.metadata, '{}'::jsonb)
      || EXCLUDED.metadata,
    updated_at = clock_timestamp();

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT child.id, base.id
FROM public.module_catalog AS child
CROSS JOIN public.module_catalog AS base
WHERE child.feature_key = 'rfid_materiais'
  AND base.feature_key = 'gestao_materiais'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

-- ============================================================================
-- rfid_tags - vínculo EPC <-> material, uma linha por vínculo, nunca apagada
-- ============================================================================
--
-- EPC é único por (empresa_id, epc) apenas ENQUANTO ATIVO (índice único
-- parcial abaixo), não globalmente:
--   - Duas empresas distintas compram/gravam suas próprias tags UHF sem
--     nenhuma coordenação entre si; tags UHF baratas/genéricas frequentemente
--     têm EPC gravado manualmente pelo instalador (sequencial ou arbitrário),
--     não um código licenciado GS1 garantidamente único no mundo todo. É
--     plausível duas empresas diferentes acabarem com o mesmo EPC sem que
--     isso seja um erro de ninguém - seus leitores nunca se encontram.
--   - Um UNIQUE global criaria contenção fantasma entre locatários (empresa B
--     falha ao cadastrar uma tag por causa de um valor da empresa A) e
--     vazaria informação entre empresas (tentar cadastrar e receber "já
--     existe" revela que outra empresa tem aquele EPC específico).
--   - É exatamente o mesmo raciocínio já aplicado a todo identificador físico
--     de materiais nesta base (materiais_empresa_codigo_barras_uidx,
--     materiais_empresa_patrimonio_uidx, materiais_empresa_serie_uidx são
--     todos únicos por empresa, nunca globais).
--
-- "Ativo apenas" (não um UNIQUE incondicional) é o que permite manter
-- histórico: uma tag desativada preserva sua linha com o EPC original, e o
-- mesmo EPC só pode voltar a ficar "ativa" em uma nova linha (nunca reaberta
-- na mesma linha - ver prepare_rfid_tag_write).
CREATE TABLE public.rfid_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  material_id uuid NOT NULL
    REFERENCES public.materiais(id) ON DELETE RESTRICT,
  epc text NOT NULL,
  status public.rfid_tag_status NOT NULL DEFAULT 'ativa',
  vinculada_em timestamptz NOT NULL DEFAULT now(),
  desativada_em timestamptz,
  motivo_desativacao text,
  substituida_por_tag_id uuid
    REFERENCES public.rfid_tags(id) ON DELETE SET NULL,
  ultima_leitura_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT rfid_tags_epc_shape CHECK (
    epc = upper(btrim(epc))
    AND epc ~ '^[0-9A-F]{8,64}$'
  ),
  CONSTRAINT rfid_tags_desativada_shape CHECK (
    (status = 'ativa' AND desativada_em IS NULL AND motivo_desativacao IS NULL)
    OR (status <> 'ativa' AND desativada_em IS NOT NULL)
  ),
  CONSTRAINT rfid_tags_not_self_replacement
    CHECK (substituida_por_tag_id IS DISTINCT FROM id)
);

-- No máximo uma tag ATIVA por EPC dentro da empresa: impede que uma tag
-- ativa fique associada a dois materiais ao mesmo tempo.
CREATE UNIQUE INDEX rfid_tags_empresa_epc_ativa_uidx
  ON public.rfid_tags (empresa_id, epc)
  WHERE status = 'ativa';

-- No máximo uma tag ATIVA por material: "um material pode possuir uma tag
-- ativa" (singular). Trocar = desativar a antiga + inserir uma nova linha,
-- nunca duas ativas ao mesmo tempo (ver rfid_link_or_replace_tag).
CREATE UNIQUE INDEX rfid_tags_material_ativa_uidx
  ON public.rfid_tags (material_id)
  WHERE status = 'ativa';

CREATE INDEX rfid_tags_empresa_idx
  ON public.rfid_tags (empresa_id);
CREATE INDEX rfid_tags_empresa_material_idx
  ON public.rfid_tags (empresa_id, material_id);
CREATE INDEX rfid_tags_empresa_epc_idx
  ON public.rfid_tags (empresa_id, epc);

-- ============================================================================
-- rfid_read_sessions - uma linha por sessão de conferência, não por leitura
-- ============================================================================
--
-- referencia_tipo/referencia_id repete o discriminador polimórfico já usado
-- em material_custodias (migration 20260802160000): permite apontar para uma
-- locação hoje (referencia_tipo='locacao') e, no futuro, para um case/kit
-- assim que esse conceito existir, sem nova coluna nem FK para uma tabela que
-- ainda não existe (ver seção "cases" do pedido original - deliberadamente
-- não inventado nesta etapa).
--
-- resultado (jsonb) é um snapshot limitado pelo tamanho do lote conferido
-- (materiais/EPCs envolvidos), gravado uma vez ao finalizar - nunca um log de
-- leituras brutas. Ver rfid-domain.ts `buildSessionResultSnapshot`.
CREATE TABLE public.rfid_read_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo public.rfid_read_session_type NOT NULL,
  referencia_tipo text,
  referencia_id uuid,
  dispositivo_label text,
  responsavel_user_id uuid NOT NULL,
  status public.rfid_read_session_status NOT NULL DEFAULT 'em_andamento',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expected_count integer,
  found_count integer,
  missing_count integer,
  unexpected_count integer,
  unknown_count integer,
  resultado jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfid_read_sessions_referencia_shape CHECK (
    (referencia_tipo IS NULL AND referencia_id IS NULL)
    OR (nullif(btrim(referencia_tipo), '') IS NOT NULL AND referencia_id IS NOT NULL)
  ),
  CONSTRAINT rfid_read_sessions_finished_shape CHECK (
    (status = 'em_andamento' AND finished_at IS NULL)
    OR (status IN ('concluida', 'cancelada') AND finished_at IS NOT NULL)
  ),
  CONSTRAINT rfid_read_sessions_counts_nonnegative CHECK (
    (expected_count IS NULL OR expected_count >= 0)
    AND (found_count IS NULL OR found_count >= 0)
    AND (missing_count IS NULL OR missing_count >= 0)
    AND (unexpected_count IS NULL OR unexpected_count >= 0)
    AND (unknown_count IS NULL OR unknown_count >= 0)
  ),
  CONSTRAINT rfid_read_sessions_counts_only_when_concluded CHECK (
    status = 'concluida'
    OR (
      expected_count IS NULL AND found_count IS NULL
      AND missing_count IS NULL AND unexpected_count IS NULL
      AND unknown_count IS NULL AND resultado IS NULL
    )
  ),
  CONSTRAINT rfid_read_sessions_finished_after_started CHECK (
    finished_at IS NULL OR finished_at >= started_at
  )
);

CREATE INDEX rfid_read_sessions_empresa_idx
  ON public.rfid_read_sessions (empresa_id);
CREATE INDEX rfid_read_sessions_empresa_status_idx
  ON public.rfid_read_sessions (empresa_id, status);
CREATE INDEX rfid_read_sessions_empresa_referencia_idx
  ON public.rfid_read_sessions (empresa_id, referencia_tipo, referencia_id)
  WHERE referencia_tipo IS NOT NULL;
CREATE INDEX rfid_read_sessions_empresa_responsavel_idx
  ON public.rfid_read_sessions (empresa_id, responsavel_user_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
--
-- Nem rfid_tags nem rfid_read_sessions recebem GRANT de INSERT/UPDATE direto
-- (ver grants no fim do arquivo) - toda escrita passa pelas RPCs abaixo, que
-- já derivam e validam empresa_id a partir da linha alvo (material_id/
-- tag_id/session_id), nunca de um parâmetro informado livremente pelo
-- chamador. Os triggers abaixo, portanto, não precisam re-derivar
-- empresa_id a partir de auth.uid() (diferente de prepare_material_write) -
-- o papel deles é validação cruzada e imutabilidade, última linha de defesa
-- mesmo que uma RPC futura erre.

CREATE OR REPLACE FUNCTION public.prepare_rfid_tag_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_material_empresa_id uuid;
  v_material_control public.material_control_type;
BEGIN
  NEW.epc := upper(btrim(NEW.epc));
  NEW.motivo_desativacao := nullif(btrim(NEW.motivo_desativacao), '');
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);

  SELECT material.empresa_id, material.tipo_controle
  INTO v_material_empresa_id, v_material_control
  FROM public.materiais AS material
  WHERE material.id = NEW.material_id;

  IF v_material_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Material da tag não foi encontrado';
  END IF;

  IF v_material_empresa_id <> NEW.empresa_id THEN
    RAISE EXCEPTION 'Material deve pertencer à mesma empresa da tag';
  END IF;

  IF v_material_control <> 'individual' THEN
    RAISE EXCEPTION
      'Somente materiais de controle individual podem receber tag RFID';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    IF NEW.epc IS DISTINCT FROM OLD.epc THEN
      RAISE EXCEPTION
        'EPC de uma tag é imutável; para trocar, desative e vincule uma nova';
    END IF;
    IF NEW.material_id IS DISTINCT FROM OLD.material_id THEN
      RAISE EXCEPTION 'Vínculo de material de uma tag é imutável';
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'Empresa de uma tag é imutável';
    END IF;
    IF OLD.status <> 'ativa' AND NEW.status = 'ativa' THEN
      RAISE EXCEPTION
        'Uma tag desativada não pode ser reativada; crie um novo vínculo';
    END IF;
    NEW.vinculada_em := OLD.vinculada_em;
    NEW.created_by := OLD.created_by;
  END IF;

  IF NEW.status <> 'ativa' AND NEW.desativada_em IS NULL THEN
    NEW.desativada_em := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_rfid_tag_write
BEFORE INSERT OR UPDATE ON public.rfid_tags
FOR EACH ROW
EXECUTE FUNCTION public.prepare_rfid_tag_write();

CREATE OR REPLACE FUNCTION public.prepare_rfid_read_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.referencia_tipo := nullif(btrim(NEW.referencia_tipo), '');
  NEW.dispositivo_label := nullif(btrim(NEW.dispositivo_label), '');

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('concluida', 'cancelada') THEN
      RAISE EXCEPTION 'Sessão de conferência encerrada é imutável';
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.responsavel_user_id IS DISTINCT FROM OLD.responsavel_user_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'Campos de identidade da sessão são imutáveis';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_rfid_read_session_write
BEFORE INSERT OR UPDATE ON public.rfid_read_sessions
FOR EACH ROW
EXECUTE FUNCTION public.prepare_rfid_read_session_write();

-- ============================================================================
-- RPCs
-- ============================================================================

-- Cobre tanto "vincular" (material sem tag ativa) quanto "trocar" (já existe
-- uma tag ativa) - a antiga é desativada e apontada para a nova
-- (substituida_por_tag_id) na mesma transação, nunca sobrescrita. Sem
-- parâmetro de empresa: empresa_id é sempre derivado do material alvo, nunca
-- aceito do chamador (mesmo padrão de generate_material_qr_code/
-- generate_material_barcode).
CREATE OR REPLACE FUNCTION public.rfid_link_or_replace_tag(
  _material_id uuid,
  _epc text
)
RETURNS public.rfid_tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_tipo_controle public.material_control_type;
  v_normalized_epc text;
  v_old_tag_id uuid;
  v_new_tag public.rfid_tags;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  SELECT material.empresa_id, material.tipo_controle
  INTO v_empresa_id, v_tipo_controle
  FROM public.materiais AS material
  WHERE material.id = _material_id;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão.';
  END IF;

  IF v_tipo_controle <> 'individual' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'RF002',
      MESSAGE = 'Somente materiais de controle individual podem receber tag RFID.';
  END IF;

  v_normalized_epc := upper(btrim(_epc));
  IF v_normalized_epc !~ '^[0-9A-F]{8,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF001', MESSAGE = 'EPC inválido.';
  END IF;

  -- Trava a tag ativa atual (se houver) deste material para que uma troca
  -- concorrente não consiga criar duas linhas "ativa" para o mesmo material.
  SELECT tag.id INTO v_old_tag_id
  FROM public.rfid_tags AS tag
  WHERE tag.material_id = _material_id AND tag.status = 'ativa'
  FOR UPDATE;

  IF v_old_tag_id IS NOT NULL THEN
    UPDATE public.rfid_tags
    SET status = 'inativa',
        motivo_desativacao = 'Substituída por nova tag'
    WHERE id = v_old_tag_id;
  END IF;

  INSERT INTO public.rfid_tags (empresa_id, material_id, epc, status)
  VALUES (v_empresa_id, _material_id, v_normalized_epc, 'ativa')
  RETURNING * INTO v_new_tag;

  IF v_old_tag_id IS NOT NULL THEN
    UPDATE public.rfid_tags
    SET substituida_por_tag_id = v_new_tag.id
    WHERE id = v_old_tag_id;
  END IF;

  RETURN v_new_tag;
END;
$$;

-- "Remover/desativar vínculo": _novo_status escolhe entre inativa (genérico,
-- ex. desvinculação manual)/danificada/perdida. Reativar não existe de
-- propósito (ver prepare_rfid_tag_write) - religar a mesma tag física é um
-- novo rfid_link_or_replace_tag, preservando a linha antiga como histórico.
CREATE OR REPLACE FUNCTION public.rfid_deactivate_tag(
  _tag_id uuid,
  _novo_status public.rfid_tag_status DEFAULT 'inativa',
  _motivo text DEFAULT NULL
)
RETURNS public.rfid_tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_current_status public.rfid_tag_status;
  v_result public.rfid_tags;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF _novo_status = 'ativa' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'RF004',
      MESSAGE = 'Use vincular/trocar tag para reativar.';
  END IF;

  SELECT tag.empresa_id, tag.status
  INTO v_empresa_id, v_current_status
  FROM public.rfid_tags AS tag
  WHERE tag.id = _tag_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'delete') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Tag não encontrada ou sem permissão.';
  END IF;

  IF v_current_status <> 'ativa' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF005', MESSAGE = 'Esta tag já está inativa.';
  END IF;

  UPDATE public.rfid_tags
  SET status = _novo_status,
      motivo_desativacao = _motivo
  WHERE id = _tag_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Resolução em lote (EPC -> material): uma única viagem ao servidor para
-- todo o lote lido, não uma chamada por tag - é o caminho que sustenta
-- "leitura em lote" como objetivo principal. Para cada EPC de entrada,
-- devolve a linha mais relevante (ativa vence; senão, a mais recente) -
-- nunca duas linhas para o mesmo EPC. EPC sem nenhuma linha correspondente
-- na empresa do chamador volta com material_id/tag_status nulos (tag
-- desconhecida); isso é resultado normal da conferência, não um erro.
CREATE OR REPLACE FUNCTION public.rfid_resolve_epcs(_epcs text[])
RETURNS TABLE (
  epc text,
  material_id uuid,
  tag_status public.rfid_tag_status
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_empresa_id := public.get_user_empresa_id(auth.uid());

  IF v_empresa_id IS NULL
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'view') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sem permissão para resolver tags RFID nesta empresa.';
  END IF;

  RETURN QUERY
  SELECT
    normalized.epc,
    matched.material_id,
    matched.status AS tag_status
  FROM (
    SELECT DISTINCT upper(btrim(value)) AS epc
    FROM unnest(_epcs) AS value
    WHERE upper(btrim(value)) ~ '^[0-9A-F]{8,64}$'
  ) AS normalized
  LEFT JOIN LATERAL (
    SELECT tag.material_id, tag.status
    FROM public.rfid_tags AS tag
    WHERE tag.empresa_id = v_empresa_id
      AND tag.epc = normalized.epc
    ORDER BY (tag.status = 'ativa') DESC, tag.vinculada_em DESC
    LIMIT 1
  ) AS matched ON true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rfid_start_read_session(
  _tipo public.rfid_read_session_type,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _dispositivo_label text DEFAULT NULL
)
RETURNS public.rfid_read_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_result public.rfid_read_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  v_empresa_id := public.get_user_empresa_id(auth.uid());

  IF v_empresa_id IS NULL
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sem permissão para iniciar conferência RFID.';
  END IF;

  IF (_referencia_tipo IS NULL) <> (_referencia_id IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'RF006',
      MESSAGE = 'Tipo e identificador da referência devem ser informados juntos.';
  END IF;

  INSERT INTO public.rfid_read_sessions (
    empresa_id, tipo, referencia_tipo, referencia_id,
    dispositivo_label, responsavel_user_id, status, started_at
  )
  VALUES (
    v_empresa_id, _tipo, _referencia_tipo, _referencia_id,
    _dispositivo_label, auth.uid(), 'em_andamento', clock_timestamp()
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Recebe o resumo já calculado pelo motor de conferência do frontend
-- (reconcileRfidRead) em vez de recalcular no banco: nesta primeira etapa
-- (laboratório, sem reader físico e sem integração com checkout/checkin
-- real) o custo de reimplementar o motor em SQL não se paga ainda. Ver
-- riscos no relatório final - quando isto passar a alimentar um fluxo de
-- negócio real (ex. confirmar checkout por RFID), recalcular a partir de
-- expected_material_ids/read_epcs no servidor deixa de ser opcional.
CREATE OR REPLACE FUNCTION public.rfid_finish_read_session(
  _session_id uuid,
  _status public.rfid_read_session_status,
  _expected_count integer DEFAULT NULL,
  _found_count integer DEFAULT NULL,
  _missing_count integer DEFAULT NULL,
  _unexpected_count integer DEFAULT NULL,
  _unknown_count integer DEFAULT NULL,
  _resultado jsonb DEFAULT NULL
)
RETURNS public.rfid_read_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_current_status public.rfid_read_session_status;
  v_result public.rfid_read_sessions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  IF _status = 'em_andamento' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF007', MESSAGE = 'Status final inválido.';
  END IF;

  SELECT session.empresa_id, session.status
  INTO v_empresa_id, v_current_status
  FROM public.rfid_read_sessions AS session
  WHERE session.id = _session_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'create') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Sessão não encontrada ou sem permissão.';
  END IF;

  IF v_current_status <> 'em_andamento' THEN
    RAISE EXCEPTION USING ERRCODE = 'RF008', MESSAGE = 'Esta sessão já foi encerrada.';
  END IF;

  UPDATE public.rfid_read_sessions
  SET status = _status,
      finished_at = clock_timestamp(),
      expected_count = CASE WHEN _status = 'concluida' THEN _expected_count END,
      found_count = CASE WHEN _status = 'concluida' THEN _found_count END,
      missing_count = CASE WHEN _status = 'concluida' THEN _missing_count END,
      unexpected_count = CASE WHEN _status = 'concluida' THEN _unexpected_count END,
      unknown_count = CASE WHEN _status = 'concluida' THEN _unknown_count END,
      resultado = CASE WHEN _status = 'concluida' THEN _resultado END
  WHERE id = _session_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Histórico de tags de um material, mais recente primeiro (a ativa, se
-- houver, sempre primeiro por vinculada_em DESC). Table não está nos tipos
-- gerados do Supabase, então o frontend usa esta RPC em vez de .from() sem
-- tipos - mesma convenção de listar_clientes em client-service.ts. A policy
-- de SELECT direta na tabela continua disponível para consultas futuras
-- (ex. relatório "todas as tags da empresa"), só não é o caminho usado por
-- esta primeira leva de telas.
CREATE OR REPLACE FUNCTION public.rfid_list_material_tags(_material_id uuid)
RETURNS SETOF public.rfid_tags
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;

  SELECT material.empresa_id INTO v_empresa_id
  FROM public.materiais AS material
  WHERE material.id = _material_id;

  IF NOT FOUND
     OR NOT public.user_has_module_action(v_empresa_id, 'rfid_materiais', 'view') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Material não encontrado ou sem permissão.';
  END IF;

  RETURN QUERY
  SELECT tag.*
  FROM public.rfid_tags AS tag
  WHERE tag.material_id = _material_id
  ORDER BY tag.vinculada_em DESC;
END;
$$;

-- ============================================================================
-- RLS
-- ============================================================================
--
-- Leitura: policy direta (mesmo padrão de materiais/material_custodias) -
-- ver/listar tags e sessões é uma necessidade operacional comum, não algo
-- sensível o bastante para exigir uma RPC por formato de consulta.
-- Escrita: nenhuma policy, nenhum GRANT de INSERT/UPDATE/DELETE - as
-- invariantes (uma tag ativa por material, EPC único enquanto ativo, sessão
-- imutável após encerrada) só são atômicas via as RPCs acima
-- (SECURITY DEFINER roda com os privilégios do dono da função,
-- independente do que "authenticated" tem de GRANT na tabela).

ALTER TABLE public.rfid_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_read_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Licensed tenant users read rfid tags"
ON public.rfid_tags
FOR SELECT TO authenticated
USING (public.user_has_module_action(empresa_id, 'rfid_materiais', 'view'));

CREATE POLICY "Licensed tenant users read rfid read sessions"
ON public.rfid_read_sessions
FOR SELECT TO authenticated
USING (public.user_has_module_action(empresa_id, 'rfid_materiais', 'view'));

REVOKE ALL ON public.rfid_tags FROM anon;
REVOKE ALL ON public.rfid_read_sessions FROM anon;
GRANT SELECT ON public.rfid_tags TO authenticated;
GRANT SELECT ON public.rfid_read_sessions TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_rfid_tag_write()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_rfid_read_session_write()
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.rfid_link_or_replace_tag(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rfid_deactivate_tag(uuid, public.rfid_tag_status, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rfid_resolve_epcs(text[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rfid_list_material_tags(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rfid_link_or_replace_tag(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_deactivate_tag(uuid, public.rfid_tag_status, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_resolve_epcs(text[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_list_material_tags(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
) TO authenticated;

COMMENT ON TABLE public.rfid_tags IS
  'Tenant-scoped EPC<->material links. One row per link/replace/deactivate; never deleted.';
COMMENT ON TABLE public.rfid_read_sessions IS
  'Tenant-scoped RFID batch-conference sessions. One row per session (not per raw read); finish-time summary only.';
COMMENT ON FUNCTION public.rfid_link_or_replace_tag(uuid, text) IS
  'Links a new active tag to a material, atomically deactivating any prior active tag (history preserved, never overwritten).';
COMMENT ON FUNCTION public.rfid_deactivate_tag(uuid, public.rfid_tag_status, text) IS
  'Deactivates a tag (inativa/danificada/perdida) without replacement.';
COMMENT ON FUNCTION public.rfid_resolve_epcs(text[]) IS
  'Batch EPC -> material resolution scoped to the caller''s own company, one round trip per read set.';
COMMENT ON FUNCTION public.rfid_list_material_tags(uuid) IS
  'Full tag history for one material, most recent first.';
COMMENT ON FUNCTION public.rfid_start_read_session(
  public.rfid_read_session_type, text, uuid, text
) IS 'Opens a new RFID conference session (inventory, rental check, checkout, checkin, case, free-form).';
COMMENT ON FUNCTION public.rfid_finish_read_session(
  uuid, public.rfid_read_session_status,
  integer, integer, integer, integer, integer, jsonb
) IS 'Closes a session with the client-computed reconciliation summary; counts/resultado are discarded for cancelada.';
