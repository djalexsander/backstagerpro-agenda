-- ============================================================================
-- PERFIS DE BOBINA / ETIQUETA (configuração genérica, multi-impressora)
-- ============================================================================
--
-- Contexto: a impressão de etiquetas (src/lib/material-label-print.tsx) hoje
-- imprime cada etiqueta ocupando uma página inteira (1 etiqueta por vez, sem
-- suporte a múltiplas colunas), e o tamanho físico vem do MODELO de etiqueta
-- (etiqueta_modelos.largura_mm/altura_mm - conteúdo), não de uma
-- configuração de mídia/bobina. empresa_impressora_config (migration
-- 20260806100000) guarda apenas UMA largura/altura por finalidade, sem
-- colunas, gaps, margens, offsets ou DPI - insuficiente para bobinas
-- multi-coluna de qualquer impressora/tamanho.
--
-- Esta migration adiciona "perfis de bobina": configuração de mídia
-- reutilizável, independente de marca/modelo de impressora, com N colunas,
-- espaçamentos, margens, largura de mídia (para validação), offsets de
-- calibração e DPI. empresa_impressora_config (finalidade='etiqueta') passa
-- a referenciar um perfil default via perfil_bobina_padrao_id - a mesma
-- impressora pode trocar de perfil (troca de bobina) sem precisar reeditar a
-- impressora. Nada aqui assume um fabricante ou tamanho específico; todos os
-- valores são fornecidos pelo usuário. Cálculo de layout fica inteiramente
-- no frontend (src/lib/label-layout-engine.ts), que é a única fonte de
-- verdade para geometria - este schema só guarda os números.
--
-- Compatibilidade: nenhuma configuração existente é apagada. Ao final desta
-- migration, toda empresa_impressora_config(finalidade='etiqueta') que já
-- tinha largura_mm/altura_mm ganha um perfil de bobina de 1 coluna migrado
-- automaticamente a partir desses valores, marcado como padrão e já
-- vinculado - o comportamento físico impresso não muda para quem já usava o
-- sistema. Empresas sem configuração prévia simplesmente não recebem perfil
-- nenhum; o pipeline de impressão cai para um perfil de 1 coluna sintetizado
-- a partir do próprio modelo de etiqueta em tempo de impressão
-- (legacyProfileFromModel), então imprimir continua funcionando mesmo sem
-- nenhum perfil cadastrado.

CREATE TABLE public.empresa_bobina_perfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  nome text NOT NULL,
  largura_etiqueta_mm numeric(7, 2) NOT NULL,
  altura_etiqueta_mm numeric(7, 2) NOT NULL,
  colunas integer NOT NULL DEFAULT 1,
  espacamento_horizontal_mm numeric(6, 2) NOT NULL DEFAULT 0,
  espacamento_vertical_mm numeric(6, 2) NOT NULL DEFAULT 0,
  margem_esquerda_mm numeric(6, 2) NOT NULL DEFAULT 0,
  margem_direita_mm numeric(6, 2) NOT NULL DEFAULT 0,
  margem_superior_mm numeric(6, 2) NOT NULL DEFAULT 0,
  margem_inferior_mm numeric(6, 2) NOT NULL DEFAULT 0,
  orientacao text NOT NULL DEFAULT 'retrato' CHECK (orientacao IN ('retrato', 'paisagem')),
  largura_midia_mm numeric(7, 2),
  offset_horizontal_mm numeric(6, 2) NOT NULL DEFAULT 0,
  offset_vertical_mm numeric(6, 2) NOT NULL DEFAULT 0,
  dpi text NOT NULL DEFAULT 'automatico' CHECK (dpi IN ('automatico', '203', '300', 'personalizado')),
  dpi_personalizado integer,
  padrao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_bobina_perfis_nome_not_blank CHECK (btrim(nome) <> ''),
  CONSTRAINT empresa_bobina_perfis_largura_etiqueta CHECK (largura_etiqueta_mm > 0 AND largura_etiqueta_mm <= 500),
  CONSTRAINT empresa_bobina_perfis_altura_etiqueta CHECK (altura_etiqueta_mm > 0 AND altura_etiqueta_mm <= 1000),
  CONSTRAINT empresa_bobina_perfis_colunas CHECK (colunas BETWEEN 1 AND 20),
  CONSTRAINT empresa_bobina_perfis_espacamentos CHECK (espacamento_horizontal_mm >= 0 AND espacamento_vertical_mm >= 0),
  CONSTRAINT empresa_bobina_perfis_margens CHECK (
    margem_esquerda_mm >= 0 AND margem_direita_mm >= 0 AND margem_superior_mm >= 0 AND margem_inferior_mm >= 0
  ),
  CONSTRAINT empresa_bobina_perfis_largura_midia CHECK (largura_midia_mm IS NULL OR largura_midia_mm > 0),
  CONSTRAINT empresa_bobina_perfis_dpi_personalizado CHECK (
    (dpi <> 'personalizado' AND dpi_personalizado IS NULL)
    OR (dpi = 'personalizado' AND dpi_personalizado BETWEEN 72 AND 1200)
  ),
  -- Validação matemática do requisito "As dimensões configuradas
  -- ultrapassam a largura da bobina": margem esquerda + (largura * colunas)
  -- + gaps horizontais + margem direita <= largura da mídia. Espelha
  -- validateBobinaProfile/computeRequiredWidthMm em
  -- src/lib/label-layout-engine.ts (mesma tolerância de 0.5mm para
  -- arredondamento) - defesa em profundidade, a validação primária roda no
  -- formulário antes de chegar aqui.
  CONSTRAINT empresa_bobina_perfis_cabe_na_midia CHECK (
    largura_midia_mm IS NULL OR
    (margem_esquerda_mm + (largura_etiqueta_mm * colunas) + (espacamento_horizontal_mm * GREATEST(colunas - 1, 0)) + margem_direita_mm)
      <= largura_midia_mm + 0.5
  )
);

CREATE UNIQUE INDEX empresa_bobina_perfis_empresa_nome_uidx
  ON public.empresa_bobina_perfis (empresa_id, lower(btrim(nome)));
CREATE UNIQUE INDEX empresa_bobina_perfis_empresa_default_uidx
  ON public.empresa_bobina_perfis (empresa_id) WHERE padrao AND ativo;
CREATE INDEX empresa_bobina_perfis_empresa_ativo_idx
  ON public.empresa_bobina_perfis (empresa_id, ativo, nome);

ALTER TABLE public.empresa_bobina_perfis ENABLE ROW LEVEL SECURITY;

-- Mesma política de leitura/escrita de empresa_impressora_config (a tabela
-- que este perfil estende): qualquer membro lê, só admin_empresa/master
-- escreve.
CREATE POLICY "Company members read bobina profiles"
ON public.empresa_bobina_perfis FOR SELECT TO authenticated
USING (can_read_company_data(empresa_id));

CREATE POLICY "Company admins write bobina profiles"
ON public.empresa_bobina_perfis FOR ALL TO authenticated
USING (can_write_company_data(empresa_id))
WITH CHECK (can_write_company_data(empresa_id));

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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BB001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BB001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BB001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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

-- Soft delete, como etiqueta_modelos/inativar_modelo_etiqueta: preserva o
-- histórico/vínculo em empresa_impressora_config.perfil_bobina_padrao_id
-- (ON DELETE SET NULL nunca dispara para um soft delete) e evita reaproveitar
-- o mesmo id para outra bobina por engano.
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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BB001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'BB001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram perfis de bobina.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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

REVOKE ALL ON FUNCTION public.listar_perfis_bobina(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.salvar_perfil_bobina(text,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,text,integer,boolean,uuid,timestamptz,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.duplicar_perfil_bobina(uuid,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.excluir_perfil_bobina(uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.definir_perfil_bobina_padrao(uuid,uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.listar_perfis_bobina(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_perfil_bobina(text,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,text,integer,boolean,uuid,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicar_perfil_bobina(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_perfil_bobina(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_perfil_bobina_padrao(uuid,uuid) TO authenticated;

-- ============================================================================
-- Vincular a impressora de etiquetas a um perfil de bobina (opcional, trocável)
-- ============================================================================

ALTER TABLE public.empresa_impressora_config
  ADD COLUMN perfil_bobina_padrao_id uuid REFERENCES public.empresa_bobina_perfis(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.empresa_impressora_config.perfil_bobina_padrao_id IS
  'Perfil de bobina atualmente carregado na impressora de etiquetas (finalidade=etiqueta). Trocável a qualquer momento - a mesma impressora pode usar bobinas diferentes ao longo do tempo, por isso não é um vínculo permanente.';

-- obter_configuracoes_impressora não precisa mudar: RETURNS SETOF do tipo da
-- tabela reflete a coluna nova automaticamente. salvar_configuracao_impressora
-- precisa de um parâmetro novo, o que muda sua assinatura (lista de tipos) -
-- CREATE OR REPLACE não substitui a versão antiga nesse caso (viraria uma
-- sobrecarga ambígua para o PostgREST), então a antiga é removida primeiro.
DROP FUNCTION IF EXISTS public.salvar_configuracao_impressora(text, text, text, numeric, numeric, text, boolean, jsonb, uuid);

CREATE FUNCTION public.salvar_configuracao_impressora(
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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PR001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa configuram impressoras.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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

REVOKE ALL ON FUNCTION public.salvar_configuracao_impressora(text, text, text, numeric, numeric, text, boolean, jsonb, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.salvar_configuracao_impressora(text, text, text, numeric, numeric, text, boolean, jsonb, uuid, uuid) TO authenticated;

-- ============================================================================
-- Migração de compatibilidade: nenhuma configuração existente é apagada.
-- ============================================================================

DO $$
DECLARE
  v_row record;
  v_new_id uuid;
BEGIN
  FOR v_row IN
    SELECT id, empresa_id, largura_mm, altura_mm
    FROM public.empresa_impressora_config
    WHERE finalidade = 'etiqueta' AND largura_mm IS NOT NULL AND altura_mm IS NOT NULL
      AND largura_mm > 0 AND altura_mm > 0
  LOOP
    INSERT INTO public.empresa_bobina_perfis (
      empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm, colunas, padrao, ativo
    ) VALUES (
      v_row.empresa_id,
      v_row.largura_mm::text || 'x' || v_row.altura_mm::text || 'mm - 1 coluna (migrado)',
      v_row.largura_mm, v_row.altura_mm, 1, true, true
    )
    RETURNING id INTO v_new_id;

    UPDATE public.empresa_impressora_config
    SET perfil_bobina_padrao_id = v_new_id
    WHERE id = v_row.id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'public.listar_perfis_bobina(uuid)'::regprocedure,
    'public.salvar_perfil_bobina(text,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,text,integer,boolean,uuid,timestamptz,uuid)'::regprocedure,
    'public.duplicar_perfil_bobina(uuid,text,uuid)'::regprocedure,
    'public.excluir_perfil_bobina(uuid,uuid)'::regprocedure,
    'public.definir_perfil_bobina_padrao(uuid,uuid)'::regprocedure,
    'public.salvar_configuracao_impressora(text,text,text,numeric,numeric,text,boolean,jsonb,uuid,uuid)'::regprocedure
  ];
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN140',
        MESSAGE = format('Hardening falhou: %s executavel por anon.', v_fn);
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN141',
        MESSAGE = format('%s nao esta executavel por authenticated.', v_fn);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON TABLE public.empresa_bobina_perfis IS
  'Perfis de bobina/mídia de etiqueta, genéricos e reutilizáveis por qualquer impressora Windows configurada (nenhuma regra específica de fabricante). Fonte de dados para o motor de layout em src/lib/label-layout-engine.ts.';
