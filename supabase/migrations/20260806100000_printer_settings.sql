-- ============================================================================
-- CONFIGURAÇÃO CANÔNICA DE IMPRESSÃO
-- ============================================================================
--
-- Auditoria prévia: não existia nenhuma tabela de configuração de
-- impressora. Infraestrutura de impressão já reutilizável e mantida como
-- está (não duplicada): jsPDF + smartSavePDF/smartSavePNG (src/lib/pdf-save.ts),
-- addBrandingHeader (src/lib/pdf-branding.ts) para documentos/relatórios A4;
-- o padrão de popup + @page CSS + window.print() já usado em
-- src/lib/material-label-print.tsx para etiquetas. O app roda como Tauri
-- (src-tauri/ existe, isTauri() já definido em
-- src/features/update/UpdateService.ts), mas só com tauri-plugin-log - não
-- há plugin de impressão nativa instalado, então NÃO existe hoje seleção
-- silenciosa de impressora nem enumeração real de impressoras, nem em
-- desktop. A tabela abaixo grava a PREFERÊNCIA/apelido e o formato padrão
-- por finalidade; a escolha real do driver/impressora do SO continua
-- acontecendo na janela de impressão do navegador (ou do webview, no
-- desktop) - isso é limitação de plataforma, não do desenho.
--
-- Não é module-gated: configuração de impressão é administrativa geral,
-- não uma feature paga - RLS usa can_read_company_data/can_write_company_data
-- (mesmos wrappers canônicos, sem chamar helpers privados diretamente).

CREATE TABLE public.empresa_impressora_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  finalidade text NOT NULL CHECK (finalidade IN ('etiqueta', 'cupom', 'documento')),
  nome_impressora text,
  formato text,
  largura_mm numeric(6, 2),
  altura_mm numeric(6, 2),
  orientacao text NOT NULL DEFAULT 'retrato' CHECK (orientacao IN ('retrato', 'paisagem')),
  ativo boolean NOT NULL DEFAULT true,
  configuracoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_impressora_config_finalidade_unica
    UNIQUE (empresa_id, finalidade)
);

ALTER TABLE public.empresa_impressora_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da empresa (um "usuario" pode precisar saber o
-- formato configurado para imprimir corretamente, mesmo sem poder alterar).
CREATE POLICY "Company members read printer config"
ON public.empresa_impressora_config FOR SELECT TO authenticated
USING (can_read_company_data(empresa_id));

-- Escrita: só admin_empresa/master, via can_write_company_data (já exige
-- has_role admin_empresa internamente - não repito a checagem aqui).
CREATE POLICY "Company admins write printer config"
ON public.empresa_impressora_config FOR ALL TO authenticated
USING (can_write_company_data(empresa_id))
WITH CHECK (can_write_company_data(empresa_id));

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
  IF public.is_master_admin(auth.uid()) THEN
    IF _empresa_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PR001', MESSAGE = 'Selecione a empresa.';
    END IF;
    v_company_id := _empresa_id;
  ELSE
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL OR (_empresa_id IS NOT NULL AND _empresa_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
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

GRANT EXECUTE ON FUNCTION public.obter_configuracoes_impressora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_configuracao_impressora(text, text, text, numeric, numeric, text, boolean, jsonb, uuid) TO authenticated;
