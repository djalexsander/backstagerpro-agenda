-- ============================================================================
-- IMPORTADOR DA AGENDA (FASE 2 - correção): campos próprios + event_days
-- ============================================================================
--
-- O teste real revelou dois problemas na RPC importar_agenda_eventos:
--
--   1. Só `public.events` era criado. O EventForm carrega os dias de
--      `public.event_days`; sem a linha do Dia 1, "Dias do Evento" abre vazio
--      na edição. Correção: a RPC passa a criar também `event_days` (Dia 1),
--      com a mesma forma de um evento criado pelo EventForm.
--
--   2. setup_time / staff_notes / state (UF) / contratante_* eram jogados como
--      texto dentro de `events.observations`. Agora ganham COLUNAS PRÓPRIAS
--      opcionais em `public.events` e a RPC mapeia direto. `events.observations`
--      volta a receber só a observação geral (`notes`).
--
-- Tudo (events + event_days + event_import_origins) segue na MESMA transação
-- da RPC; qualquer falha real = rollback total. A deduplicação
-- (empresa_id + source_system + source_event_id) NÃO muda.
--
-- setup_time como `text` (não `time`): a origem (Gestão de Eventos Pro) guarda
-- setup_time como texto livre (`text NOT NULL DEFAULT ''`), então um `time`
-- estrito rejeitaria/perderia valores fora de "HH:MM". `text` é sem perda; o
-- formulário usa um campo de texto com dica "Ex.: 14:00".
--
-- logistics_departure: reutiliza a MESMA regra ingênua já usada pelo EventForm
-- (input datetime-local -> string "YYYY-MM-DDTHH:MM[:SS]" -> ::timestamptz, sem
-- conversão de fuso). A função fixa `SET timezone = 'UTC'` para o cast ser
-- determinístico (mesmo fuso que o PostgREST usa por padrão nos INSERTs
-- manuais). Só quando há data E hora de saída; caso contrário fica NULL (e, se
-- houver só a data, ela é preservada numa linha em observations - único dado
-- sem coluna equivalente).

-- ----------------------------------------------------------------------------
-- 1. NOVOS CAMPOS EM public.events (todos opcionais, sem default de texto)
-- ----------------------------------------------------------------------------

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS setup_time text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS staff_notes text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS contratante_nome text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS contratante_cidade text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS contratante_telefone text;

COMMENT ON COLUMN public.events.state IS 'UF do evento (opcional). Preenchida na importação; editável no EventForm.';
COMMENT ON COLUMN public.events.setup_time IS 'Horário de montagem (texto livre; a origem não usa tipo time).';
COMMENT ON COLUMN public.events.staff_notes IS 'Informações para a equipe (opcional).';
COMMENT ON COLUMN public.events.contratante_nome IS 'Contratante do evento (opcional).';
COMMENT ON COLUMN public.events.contratante_cidade IS 'Cidade do contratante (opcional).';
COMMENT ON COLUMN public.events.contratante_telefone IS 'Telefone do contratante (opcional).';

-- ----------------------------------------------------------------------------
-- 2. RPC importar_agenda_eventos - nova versão
-- ----------------------------------------------------------------------------
--
-- _eventos: jsonb array; cada item JÁ NORMALIZADO pelo frontend:
--   { source_event_id, name, date, artist|null, city|null, venue|null,
--     show_time (HH:MM:SS)|null, status ('confirmado'|'pendente'|'cancelado'),
--     state|null, setup_time|null, staff_notes|null,
--     contratante_nome|null, contratante_cidade|null, contratante_telefone|null,
--     logistics_departure ("YYYY-MM-DDTHH:MM:SS")|null, observations|null }
--
-- Retorna { "imported": N, "skipped": M }.
CREATE OR REPLACE FUNCTION public.importar_agenda_eventos(
  _source_system text,
  _eventos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $$
DECLARE
  v_empresa_id uuid;
  v_actor uuid := auth.uid();
  v_event jsonb;
  v_source_event_id text;
  v_name text;
  v_date date;
  v_status public.event_status;
  v_artist text;
  v_show_time time;
  v_logistics timestamptz;
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

    v_artist := nullif(btrim(v_event->>'artist'), '');

    BEGIN
      v_show_time := nullif(btrim(v_event->>'show_time'), '')::time;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('show_time invalido no evento %s: %s',
                         v_source_event_id, v_event->>'show_time');
    END;

    BEGIN
      v_logistics := nullif(btrim(v_event->>'logistics_departure'), '')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('logistics_departure invalido no evento %s: %s',
                         v_source_event_id, v_event->>'logistics_departure');
    END;

    v_new_event_id := gen_random_uuid();

    BEGIN
      INSERT INTO public.events (
        id, empresa_id, name, date, artist, city, venue, show_time,
        status, num_days, observations, logistics_departure, material_list, created_by,
        state, setup_time, staff_notes,
        contratante_nome, contratante_cidade, contratante_telefone
      ) VALUES (
        v_new_event_id,
        v_empresa_id,
        v_name,
        v_date,
        v_artist,
        nullif(btrim(v_event->>'city'), ''),
        nullif(btrim(v_event->>'venue'), ''),
        v_show_time,
        v_status,
        1,
        nullif(btrim(v_event->>'observations'), ''),
        v_logistics,
        NULL,
        v_actor,
        nullif(btrim(v_event->>'state'), ''),
        nullif(btrim(v_event->>'setup_time'), ''),
        nullif(btrim(v_event->>'staff_notes'), ''),
        nullif(btrim(v_event->>'contratante_nome'), ''),
        nullif(btrim(v_event->>'contratante_cidade'), ''),
        nullif(btrim(v_event->>'contratante_telefone'), '')
      );

      -- Dia 1: mesma estrutura mínima que reconcileEventDays grava para um
      -- evento novo do EventForm (artist como '' quando ausente; date/show_time
      -- espelham o evento; observations do dia começa NULL).
      INSERT INTO public.event_days (
        event_id, empresa_id, day_number, date, artist, show_time, observations
      ) VALUES (
        v_new_event_id, v_empresa_id, 1, v_date, COALESCE(v_artist, ''), v_show_time, NULL
      );

      INSERT INTO public.event_import_origins (
        empresa_id, event_id, source_system, source_event_id
      ) VALUES (
        v_empresa_id, v_new_event_id, _source_system, v_source_event_id
      );

      v_imported := v_imported + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Corrida: outra importação simultânea já registrou esta origem. O
      -- savepoint implícito deste sub-bloco desfaz events + event_days também.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.importar_agenda_eventos(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.importar_agenda_eventos(text, jsonb) TO authenticated;
