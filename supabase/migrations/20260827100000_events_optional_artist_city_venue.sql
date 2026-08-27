-- ============================================================================
-- AGENDA: artist, city e venue deixam de ser obrigatorios em public.events
-- ============================================================================
--
-- Passam a aceitar NULL para permitir cadastrar um evento sabendo apenas o
-- nome e a data (caso comum: reserva de data antes de fechar artista, cidade
-- ou local). Nenhum placeholder e persistido - "A definir" fica so na camada
-- de renderizacao/exportacao.
--
-- Escopo desta migration: SOMENTE
--   1. remover NOT NULL de events.artist / events.city / events.venue;
--   2. ajustar 1 gatilho que quebra explicitamente quando city e NULL.
--
-- NAO altera: enum event_status, RLS/policies, dados existentes, nenhuma
-- outra coluna, nenhum outro gatilho. `date` e `name` continuam NOT NULL.
--
-- DROP NOT NULL e uma mudanca so de catalogo (sem rewrite, sem scan) - segura
-- e instantanea mesmo em tabela grande.

ALTER TABLE public.events ALTER COLUMN artist DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN city   DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN venue  DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- Gatilho notificar_evento_criado() (definido em
-- 20260819090000_push_notifications_foundation.sql).
--
-- A mensagem da notificacao concatenava NEW.city diretamente:
--   NEW.name || ' · ' || to_char(NEW.date,'DD/MM/YYYY') || ' · ' || NEW.city
-- Em SQL, `texto || NULL` => NULL, entao com city NULL a expressao inteira
-- vira NULL. criar_notificacao() rejeita _mensagem NULL (ERRCODE 22023) e,
-- como este trigger e AFTER INSERT e NAO tem EXCEPTION WHEN OTHERS, a excecao
-- abortaria o proprio INSERT do evento.
--
-- Correcao minima: a cidade entra na mensagem apenas quando existir, via
-- COALESCE(' · ' || NEW.city, ''). name e date seguem NOT NULL, entao a base
-- da mensagem nunca e nula. Nenhuma outra mudanca na logica de push.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificar_evento_criado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'operacional',
    _tipo => 'evento_criado',
    _titulo => 'Novo evento criado',
    _mensagem => NEW.name || ' · ' || to_char(NEW.date, 'DD/MM/YYYY')
                 || COALESCE(' · ' || NEW.city, ''),
    _referencia_tipo => 'evento',
    _referencia_id => NEW.id,
    _rota => '/evento/' || NEW.id,
    _dedupe_key => 'evento_criado:' || NEW.id,
    _criado_por => NEW.created_by
  );
  RETURN NEW;
END;
$$;
