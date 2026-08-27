-- ============================================================================
-- IMPORTADOR DA AGENDA (FASE 2) - rastreabilidade da origem + import atômico
-- ============================================================================
--
-- Cria a infraestrutura para SALVAR no Backstage a agenda exportada por outro
-- sistema (hoje: Gestão de Eventos Pro, formato "gestao-eventos-backstage"
-- v1), sem duplicar eventos já importados e preservando a identidade da
-- origem para uma futura sincronização bidirecional.
--
--   public.event_import_origins  -> 1 linha por (evento importado, origem).
--                                   events.id continua sendo UUID PRÓPRIO do
--                                   Backstage; o UUID da origem NUNCA vai
--                                   para events - fica só aqui em
--                                   source_event_id (text).
--   importar_agenda_eventos()    -> RPC transacional: para cada evento do
--                                   lote, checa event_import_origins; cria o
--                                   events + a linha de origem só se ainda
--                                   não existir; tudo numa transação (erro
--                                   real = rollback total).
--   listar_eventos_agenda_ja_importados() -> RPC de leitura para a PRÉVIA de
--                                   duplicidades (✓ Novo / ↺ Já importado).
--
-- source_system é GENÉRICO de propósito (valores futuros: 'gestao_eventos_pro',
-- 'backstage_pro', …). O mapeamento format/source -> source_system é feito no
-- frontend (agenda-import.ts) e passado como parâmetro; a tabela e as RPCs
-- não conhecem nenhum sistema específico.
--
-- RLS: mesmo lockdown de user_module_permissions (20260810090000) e
-- push_notifications (20260819090000) - RLS habilitada, ZERO policies, todo
-- acesso de 'authenticated' é por RPC SECURITY DEFINER que resolve a empresa
-- via get_user_empresa_id(auth.uid()) e exige can_write_company_data para
-- escrita. RLS de public.events NÃO é tocada.

-- ----------------------------------------------------------------------------
-- 1. TABELA
-- ----------------------------------------------------------------------------

CREATE TABLE public.event_import_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_import_origins_source_system_not_blank CHECK (btrim(source_system) <> ''),
  CONSTRAINT event_import_origins_source_event_id_not_blank CHECK (btrim(source_event_id) <> ''),
  -- Barreira de deduplicação (e de corrida concorrente): a MESMA empresa não
  -- importa duas vezes o mesmo evento do mesmo sistema de origem.
  CONSTRAINT event_import_origins_unique UNIQUE (empresa_id, source_system, source_event_id)
);

-- Para o CASCADE de events e para "quais origens este evento tem".
CREATE INDEX event_import_origins_event_idx ON public.event_import_origins (event_id);

ALTER TABLE public.event_import_origins ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy: acesso exclusivamente via as RPCs SECURITY DEFINER abaixo.
REVOKE ALL ON TABLE public.event_import_origins FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.event_import_origins IS
  'Rastreabilidade da origem de eventos importados de outro sistema. events.id e sempre UUID proprio do Backstage; o id da origem fica em source_event_id (text). source_system e generico (gestao_eventos_pro, backstage_pro, ...). Acesso so por RPC (importar_agenda_eventos / listar_eventos_agenda_ja_importados).';

-- ----------------------------------------------------------------------------
-- 2. RPC DE LEITURA (prévia de duplicidades)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.listar_eventos_agenda_ja_importados(
  _source_system text,
  _source_event_ids text[]
)
RETURNS TABLE (source_event_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT origin.source_event_id
  FROM public.event_import_origins AS origin
  WHERE origin.empresa_id = public.get_user_empresa_id(auth.uid())
    AND origin.source_system = _source_system
    AND origin.source_event_id = ANY(COALESCE(_source_event_ids, ARRAY[]::text[]))
$$;

REVOKE ALL ON FUNCTION public.listar_eventos_agenda_ja_importados(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_eventos_agenda_ja_importados(text, text[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC DE IMPORTAÇÃO (atômica)
-- ----------------------------------------------------------------------------
--
-- _eventos: jsonb array; cada item já NORMALIZADO pelo frontend:
--   { source_event_id, name, date (YYYY-MM-DD), artist|null, city|null,
--     venue|null, show_time (HH:MM:SS)|null, status
--     ('confirmado'|'pendente'|'cancelado'), observations|null }
--
-- Retorna { "imported": N, "skipped": M }.
--
-- Regras:
--  * valida empresa/usuário (can_write_company_data);
--  * por evento: se já existe em event_import_origins (empresa+source_system+
--    source_event_id) -> skipped, NÃO cria outro events;
--  * senão -> gera novo events.id, INSERT em events, INSERT em
--    event_import_origins apontando para ele;
--  * cada par de INSERTs roda num sub-bloco: unique_violation (corrida com
--    outra importação simultânea do mesmo evento) faz savepoint-rollback do
--    par e conta como skipped, sem abortar o lote;
--  * QUALQUER outro erro (data inválida, status inválido, limite de plano do
--    trigger check_event_limit, RLS, etc.) propaga e a transação inteira faz
--    rollback - nunca fica "metade importado";
--  * logistics_departure é gravado SEMPRE NULL nesta versão (a saída logística
--    vai preservada dentro de observations; sem regra de fuso definida para
--    montar o timestamptz a partir de arquivo importado).
CREATE OR REPLACE FUNCTION public.importar_agenda_eventos(
  _source_system text,
  _eventos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_empresa_id uuid;
  v_actor uuid := auth.uid();
  v_event jsonb;
  v_source_event_id text;
  v_name text;
  v_date date;
  v_status public.event_status;
  v_new_event_id uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;

  v_empresa_id := public.get_user_empresa_id(v_actor);
  IF v_empresa_id IS NULL OR NOT public.can_write_company_data(v_empresa_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Voce nao tem permissao para importar eventos nesta empresa.';
  END IF;

  IF nullif(btrim(_source_system), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'source_system e obrigatorio.';
  END IF;
  IF _eventos IS NULL OR jsonb_typeof(_eventos) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = '_eventos deve ser um array JSON.';
  END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(_eventos) AS element(value)
  LOOP
    v_source_event_id := nullif(btrim(v_event->>'source_event_id'), '');
    v_name := nullif(btrim(v_event->>'name'), '');
    IF v_source_event_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Evento do lote sem source_event_id.';
    END IF;
    IF v_name IS NULL OR nullif(btrim(v_event->>'date'), '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('Evento %s do lote sem name/date.', v_source_event_id);
    END IF;

    -- Já importado por esta empresa (dedupe determinística, não por name/date).
    IF EXISTS (
      SELECT 1 FROM public.event_import_origins AS origin
      WHERE origin.empresa_id = v_empresa_id
        AND origin.source_system = _source_system
        AND origin.source_event_id = v_source_event_id
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_date := (v_event->>'date')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('Data invalida no evento %s: %s', v_source_event_id, v_event->>'date');
    END;

    BEGIN
      v_status := (v_event->>'status')::public.event_status;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('Status invalido no evento %s: %s', v_source_event_id, v_event->>'status');
    END;
    IF v_status NOT IN ('confirmado', 'pendente', 'cancelado') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('Status nao suportado na importacao (%s) no evento %s', v_status, v_source_event_id);
    END IF;

    v_new_event_id := gen_random_uuid();

    BEGIN
      INSERT INTO public.events (
        id, empresa_id, name, date, artist, city, venue, show_time,
        status, num_days, observations, logistics_departure, material_list, created_by
      ) VALUES (
        v_new_event_id,
        v_empresa_id,
        v_name,
        v_date,
        nullif(btrim(v_event->>'artist'), ''),
        nullif(btrim(v_event->>'city'), ''),
        nullif(btrim(v_event->>'venue'), ''),
        nullif(btrim(v_event->>'show_time'), '')::time,
        v_status,
        1,
        nullif(btrim(v_event->>'observations'), ''),
        NULL,
        NULL,
        v_actor
      );

      INSERT INTO public.event_import_origins (
        empresa_id, event_id, source_system, source_event_id
      ) VALUES (
        v_empresa_id, v_new_event_id, _source_system, v_source_event_id
      );

      v_imported := v_imported + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Corrida: outra importação simultânea já registrou esta origem. O
      -- savepoint implícito deste sub-bloco desfaz o INSERT em events também.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.importar_agenda_eventos(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.importar_agenda_eventos(text, jsonb) TO authenticated;
