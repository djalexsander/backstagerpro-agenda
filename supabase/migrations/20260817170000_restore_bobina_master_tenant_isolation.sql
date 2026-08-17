-- P0-2: restore strict tenant isolation for bobina profile and printer RPCs.
--
-- 20260811140000 reintroduced a master_admin branch that trusted the
-- caller-provided _empresa_id. Operational access must always resolve from
-- profiles.empresa_id, including for master_admin. A linked master_admin keeps
-- the legitimate admin-equivalent write behavior only inside that company.
CREATE OR REPLACE FUNCTION public.listar_perfis_bobina(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.empresa_bobina_perfis
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
  SELECT * FROM public.empresa_bobina_perfis
  WHERE empresa_id = v_company_id AND ativo
  ORDER BY padrao DESC, nome, id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_perfil_bobina(
  _nome text,
  _largura_etiqueta_mm numeric,
  _altura_etiqueta_mm numeric,
  _colunas integer DEFAULT 1,
  _espacamento_horizontal_mm numeric DEFAULT 0,
  _espacamento_vertical_mm numeric DEFAULT 0,
  _margem_esquerda_mm numeric DEFAULT 0,
  _margem_direita_mm numeric DEFAULT 0,
  _margem_superior_mm numeric DEFAULT 0,
  _margem_inferior_mm numeric DEFAULT 0,
  _orientacao text DEFAULT 'retrato'::text,
  _largura_midia_mm numeric DEFAULT NULL::numeric,
  _offset_horizontal_mm numeric DEFAULT 0,
  _offset_vertical_mm numeric DEFAULT 0,
  _dpi text DEFAULT 'automatico'::text,
  _dpi_personalizado integer DEFAULT NULL::integer,
  _padrao boolean DEFAULT false,
  _perfil_id uuid DEFAULT NULL::uuid,
  _expected_updated_at timestamptz DEFAULT NULL::timestamptz,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS public.empresa_bobina_perfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_result public.empresa_bobina_perfis%ROWTYPE;
  v_required_width numeric;
  v_dpi_personalizado integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF nullif(btrim(_nome), '') IS NULL OR length(btrim(_nome)) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB003', MESSAGE = 'Informe um nome com até 80 caracteres.';
  END IF;
  IF COALESCE(_largura_etiqueta_mm, 0) <= 0 OR _largura_etiqueta_mm > 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB004', MESSAGE = 'A largura da etiqueta deve ficar entre 0 e 500 mm.';
  END IF;
  IF COALESCE(_altura_etiqueta_mm, 0) <= 0 OR _altura_etiqueta_mm > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB004', MESSAGE = 'A altura da etiqueta deve ficar entre 0 e 1000 mm.';
  END IF;
  IF COALESCE(_colunas, 0) < 1 OR _colunas > 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB005', MESSAGE = 'A quantidade de colunas deve ficar entre 1 e 20.';
  END IF;
  IF COALESCE(_espacamento_horizontal_mm, 0) < 0 OR COALESCE(_espacamento_vertical_mm, 0) < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB004', MESSAGE = 'Os espaçamentos não podem ser negativos.';
  END IF;
  IF COALESCE(_margem_esquerda_mm, 0) < 0 OR COALESCE(_margem_direita_mm, 0) < 0
     OR COALESCE(_margem_superior_mm, 0) < 0 OR COALESCE(_margem_inferior_mm, 0) < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB004', MESSAGE = 'As margens não podem ser negativas.';
  END IF;
  IF COALESCE(_orientacao, 'retrato') NOT IN ('retrato', 'paisagem') THEN
    RAISE EXCEPTION USING ERRCODE = 'BB004', MESSAGE = 'Orientação inválida.';
  END IF;
  IF COALESCE(_dpi, 'automatico') NOT IN ('automatico', '203', '300', 'personalizado') THEN
    RAISE EXCEPTION USING ERRCODE = 'BB010', MESSAGE = 'Densidade (DPI) inválida.';
  END IF;
  IF _dpi = 'personalizado' AND (COALESCE(_dpi_personalizado, 0) < 72 OR _dpi_personalizado > 1200) THEN
    RAISE EXCEPTION USING ERRCODE = 'BB010', MESSAGE = 'Informe um DPI personalizado entre 72 e 1200.';
  END IF;
  -- Normalized once so a leftover _dpi_personalizado value from the client
  -- (e.g. the form kept it in local state after switching away from
  -- "personalizado") never trips empresa_bobina_perfis_dpi_personalizado,
  -- which requires the column to be NULL for every other dpi value.
  v_dpi_personalizado := CASE WHEN COALESCE(_dpi, 'automatico') = 'personalizado' THEN _dpi_personalizado ELSE NULL END;

  v_required_width := COALESCE(_margem_esquerda_mm, 0) + (_largura_etiqueta_mm * GREATEST(_colunas, 1))
    + (COALESCE(_espacamento_horizontal_mm, 0) * GREATEST(_colunas - 1, 0)) + COALESCE(_margem_direita_mm, 0);
  IF _largura_midia_mm IS NOT NULL AND _largura_midia_mm > 0 AND v_required_width > _largura_midia_mm + 0.5 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB006',
      MESSAGE = format('As dimensões configuradas ultrapassam a largura da bobina (necessário %s mm, disponível %s mm).',
        round(v_required_width, 1), round(_largura_midia_mm, 1));
  END IF;

  IF _padrao THEN
    UPDATE public.empresa_bobina_perfis SET padrao = false, updated_at = clock_timestamp(), updated_by = auth.uid()
    WHERE empresa_id = v_company_id AND padrao AND ativo AND (_perfil_id IS NULL OR id <> _perfil_id);
  END IF;

  IF _perfil_id IS NULL THEN
    INSERT INTO public.empresa_bobina_perfis (
      empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, colunas,
      espacamento_horizontal_mm, espacamento_vertical_mm,
      margem_esquerda_mm, margem_direita_mm, margem_superior_mm, margem_inferior_mm,
      orientacao, largura_midia_mm, offset_horizontal_mm, offset_vertical_mm,
      dpi, dpi_personalizado, padrao, created_by, updated_by
    ) VALUES (
      v_company_id, btrim(_nome), _largura_etiqueta_mm, _altura_etiqueta_mm, _colunas,
      COALESCE(_espacamento_horizontal_mm, 0), COALESCE(_espacamento_vertical_mm, 0),
      COALESCE(_margem_esquerda_mm, 0), COALESCE(_margem_direita_mm, 0), COALESCE(_margem_superior_mm, 0), COALESCE(_margem_inferior_mm, 0),
      COALESCE(_orientacao, 'retrato'), _largura_midia_mm, COALESCE(_offset_horizontal_mm, 0), COALESCE(_offset_vertical_mm, 0),
      COALESCE(_dpi, 'automatico'), v_dpi_personalizado, COALESCE(_padrao, false), auth.uid(), auth.uid()
    ) RETURNING * INTO v_result;
  ELSE
    SELECT * INTO v_result FROM public.empresa_bobina_perfis
    WHERE empresa_id = v_company_id AND id = _perfil_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'BB007', MESSAGE = 'Perfil de bobina não encontrado.';
    END IF;
    IF _expected_updated_at IS NULL OR v_result.updated_at <> _expected_updated_at THEN
      RAISE EXCEPTION USING ERRCODE = 'BB008', MESSAGE = 'O perfil foi alterado em outra sessão. Recarregue os dados.';
    END IF;
    UPDATE public.empresa_bobina_perfis SET
      nome = btrim(_nome), largura_etiqueta_mm = _largura_etiqueta_mm, altura_etiqueta_mm = _altura_etiqueta_mm,
      colunas = _colunas, espacamento_horizontal_mm = COALESCE(_espacamento_horizontal_mm, 0),
      espacamento_vertical_mm = COALESCE(_espacamento_vertical_mm, 0),
      margem_esquerda_mm = COALESCE(_margem_esquerda_mm, 0), margem_direita_mm = COALESCE(_margem_direita_mm, 0),
      margem_superior_mm = COALESCE(_margem_superior_mm, 0), margem_inferior_mm = COALESCE(_margem_inferior_mm, 0),
      orientacao = COALESCE(_orientacao, 'retrato'), largura_midia_mm = _largura_midia_mm,
      offset_horizontal_mm = COALESCE(_offset_horizontal_mm, 0), offset_vertical_mm = COALESCE(_offset_vertical_mm, 0),
      dpi = COALESCE(_dpi, 'automatico'), dpi_personalizado = v_dpi_personalizado,
      padrao = COALESCE(_padrao, false), ativo = true,
      updated_at = clock_timestamp(), updated_by = auth.uid()
    WHERE empresa_id = v_company_id AND id = _perfil_id
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', CASE WHEN _perfil_id IS NULL THEN 'perfil_bobina_criado' ELSE 'perfil_bobina_atualizado' END,
    'Perfil de bobina salvo (' || v_result.nome || ')', auth.uid(), v_company_id,
    jsonb_build_object('perfil_id', v_result.id, 'nome', v_result.nome, 'colunas', v_result.colunas));

  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE = 'BB009', MESSAGE = 'Já existe um perfil de bobina com esse nome.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.duplicar_perfil_bobina(
  _perfil_id uuid,
  _novo_nome text DEFAULT NULL::text,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS public.empresa_bobina_perfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_source public.empresa_bobina_perfis%ROWTYPE;
  v_result public.empresa_bobina_perfis%ROWTYPE;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  SELECT * INTO v_source FROM public.empresa_bobina_perfis WHERE empresa_id = v_company_id AND id = _perfil_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'BB007', MESSAGE = 'Perfil de bobina não encontrado.';
  END IF;

  v_name := COALESCE(nullif(btrim(_novo_nome), ''), v_source.nome || ' (cópia)');
  IF length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB003', MESSAGE = 'Informe um nome com até 80 caracteres.';
  END IF;

  INSERT INTO public.empresa_bobina_perfis (
    empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, colunas,
    espacamento_horizontal_mm, espacamento_vertical_mm,
    margem_esquerda_mm, margem_direita_mm, margem_superior_mm, margem_inferior_mm,
    orientacao, largura_midia_mm, offset_horizontal_mm, offset_vertical_mm,
    dpi, dpi_personalizado, padrao, ativo, created_by, updated_by
  ) VALUES (
    v_company_id, v_name, v_source.largura_etiqueta_mm, v_source.altura_etiqueta_mm, v_source.colunas,
    v_source.espacamento_horizontal_mm, v_source.espacamento_vertical_mm,
    v_source.margem_esquerda_mm, v_source.margem_direita_mm, v_source.margem_superior_mm, v_source.margem_inferior_mm,
    v_source.orientacao, v_source.largura_midia_mm, v_source.offset_horizontal_mm, v_source.offset_vertical_mm,
    v_source.dpi, v_source.dpi_personalizado, false, true, auth.uid(), auth.uid()
  ) RETURNING * INTO v_result;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', 'perfil_bobina_duplicado', 'Perfil de bobina duplicado (' || v_result.nome || ')', auth.uid(), v_company_id,
    jsonb_build_object('perfil_id', v_result.id, 'origem_id', v_source.id));

  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE = 'BB009', MESSAGE = 'Já existe um perfil de bobina com esse nome.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_perfil_bobina(
  _perfil_id uuid,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_changed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  UPDATE public.empresa_bobina_perfis
  SET ativo = false, padrao = false, updated_at = clock_timestamp(), updated_by = auth.uid()
  WHERE empresa_id = v_company_id AND id = _perfil_id AND ativo;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'BB007', MESSAGE = 'Perfil de bobina não encontrado.';
  END IF;

  -- Soft delete never triggers the FK's ON DELETE SET NULL (the row still
  -- exists, just inactive) - clear the link explicitly so a printer config
  -- never keeps pointing at an inactive profile. Print time already falls
  -- back correctly either way (listar_perfis_bobina excludes inactive rows,
  -- so resolveBobinaProfile on the frontend would resolve to null and the
  -- pipeline falls back to legacyProfileFromModel) - this just keeps the
  -- printer config's own displayed state honest instead of silently stale.
  UPDATE public.empresa_impressora_config
  SET perfil_bobina_padrao_id = NULL, updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND perfil_bobina_padrao_id = _perfil_id;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', 'perfil_bobina_excluido', 'Perfil de bobina excluído', auth.uid(), v_company_id,
    jsonb_build_object('perfil_id', _perfil_id));

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.definir_perfil_bobina_padrao(
  _perfil_id uuid,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS public.empresa_bobina_perfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_result public.empresa_bobina_perfis%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresa_bobina_perfis WHERE empresa_id = v_company_id AND id = _perfil_id AND ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'BB007', MESSAGE = 'Perfil de bobina não encontrado.';
  END IF;

  UPDATE public.empresa_bobina_perfis SET padrao = false, updated_at = clock_timestamp(), updated_by = auth.uid()
  WHERE empresa_id = v_company_id AND padrao AND ativo AND id <> _perfil_id;

  UPDATE public.empresa_bobina_perfis SET padrao = true, updated_at = clock_timestamp(), updated_by = auth.uid()
  WHERE empresa_id = v_company_id AND id = _perfil_id
  RETURNING * INTO v_result;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', 'perfil_bobina_definido_padrao', 'Perfil de bobina definido como padrão (' || v_result.nome || ')', auth.uid(), v_company_id,
    jsonb_build_object('perfil_id', v_result.id));

  RETURN v_result;
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
  _perfil_bobina_padrao_id uuid DEFAULT NULL::uuid,
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
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    OR public.is_master_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram impressoras.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
  END IF;
  IF _perfil_bobina_padrao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.empresa_bobina_perfis
    WHERE id = _perfil_bobina_padrao_id AND empresa_id = v_company_id AND ativo
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'BB007', MESSAGE = 'Perfil de bobina não encontrado.';
  END IF;

  INSERT INTO public.empresa_impressora_config (
    empresa_id, finalidade, nome_impressora, formato, largura_mm, altura_mm,
    orientacao, ativo, configuracoes, perfil_bobina_padrao_id, created_by, updated_by
  ) VALUES (
    v_company_id, _finalidade, nullif(btrim(_nome_impressora), ''), nullif(btrim(_formato), ''),
    _largura_mm, _altura_mm, COALESCE(_orientacao, 'retrato'), COALESCE(_ativo, true),
    COALESCE(_configuracoes, '{}'::jsonb), _perfil_bobina_padrao_id, auth.uid(), auth.uid()
  )
  ON CONFLICT (empresa_id, finalidade) DO UPDATE
  SET nome_impressora = EXCLUDED.nome_impressora,
      formato = EXCLUDED.formato,
      largura_mm = EXCLUDED.largura_mm,
      altura_mm = EXCLUDED.altura_mm,
      orientacao = EXCLUDED.orientacao,
      ativo = EXCLUDED.ativo,
      configuracoes = EXCLUDED.configuracoes,
      perfil_bobina_padrao_id = EXCLUDED.perfil_bobina_padrao_id,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  RETURNING * INTO v_result;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('configuracao', 'impressora_configurada',
    'Configuração de impressora atualizada (' || _finalidade || ')',
    auth.uid(), v_company_id,
    jsonb_build_object('finalidade', _finalidade, 'nome_impressora', v_result.nome_impressora, 'perfil_bobina_padrao_id', v_result.perfil_bobina_padrao_id));

  RETURN v_result;
END;
$function$;
