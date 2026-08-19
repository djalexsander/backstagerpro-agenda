-- ============================================================================
-- PUSH NOTIFICATIONS (PWA) - fundacao server-authoritative
-- ============================================================================
--
-- Nao existia nenhuma central de notificacoes persistida por empresa antes
-- desta migration: NotificacoesEmpresa.tsx computava tudo em memoria a partir
-- de events/empresas a cada render (nada gravado, sem lida/nao-lida). A unica
-- tabela existente com "notificacoes" no nome e notificacoes_master, que e do
-- Master (SaaS) sobre vencimento de plano das empresas - dominio diferente,
-- nao estendida aqui. Esta migration cria a central de notificacoes DA
-- EMPRESA (sino) e a infraestrutura de Web Push por cima dela.
--
-- Arquitetura (server-authoritative, nunca so-frontend):
--   operacao real (RPC ja SECURITY DEFINER, ou INSERT direto em events)
--   -> criar_notificacao() grava 1 linha em notificacoes (dedupe por
--      empresa_id+dedupe_key via unique index parcial + ON CONFLICT DO
--      NOTHING) e faz fan-out para notificacoes_destinatarios (1 linha por
--      destinatario elegivel, respeitando papel/permissao granular e
--      preferencia do usuario)
--   -> dispatch_push_for_notification() dispara 1 chamada assincrona
--      (pg_net) para a Edge Function send-push-notification, que envia o Web
--      Push de fato (fora desta transacao - falha de push nunca desfaz a
--      operacao de negocio, ver EXCEPTION WHEN OTHERS ali)
--   -> Realtime (fora do escopo desta migration) pode atualizar o sino a
--      partir de notificacoes_destinatarios como qualquer outra tabela
--   -> usuario toca a notificacao -> abre notificacoes.rota (deep-link)
--
-- Fan-out (em criar_notificacao) usa empresa_usuarios.perfil (projecao ja
-- sincronizada do papel canonico - ver 20260729180000) e, para "usuario" em
-- notificacao operacional gated por modulo, consulta user_module_permissions
-- diretamente pelo user_id de CADA destinatario. Isso e deliberadamente
-- diferente de chamar user_has_module_action(): aquela funcao resolve
-- permissao do CALLER via auth.uid() (self-read), nao de um user_id arbitrario
-- - nao serve para decidir fan-out para outras pessoas. Notificacao
-- financeira nunca depende de user_module_permissions: e sempre
-- admin_empresa/master_admin, por papel, igual ao resto do modulo financeiro
-- (financeiro_lancamentos ja e admin-only mesmo pra leitura).
--
-- Nenhuma tabela nova e module_catalog-gated: notificacoes/push sao um
-- recurso transversal (nao um addon comercial), entao "esta empresa pode
-- receber notificacao do tipo X" depende so do modulo operacional relacionado
-- (locacao_materiais, checkin_checkout, manutencao_equipamentos) ja estar
-- ativo - o que e garantido pelas proprias RPCs de negocio que geram o evento
-- (elas ja recusam operar com o modulo inativo).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1. TABELAS
-- ============================================================================

-- Um dispositivo (endpoint de push) por vez. endpoint e globalmente unico
-- (gerado pelo push service do navegador) - em dispositivo compartilhado, o
-- 2o usuario que ativa push reaproveita o MESMO endpoint (o browser so cria
-- um novo apos unsubscribe explicito), entao registrar_push_subscription usa
-- UPSERT por endpoint (reatribui empresa/usuario) em vez de rejeitar como
-- duplicata.
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  ativo boolean NOT NULL DEFAULT true,
  falhas_consecutivas integer NOT NULL DEFAULT 0,
  ultima_falha_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_not_blank CHECK (btrim(endpoint) <> ''),
  CONSTRAINT push_subscriptions_p256dh_not_blank CHECK (btrim(p256dh) <> ''),
  CONSTRAINT push_subscriptions_auth_not_blank CHECK (btrim(auth) <> ''),
  CONSTRAINT push_subscriptions_falhas_nonnegative CHECK (falhas_consecutivas >= 0)
);
CREATE INDEX push_subscriptions_user_idx
  ON public.push_subscriptions (user_id) WHERE ativo = true;
CREATE INDEX push_subscriptions_empresa_idx
  ON public.push_subscriptions (empresa_id) WHERE ativo = true;

-- Uma linha por evento logico da empresa (nao por destinatario - o fan-out
-- vive em notificacoes_destinatarios). dedupe_key e opcional: gatilhos sobre
-- tabelas de log append-only (material_locacao_eventos e irmas) usam
-- dominio:id da propria linha de origem (defesa barata, o log ja e
-- exactly-once por natureza); as varreduras baseadas em tempo do
-- check-vencimentos usam dominio:entidade:data (mesmo padrao ja usado por
-- notificacoes_master.tipo+created_at, so que como unique index em vez de
-- SELECT-then-INSERT, o que fecha a race condition que aquele padrao tinha).
CREATE TABLE public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN ('operacional', 'financeiro')),
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  referencia_tipo text,
  referencia_id uuid,
  rota text,
  dedupe_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificacoes_tipo_not_blank CHECK (btrim(tipo) <> ''),
  CONSTRAINT notificacoes_titulo_not_blank CHECK (btrim(titulo) <> ''),
  CONSTRAINT notificacoes_mensagem_not_blank CHECK (btrim(mensagem) <> ''),
  CONSTRAINT notificacoes_referencia_shape CHECK (
    (referencia_tipo IS NULL AND referencia_id IS NULL)
    OR (nullif(btrim(referencia_tipo), '') IS NOT NULL AND referencia_id IS NOT NULL)
  )
);
-- Arbitro de ON CONFLICT em criar_notificacao(); parcial porque a maioria das
-- chamadas nao tem (nem precisa de) dedupe_key.
CREATE UNIQUE INDEX notificacoes_empresa_dedupe_uidx
  ON public.notificacoes (empresa_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notificacoes_empresa_created_idx
  ON public.notificacoes (empresa_id, created_at DESC, id DESC);

-- Fan-out: 1 linha por (notificacao, destinatario). Guarda lida/nao-lida (o
-- sino) e o status de entrega do push desse destinatario especifico - um
-- destinatario sem nenhum push_subscriptions ativo ainda ganha sua linha
-- aqui (push_status='sem_dispositivo'), entao a notificacao interna nunca
-- depende de push ter funcionado.
CREATE TABLE public.notificacoes_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid NOT NULL REFERENCES public.notificacoes(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  push_status text NOT NULL DEFAULT 'pendente'
    CHECK (push_status IN ('pendente', 'enviado', 'falhou', 'sem_dispositivo', 'desabilitado')),
  push_tentativas integer NOT NULL DEFAULT 0,
  push_processado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificacoes_destinatarios_unique UNIQUE (notificacao_id, user_id),
  CONSTRAINT notificacoes_destinatarios_lida_shape CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  )
);
CREATE INDEX notificacoes_destinatarios_user_idx
  ON public.notificacoes_destinatarios (user_id, lida, created_at DESC);
CREATE INDEX notificacoes_destinatarios_pending_push_idx
  ON public.notificacoes_destinatarios (notificacao_id) WHERE push_status = 'pendente';

-- Ausencia de linha = default (operacional ligado p/ elegivel, financeiro
-- ligado p/ admin/dono elegivel - a propria elegibilidade ja e decidida em
-- criar_notificacao). Uma linha aqui e sempre um override explicito do
-- usuario. Evita ter que fazer backfill de 1 linha por usuario por tipo.
CREATE TABLE public.notificacao_preferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  habilitada boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificacao_preferencias_unique UNIQUE (empresa_id, user_id, tipo),
  CONSTRAINT notificacao_preferencias_tipo_not_blank CHECK (btrim(tipo) <> '')
);

-- Config server-to-server minima (URL + segredo compartilhado da Edge
-- Function de envio). Sem policy nenhuma e sem GRANT pra nenhum papel,
-- incluindo service_role - so uma SECURITY DEFINER function dona da tabela
-- le. Ver comentario da tabela para o passo manual de configuracao pos-deploy.
CREATE TABLE public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_secrets_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT app_secrets_value_not_blank CHECK (btrim(value) <> '')
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes_destinatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_preferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- Nenhuma das 5 tabelas tem policy de RLS: todo acesso de "authenticated" e
-- por RPC SECURITY DEFINER (secao 3), mesmo padrao ja estabelecido em
-- user_module_permissions (20260810090000). service_role recebe GRANT direto
-- só nas 2 tabelas que a Edge Function de envio precisa ler/atualizar.
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notificacoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notificacoes_destinatarios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notificacao_preferencias FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.app_secrets FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, UPDATE ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT ON TABLE public.notificacoes TO service_role;
GRANT SELECT, UPDATE ON TABLE public.notificacoes_destinatarios TO service_role;

COMMENT ON TABLE public.app_secrets IS
  'Config minima server-to-server (hoje: push_dispatch_url e push_dispatch_secret usados por dispatch_push_for_notification). Sem RLS policy e sem GRANT pra nenhum papel - configurar manualmente apos o deploy da Edge Function send-push-notification, ex.: insert into public.app_secrets (key, value) values (''push_dispatch_url'', ''https://<project-ref>.supabase.co/functions/v1/send-push-notification''), (''push_dispatch_secret'', ''<mesmo valor do secret PUSH_DISPATCH_SECRET da Edge Function>'') on conflict (key) do update set value = excluded.value, updated_at = clock_timestamp();';

-- ============================================================================
-- 2. NUCLEO: criar_notificacao / dispatch_push_for_notification
-- ============================================================================

-- Nunca deixa uma falha de rede/config de push derrubar quem chamou: pg_net
-- so enfileira a chamada (processada por um worker em background depois do
-- commit), e qualquer erro aqui vira WARNING, nunca EXCEPTION propagada.
CREATE OR REPLACE FUNCTION public.dispatch_push_for_notification(_notificacao_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, net
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT value INTO v_url FROM public.app_secrets WHERE key = 'push_dispatch_url';
  SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'push_dispatch_secret';
  IF nullif(btrim(COALESCE(v_url, '')), '') IS NULL
     OR nullif(btrim(COALESCE(v_secret, '')), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object('notificacao_id', _notificacao_id)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'dispatch_push_for_notification falhou para %: %', _notificacao_id, SQLERRM;
END;
$$;

-- Ponto unico de criacao: grava a notificacao (dedupe), faz fan-out
-- respeitando papel + permissao granular + preferencia, e dispara o push.
-- Chamada de dentro de RPCs de negocio ja SECURITY DEFINER (nao precisa
-- GRANT - o dono ja pode chamar o que possui) e diretamente pelo
-- check-vencimentos via service_role (GRANT explicito abaixo).
CREATE OR REPLACE FUNCTION public.criar_notificacao(
  _empresa_id uuid,
  _categoria text,
  _tipo text,
  _titulo text,
  _mensagem text,
  _feature_key text DEFAULT NULL,
  _referencia_tipo text DEFAULT NULL,
  _referencia_id uuid DEFAULT NULL,
  _rota text DEFAULT NULL,
  _dedupe_key text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _criado_por uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_notificacao_id uuid;
  v_recipient record;
BEGIN
  IF _empresa_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'empresa_id e obrigatorio.';
  END IF;
  IF _categoria NOT IN ('operacional', 'financeiro') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Categoria de notificacao invalida.';
  END IF;
  IF nullif(btrim(_tipo), '') IS NULL OR nullif(btrim(_titulo), '') IS NULL
     OR nullif(btrim(_mensagem), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'tipo, titulo e mensagem sao obrigatorios.';
  END IF;

  INSERT INTO public.notificacoes (
    empresa_id, categoria, tipo, titulo, mensagem,
    referencia_tipo, referencia_id, rota, dedupe_key, metadata, criado_por
  ) VALUES (
    _empresa_id, _categoria, _tipo, btrim(_titulo), btrim(_mensagem),
    _referencia_tipo, _referencia_id, _rota, _dedupe_key, COALESCE(_metadata, '{}'::jsonb), _criado_por
  )
  ON CONFLICT (empresa_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_notificacao_id;

  -- id NULL = ja existia notificacao com este empresa_id+dedupe_key (outro
  -- gatilho, uma varredura repetida, um retry). Para aqui - nunca faz fan-out
  -- nem dispara push de novo para o mesmo evento logico.
  IF v_notificacao_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_recipient IN
    SELECT eu.user_id
    FROM public.empresa_usuarios eu
    WHERE eu.empresa_id = _empresa_id
      AND (
        (
          _categoria = 'operacional'
          AND (
            eu.perfil IN ('admin_empresa', 'master_admin')
            OR (
              eu.perfil = 'usuario'
              AND (
                _feature_key IS NULL
                OR EXISTS (
                  SELECT 1 FROM public.user_module_permissions ump
                  WHERE ump.empresa_id = _empresa_id
                    AND ump.user_id = eu.user_id
                    AND ump.feature_key = _feature_key
                    AND ump.can_view = true
                )
              )
            )
          )
        )
        OR (
          _categoria = 'financeiro'
          AND eu.perfil IN ('admin_empresa', 'master_admin')
        )
      )
  LOOP
    IF COALESCE((
      SELECT np.habilitada FROM public.notificacao_preferencias np
      WHERE np.empresa_id = _empresa_id AND np.user_id = v_recipient.user_id AND np.tipo = _tipo
    ), true) THEN
      INSERT INTO public.notificacoes_destinatarios (notificacao_id, empresa_id, user_id)
      VALUES (v_notificacao_id, _empresa_id, v_recipient.user_id)
      ON CONFLICT (notificacao_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  PERFORM public.dispatch_push_for_notification(v_notificacao_id);

  RETURN v_notificacao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_notificacao(
  uuid, text, text, text, text, text, text, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_notificacao(
  uuid, text, text, text, text, text, text, uuid, text, text, jsonb, uuid
) TO service_role;

-- ============================================================================
-- 3. RPCs - dispositivos (subscribe/unsubscribe) e sino (ler/preferencias)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_push_subscription(
  _empresa_id uuid,
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL OR v_company_id <> _empresa_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa invalida.';
  END IF;
  IF nullif(btrim(_endpoint), '') IS NULL OR nullif(btrim(_p256dh), '') IS NULL
     OR nullif(btrim(_auth), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'endpoint, p256dh e auth sao obrigatorios.';
  END IF;

  -- UPSERT por endpoint (nao por user_id): em dispositivo compartilhado o
  -- browser devolve o mesmo endpoint para o proximo usuario que ativar push
  -- nesse navegador - reatribui em vez de tratar como duplicata (satisfaz
  -- "evitar dispositivo duplicado" e "refresh da subscription" com uma unica
  -- operacao).
  INSERT INTO public.push_subscriptions (
    empresa_id, user_id, endpoint, p256dh, auth, user_agent,
    ativo, falhas_consecutivas, updated_at
  ) VALUES (
    v_company_id, auth.uid(), _endpoint, _p256dh, _auth, _user_agent,
    true, 0, clock_timestamp()
  )
  ON CONFLICT (endpoint) DO UPDATE SET
    empresa_id = EXCLUDED.empresa_id,
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    ativo = true,
    falhas_consecutivas = 0,
    ultima_falha_em = NULL,
    updated_at = clock_timestamp()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_push_subscription(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_push_subscription(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remover_push_subscription(_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;

  UPDATE public.push_subscriptions
  SET ativo = false, updated_at = clock_timestamp()
  WHERE endpoint = _endpoint AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.remover_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remover_push_subscription(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_minhas_notificacoes(
  _somente_nao_lidas boolean DEFAULT false,
  _limite integer DEFAULT 30
)
RETURNS TABLE (
  destinatario_id uuid,
  notificacao_id uuid,
  categoria text,
  tipo text,
  titulo text,
  mensagem text,
  referencia_tipo text,
  referencia_id uuid,
  rota text,
  lida boolean,
  lida_em timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    d.id, n.id, n.categoria, n.tipo, n.titulo, n.mensagem,
    n.referencia_tipo, n.referencia_id, n.rota, d.lida, d.lida_em, n.created_at
  FROM public.notificacoes_destinatarios d
  JOIN public.notificacoes n ON n.id = d.notificacao_id
  WHERE d.user_id = auth.uid()
    AND (NOT _somente_nao_lidas OR d.lida = false)
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limite, 30), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.listar_minhas_notificacoes(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_minhas_notificacoes(boolean, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.marcar_notificacao_lida(_destinatario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.notificacoes_destinatarios
  SET lida = true, lida_em = clock_timestamp()
  WHERE id = _destinatario_id AND user_id = auth.uid() AND lida = false;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_notificacao_lida(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_notificacao_lida(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.marcar_todas_notificacoes_lidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.notificacoes_destinatarios
  SET lida = true, lida_em = clock_timestamp()
  WHERE user_id = auth.uid() AND lida = false;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_todas_notificacoes_lidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_todas_notificacoes_lidas() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_notificacao_preferencia(_tipo text, _habilitada boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria.';
  END IF;
  v_company_id := public.get_user_empresa_id(auth.uid());
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa invalida.';
  END IF;
  IF nullif(btrim(_tipo), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de notificacao e obrigatorio.';
  END IF;

  INSERT INTO public.notificacao_preferencias (empresa_id, user_id, tipo, habilitada, updated_at)
  VALUES (v_company_id, auth.uid(), _tipo, _habilitada, clock_timestamp())
  ON CONFLICT (empresa_id, user_id, tipo) DO UPDATE
  SET habilitada = EXCLUDED.habilitada, updated_at = clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION public.set_notificacao_preferencia(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_notificacao_preferencia(text, boolean) TO authenticated;

-- ============================================================================
-- 4. GATILHOS DE DOMINIO - eventos operacionais (Fase 1, itens 1-4/6/9/10)
-- ============================================================================
-- Itens 5/7/8/12 (pendente, atrasada, nao devolvido, recebivel vencido) sao
-- baseados em tempo (nada "acontece" no banco nesse instante) - cobertos
-- separadamente pela extensao do check-vencimentos, nao por gatilho.

-- 1. Novo evento (agenda). events.empresa_id ja existe (retrofit
-- multi-tenant); INSERT vem direto do frontend (EventForm.tsx), sem RPC -
-- unico gatilho desta migration que precisa ser SECURITY DEFINER so para
-- poder escrever nas tabelas de notificacao (as RPCs de negocio ja rodam
-- como o dono por serem elas mesmas SECURITY DEFINER). Agenda nao tem
-- feature_key/permissao granular propria (nucleo do produto) - qualquer
-- membro ativo da empresa e elegivel.
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
    _mensagem => NEW.name || ' · ' || to_char(NEW.date, 'DD/MM/YYYY') || ' · ' || NEW.city,
    _referencia_tipo => 'evento',
    _referencia_id => NEW.id,
    _rota => '/evento/' || NEW.id,
    _dedupe_key => 'evento_criado:' || NEW.id,
    _criado_por => NEW.created_by
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_evento_criado
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.notificar_evento_criado();

-- 2/3/4/6/9. Locacoes: material_locacao_eventos e append-only (bloqueado por
-- protect_material_rental_history) e ja tem 1 linha por transicao
-- significativa com o `tipo` certo - um unico gatilho AFTER INSERT cobre
-- criacao, pronta_retirada, retirada, devolucao e correcao (baixa de
-- custodia com locacao vinculada) sem tocar nenhuma das RPCs de negocio.
CREATE OR REPLACE FUNCTION public.notificar_evento_locacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_locacao public.material_locacoes%ROWTYPE;
  v_cliente_nome text;
  v_qtd_itens numeric;
  v_tipo text;
  v_titulo text;
BEGIN
  IF NEW.tipo NOT IN ('criacao', 'pronta_retirada', 'retirada', 'devolucao', 'correcao') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_locacao FROM public.material_locacoes
  WHERE id = NEW.locacao_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT nome INTO v_cliente_nome FROM public.clientes
  WHERE id = v_locacao.cliente_id AND empresa_id = NEW.empresa_id;

  SELECT COALESCE(sum(quantidade_contratada), 0) INTO v_qtd_itens
  FROM public.material_locacao_itens
  WHERE locacao_id = v_locacao.id AND empresa_id = NEW.empresa_id;

  v_tipo := CASE NEW.tipo
    WHEN 'criacao' THEN 'locacao_criada'
    WHEN 'pronta_retirada' THEN 'locacao_pronta_retirada'
    WHEN 'retirada' THEN 'locacao_retirada_concluida'
    WHEN 'devolucao' THEN 'locacao_devolucao_concluida'
    WHEN 'correcao' THEN 'locacao_material_baixado'
  END;
  v_titulo := CASE NEW.tipo
    WHEN 'criacao' THEN 'Nova locação criada'
    WHEN 'pronta_retirada' THEN 'Nova retirada pendente'
    WHEN 'retirada' THEN 'Equipamentos retirados'
    WHEN 'devolucao' THEN 'Devolução registrada'
    WHEN 'correcao' THEN 'Ocorrência na devolução'
  END;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'operacional',
    _tipo => v_tipo,
    _titulo => v_titulo,
    _mensagem => v_locacao.numero || ' · Cliente ' || COALESCE(v_cliente_nome, '—') || ' · ' || v_qtd_itens::text || ' materiais',
    _feature_key => 'locacao_materiais',
    _referencia_tipo => 'locacao',
    _referencia_id => v_locacao.id,
    _rota => '/locacoes?locacao=' || v_locacao.id,
    _dedupe_key => 'locacao_evento:' || NEW.id,
    _criado_por => NEW.executado_por
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_evento_locacao
AFTER INSERT ON public.material_locacao_eventos
FOR EACH ROW EXECUTE FUNCTION public.notificar_evento_locacao();

-- 4/6/9 (variante standalone). material_custodia_eventos tambem recebe
-- linhas quando o checkout/checkin/baixa vem de uma locacao (custodia com
-- referencia_tipo='locacao_item') - esses casos ja notificam via
-- material_locacao_eventos acima (com contexto melhor: numero/cliente), este
-- gatilho pula explicitamente para nao duplicar. So dispara para uso "puro"
-- do modulo Check-in/Check-out (sem locacao).
CREATE OR REPLACE FUNCTION public.notificar_evento_custodia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_custodia public.material_custodias%ROWTYPE;
  v_material_nome text;
  v_tipo text;
  v_titulo text;
BEGIN
  IF NEW.tipo NOT IN ('checkout', 'checkin', 'correcao') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_custodia FROM public.material_custodias
  WHERE id = NEW.custodia_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_custodia.referencia_tipo = 'locacao_item' THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO v_material_nome FROM public.materiais
  WHERE id = NEW.material_id AND empresa_id = NEW.empresa_id;

  v_tipo := CASE NEW.tipo
    WHEN 'checkout' THEN 'custodia_checkout_concluido'
    WHEN 'checkin' THEN 'custodia_checkin_concluido'
    WHEN 'correcao' THEN 'custodia_material_baixado'
  END;
  v_titulo := CASE NEW.tipo
    WHEN 'checkout' THEN 'Retirada registrada'
    WHEN 'checkin' THEN 'Devolução registrada'
    WHEN 'correcao' THEN 'Ocorrência na devolução'
  END;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'operacional',
    _tipo => v_tipo,
    _titulo => v_titulo,
    _mensagem => COALESCE(v_material_nome, 'Material') || ' · ' || NEW.quantidade || ' un. · ' || COALESCE(v_custodia.responsavel_nome, '—'),
    _feature_key => 'checkin_checkout',
    _referencia_tipo => 'custodia',
    _referencia_id => v_custodia.id,
    _rota => '/checkin-checkout',
    _dedupe_key => 'custodia_evento:' || NEW.id,
    _criado_por => NEW.executado_por
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_evento_custodia
AFTER INSERT ON public.material_custodia_eventos
FOR EACH ROW EXECUTE FUNCTION public.notificar_evento_custodia();

-- 10. Manutencao criada/concluida. manutencao_ordem_eventos e o mesmo padrao
-- de log append-only das outras duas tabelas acima.
CREATE OR REPLACE FUNCTION public.notificar_evento_manutencao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ordem public.manutencao_ordens%ROWTYPE;
  v_material_nome text;
  v_tipo text;
  v_titulo text;
BEGIN
  IF NEW.tipo NOT IN ('criacao', 'conclusao') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ordem FROM public.manutencao_ordens
  WHERE id = NEW.ordem_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT nome INTO v_material_nome FROM public.materiais
  WHERE id = v_ordem.material_id AND empresa_id = NEW.empresa_id;

  v_tipo := CASE NEW.tipo WHEN 'criacao' THEN 'manutencao_criada' ELSE 'manutencao_concluida' END;
  v_titulo := CASE NEW.tipo WHEN 'criacao' THEN 'Ordem de manutenção aberta' ELSE 'Manutenção concluída' END;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'operacional',
    _tipo => v_tipo,
    _titulo => v_titulo,
    _mensagem => v_ordem.numero || ' · ' || COALESCE(v_material_nome, 'Material'),
    _feature_key => 'manutencao_equipamentos',
    _referencia_tipo => 'manutencao',
    _referencia_id => v_ordem.id,
    _rota => '/manutencoes',
    _dedupe_key => 'manutencao_evento:' || NEW.id,
    _criado_por => NEW.executado_por
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_evento_manutencao
AFTER INSERT ON public.manutencao_ordem_eventos
FOR EACH ROW EXECUTE FUNCTION public.notificar_evento_manutencao();

-- ============================================================================
-- 5. GATILHOS DE DOMINIO - financeiro (Fase 1, itens 11 e 13/14)
-- ============================================================================
-- Auditoria confirmou que a integracao Asaas deste repo (create-asaas-charge,
-- process_asaas_payment_webhook) cobra a PROPRIA empresa pela assinatura do
-- Backstage Pro - nunca cobra clientes da empresa (ver comentario em
-- _shared/billing-charge.ts). "Pagamento recebido"/"recebivel
-- vencido"/"falha de cobranca" no escopo desta feature sao sobre o contas a
-- receber DA EMPRESA com os proprios clientes (financeiro_lancamentos /
-- financeiro_parcelas / financeiro_recebimentos), nao sobre Asaas.

-- 11. Pagamento recebido. financeiro_recebimentos e imutavel (protect_
-- financeiro_recebimentos_history) e ja distingue tipo='recebimento' de
-- 'estorno' - so o primeiro gera notificacao.
CREATE OR REPLACE FUNCTION public.notificar_pagamento_recebido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cliente_nome text;
BEGIN
  IF NEW.tipo <> 'recebimento' THEN
    RETURN NEW;
  END IF;

  SELECT c.nome INTO v_cliente_nome
  FROM public.financeiro_lancamentos l
  JOIN public.clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
  WHERE l.id = NEW.lancamento_id AND l.empresa_id = NEW.empresa_id;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'financeiro',
    _tipo => 'pagamento_recebido',
    _titulo => 'Pagamento recebido',
    -- FM999999990.00 (ponto literal, sem token G/D): to_char's G/D seguem
    -- lc_numeric do servidor e podem sair no formato errado num Postgres sem
    -- locale pt_BR - mesma escolha (sem separador de milhar, ponto decimal)
    -- ja usada em mensagens de valor no create-asaas-charge (amount.toFixed(2)).
    _mensagem => 'Cliente ' || COALESCE(v_cliente_nome, '—') || ' · R$ ' || to_char(NEW.valor, 'FM999999990.00'),
    _referencia_tipo => 'financeiro_recebimento',
    _referencia_id => NEW.id,
    _rota => '/financeiro',
    _dedupe_key => 'recebimento:' || NEW.id,
    _criado_por => NEW.executado_por
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_pagamento_recebido
AFTER INSERT ON public.financeiro_recebimentos
FOR EACH ROW EXECUTE FUNCTION public.notificar_pagamento_recebido();

-- 13/14. Nao ha gateway de cobranca para clientes neste dominio hoje (so
-- Asaas p/ assinatura propria, ver acima), entao nao existe um sinal real de
-- "tentativa de cobranca falhou". O sinal mais proximo que ja existe no
-- schema e financeiro_lancamentos passando para
-- 'cancelado_pendente_regularizacao' (locacao cancelada com valor ja
-- recebido, exige decisao administrativa - estorna ou regulariza). Mapeado
-- aqui como pendencia financeira; ajustar/renomear se "falha de cobranca"
-- pretendia outra coisa quando um gateway de cobranca a cliente existir.
CREATE OR REPLACE FUNCTION public.notificar_financeiro_regularizacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cliente_nome text;
BEGIN
  SELECT nome INTO v_cliente_nome FROM public.clientes
  WHERE id = NEW.cliente_id AND empresa_id = NEW.empresa_id;

  PERFORM public.criar_notificacao(
    _empresa_id => NEW.empresa_id,
    _categoria => 'financeiro',
    _tipo => 'financeiro_regularizacao_pendente',
    _titulo => 'Pendência financeira',
    _mensagem => 'Cliente ' || COALESCE(v_cliente_nome, '—') || ' · R$ ' || to_char(NEW.valor_recebido, 'FM999999990.00') || ' recebido em lançamento cancelado',
    _referencia_tipo => 'financeiro_lancamento',
    _referencia_id => NEW.id,
    _rota => '/financeiro',
    _dedupe_key => 'financeiro_regularizacao:' || NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_financeiro_regularizacao
AFTER UPDATE OF status ON public.financeiro_lancamentos
FOR EACH ROW
WHEN (NEW.status = 'cancelado_pendente_regularizacao' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notificar_financeiro_regularizacao();
