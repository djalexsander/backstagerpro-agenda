-- ============================================================================
-- PUSH NOTIFICATIONS - notificacoes / notificacoes_destinatarios / push_subscriptions
-- ============================================================================
--
-- Cobre 20260819090000_push_notifications_foundation.sql. Escrito e revisado
-- estaticamente apenas - sem Docker neste ambiente, mesma limitação de todo
-- outro teste de banco deste repositorio (ver rfid_uhf_test.sql).
--
-- Estrategia de fixture: testa criar_notificacao() DIRETAMENTE (dedupe,
-- isolamento por empresa, fan-out por papel/permissao, preferencia) em vez
-- de disparar a cadeia completa de RPCs de locacao/manutencao/custodia -
-- essas RPCs ja tem suites proprias (material_rentals_stage_four_test.sql e
-- irmas) que cobrem sua propria logica de negocio; o que importa AQUI e o
-- comportamento de notificar_*, que e testado tanto diretamente (secao 2)
-- quanto via um INSERT real minimo em events/financeiro_recebimentos (secao
-- 5, as duas tabelas de origem mais simples de fixturar corretamente sem
-- repetir constraints de outro modulo). Os outros 3 gatilhos
-- (locacao/custodia/manutencao) tem sua existencia/anexo conferida por
-- catalogo (secao 6) - a logica de mensagem deles e a MESMA chamada a
-- criar_notificacao ja exercitada exaustivamente na secao 2.
--
-- criar_notificacao() nao le auth.uid() (recebe _criado_por explicito), e
-- so tem GRANT para service_role - por isso e chamada aqui como o role
-- padrao da transacao de teste (dono das tabelas), nunca via
-- SET LOCAL ROLE authenticated. As RPCs voltadas ao usuario final
-- (registrar/remover_push_subscription, listar_minhas_notificacoes,
-- marcar_*, set_notificacao_preferencia) SIM dependem de auth.uid() e sao
-- testadas com o mesmo padrao de troca de papel de rfid_uhf_test.sql:
-- set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE authenticated,
-- seguido de RESET ROLE.
--
-- Encadeamento de ids entre statements usa uma tabela temporaria
-- (push_scratch), nao \gset/\set: mesmo padrao (e mesma razao - nenhum outro
-- arquivo em supabase/tests usa meta-comandos do psql) de
-- material_traceability_test.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE push_scratch (key text PRIMARY KEY, value uuid) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '9a000000-0000-4000-8000-000000000001', '__push_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES
  ('9a000000-0000-4000-8000-000000000011', '__push_empresa_a__',
   'ativo', '9a000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('9a000000-0000-4000-8000-000000000012', '__push_empresa_b__',
   'ativo', '9a000000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '9a000000-0000-4000-8000-000000000021',
   'authenticated', 'authenticated', 'push-admin-a@example.test', '', now(), '{}', '{"full_name":"Push Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '9a000000-0000-4000-8000-000000000022',
   'authenticated', 'authenticated', 'push-usuario-a-com-grant@example.test', '', now(), '{}', '{"full_name":"Push Usuario A Com Grant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '9a000000-0000-4000-8000-000000000023',
   'authenticated', 'authenticated', 'push-usuario-a-sem-grant@example.test', '', now(), '{}', '{"full_name":"Push Usuario A Sem Grant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '9a000000-0000-4000-8000-000000000024',
   'authenticated', 'authenticated', 'push-admin-b@example.test', '', now(), '{}', '{"full_name":"Push Admin B"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN ('9a000000-0000-4000-8000-000000000021', '9a000000-0000-4000-8000-000000000024');
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN ('9a000000-0000-4000-8000-000000000022', '9a000000-0000-4000-8000-000000000023');

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN '9a000000-0000-4000-8000-000000000021'::uuid THEN '9a000000-0000-4000-8000-000000000011'::uuid
  WHEN '9a000000-0000-4000-8000-000000000022'::uuid THEN '9a000000-0000-4000-8000-000000000011'::uuid
  WHEN '9a000000-0000-4000-8000-000000000023'::uuid THEN '9a000000-0000-4000-8000-000000000011'::uuid
  WHEN '9a000000-0000-4000-8000-000000000024'::uuid THEN '9a000000-0000-4000-8000-000000000012'::uuid
  ELSE empresa_id
END
WHERE user_id IN (
  '9a000000-0000-4000-8000-000000000021', '9a000000-0000-4000-8000-000000000022',
  '9a000000-0000-4000-8000-000000000023', '9a000000-0000-4000-8000-000000000024'
);
-- profiles/user_roles alimentam empresa_usuarios.perfil via o gatilho de
-- sincronizacao canonica (20260729180000) - nenhum INSERT direto em
-- empresa_usuarios e necessario, mesmo padrao do fixture de RFID.

-- Usuario A (...022) recebe grant de VISUALIZAR locacao_materiais; usuario
-- A2 (...023) fica sem nenhum grant - e o par usado para provar que o
-- fan-out operacional respeita permissao granular por usuario.
INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES ('9a000000-0000-4000-8000-000000000011', '9a000000-0000-4000-8000-000000000022', 'locacao_materiais', true, false, false, false);

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, ativo, created_by, updated_by)
VALUES (
  '9a000000-0000-4000-8000-000000000031', '9a000000-0000-4000-8000-000000000011',
  'pessoa_fisica', '__push_cliente_a__', true,
  '9a000000-0000-4000-8000-000000000021', '9a000000-0000-4000-8000-000000000021'
);

INSERT INTO public.financeiro_lancamentos (
  id, empresa_id, origem_tipo, origem_id, cliente_id, valor_original, status, vencimento
) VALUES (
  '9a000000-0000-4000-8000-000000000041', '9a000000-0000-4000-8000-000000000011',
  '__push_test__', gen_random_uuid(), '9a000000-0000-4000-8000-000000000031',
  1250.00, 'pendente', current_date + 5
);

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURAL: RLS, policies, grants
-- ----------------------------------------------------------------------------

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_catalog.pg_class
   WHERE oid = ANY (ARRAY[
     'public.push_subscriptions'::regclass, 'public.notificacoes'::regclass,
     'public.notificacoes_destinatarios'::regclass, 'public.notificacao_preferencias'::regclass,
     'public.app_secrets'::regclass
   ])),
  'RLS habilitada nas 5 tabelas novas'
);

SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename IN (
    'push_subscriptions', 'notificacoes', 'notificacoes_destinatarios', 'notificacao_preferencias', 'app_secrets'
  )),
  0::bigint,
  'nenhuma das 5 tabelas tem policy - todo acesso de authenticated e por RPC SECURITY DEFINER'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notificacoes', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.notificacoes_destinatarios', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.notificacao_preferencias', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.notificacoes', 'SELECT'),
  'authenticated/anon nao tem nenhum privilegio direto nas tabelas (nem SELECT) - RPC-only'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.app_secrets', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.app_secrets', 'SELECT'),
  'app_secrets: nem service_role tem GRANT direto - so a SECURITY DEFINER function dona le'
);

SELECT ok(
  has_table_privilege('service_role', 'public.notificacoes', 'SELECT')
  AND has_table_privilege('service_role', 'public.notificacoes_destinatarios', 'SELECT')
  AND has_table_privilege('service_role', 'public.notificacoes_destinatarios', 'UPDATE')
  AND has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT')
  AND has_table_privilege('service_role', 'public.push_subscriptions', 'UPDATE'),
  'service_role tem exatamente o que send-push-notification precisa: ler notificacoes/destinatarios, atualizar status/subscriptions'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.registrar_push_subscription(uuid,text,text,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.remover_push_subscription(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.listar_minhas_notificacoes(boolean,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.marcar_notificacao_lida(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.marcar_todas_notificacoes_lidas()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.excluir_minhas_notificacoes_lidas()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_notificacao_preferencia(text,boolean)', 'EXECUTE'),
  'authenticated tem EXECUTE nas 7 RPCs voltadas ao usuario final'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.excluir_minhas_notificacoes_lidas()', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.excluir_minhas_notificacoes_lidas()', 'EXECUTE'),
  'excluir_minhas_notificacoes_lidas: PUBLIC/anon nao tem EXECUTE (REVOKE de PUBLIC preservado)'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.criar_notificacao(uuid,text,text,text,text,text,text,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.criar_notificacao(uuid,text,text,text,text,text,text,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'criar_notificacao: so service_role (check-vencimentos) tem EXECUTE direto - triggers chamam como dono, nao precisam de GRANT'
);

-- ----------------------------------------------------------------------------
-- 2. criar_notificacao(): dedupe, isolamento por empresa, fan-out por papel/permissao/preferencia
-- ----------------------------------------------------------------------------

-- 2a. Dedupe: duas chamadas com o mesmo empresa_id+dedupe_key so criam 1 notificacao e 1 fan-out.
SELECT ok(
  public.criar_notificacao(
    '9a000000-0000-4000-8000-000000000011', 'operacional', 'teste_dedupe',
    'Título', 'Mensagem', NULL, NULL, NULL, NULL, 'dedupe-key-1'
  ) IS NOT NULL,
  'primeira chamada com dedupe_key novo cria a notificacao e retorna um id'
);
SELECT ok(
  public.criar_notificacao(
    '9a000000-0000-4000-8000-000000000011', 'operacional', 'teste_dedupe',
    'Título repetido', 'Mensagem repetida', NULL, NULL, NULL, NULL, 'dedupe-key-1'
  ) IS NULL,
  'segunda chamada com o MESMO empresa_id+dedupe_key retorna NULL (dedupe)'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes WHERE empresa_id = '9a000000-0000-4000-8000-000000000011' AND dedupe_key = 'dedupe-key-1'),
  1::bigint,
  'apenas 1 linha em notificacoes para o dedupe_key repetido'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes_destinatarios d
   JOIN public.notificacoes n ON n.id = d.notificacao_id
   WHERE n.dedupe_key = 'dedupe-key-1' AND d.user_id = '9a000000-0000-4000-8000-000000000021'),
  1::bigint,
  'fan-out nao duplicou: admin A tem exatamente 1 linha em notificacoes_destinatarios para esse evento'
);

-- 2b. Isolamento por empresa: notificacao da empresa A nunca gera destinatario da empresa B.
INSERT INTO push_scratch (key, value)
SELECT 'isolamento', public.criar_notificacao(
  '9a000000-0000-4000-8000-000000000011', 'operacional', 'teste_isolamento',
  'Isolamento', 'Empresa A apenas', NULL, NULL, NULL, NULL, 'isolamento-key-1'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes_destinatarios
   WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'isolamento')
     AND user_id = '9a000000-0000-4000-8000-000000000024'),
  0::bigint,
  'admin B (empresa diferente) nunca aparece no fan-out de uma notificacao da empresa A'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes_destinatarios
   WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'isolamento')),
  3::bigint,
  -- feature_key NULL = notificacao "core" (sem gate de permissao de modulo) -
  -- os 3 membros da empresa A sao elegiveis (admin A + usuario A com grant +
  -- usuario A2 sem nenhum grant); o gate por permissao granular so entra em
  -- jogo quando feature_key e informado, exercitado separadamente em 2c.
  'fan-out de uma notificacao core (sem feature_key) inclui todos os 3 membros da empresa A, nenhum da empresa B'
);

-- 2c. Fan-out operacional respeita permissao granular por usuario quando feature_key e informado.
INSERT INTO push_scratch (key, value)
SELECT 'operacional', public.criar_notificacao(
  '9a000000-0000-4000-8000-000000000011', 'operacional', 'locacao_criada',
  'Nova locação criada', 'LOC-TESTE · Cliente Teste · 1 materiais',
  'locacao_materiais', 'locacao', gen_random_uuid(), '/locacoes', 'fanout-operacional-1'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'operacional')
      AND user_id = '9a000000-0000-4000-8000-000000000022'
  ),
  'usuario A com grant can_view=true em locacao_materiais RECEBE a notificacao operacional (teste minimo 5)'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'operacional')
      AND user_id = '9a000000-0000-4000-8000-000000000023'
  ),
  'usuario A2 SEM nenhum grant NAO recebe a notificacao operacional gated por feature_key'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'operacional')
      AND user_id = '9a000000-0000-4000-8000-000000000021'
  ),
  'admin_empresa sempre recebe notificacao operacional, independente de user_module_permissions'
);

-- 2d. Fan-out financeiro e admin/dono-only, mesmo sem feature_key.
INSERT INTO push_scratch (key, value)
SELECT 'financeiro', public.criar_notificacao(
  '9a000000-0000-4000-8000-000000000011', 'financeiro', 'pagamento_recebido',
  'Pagamento recebido', 'Cliente Teste · R$ 100.00',
  NULL, NULL, NULL, '/financeiro', 'fanout-financeiro-1'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'financeiro')
      AND user_id = '9a000000-0000-4000-8000-000000000021'
  ),
  'admin A RECEBE notificacao financeira (teste minimo 7)'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'financeiro')
      AND user_id IN ('9a000000-0000-4000-8000-000000000022', '9a000000-0000-4000-8000-000000000023')
  ),
  'nenhum usuario operacional (com ou sem grant de modulo) recebe notificacao financeira (teste minimo 6)'
);

-- 2e. Preferencia do usuario suprime o fan-out mesmo quando ele seria elegivel por papel.
INSERT INTO public.notificacao_preferencias (empresa_id, user_id, tipo, habilitada)
VALUES ('9a000000-0000-4000-8000-000000000011', '9a000000-0000-4000-8000-000000000021', 'pagamento_recebido', false);
INSERT INTO push_scratch (key, value)
SELECT 'financeiro2', public.criar_notificacao(
  '9a000000-0000-4000-8000-000000000011', 'financeiro', 'pagamento_recebido',
  'Pagamento recebido 2', 'Cliente Teste · R$ 200.00',
  NULL, NULL, NULL, '/financeiro', 'fanout-financeiro-2'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes_destinatarios
    WHERE notificacao_id = (SELECT value FROM push_scratch WHERE key = 'financeiro2')
      AND user_id = '9a000000-0000-4000-8000-000000000021'
  ),
  'admin A com notificacao_preferencias.habilitada=false para pagamento_recebido fica de fora, mesmo sendo elegivel por papel'
);

-- 2f. dispatch_push_for_notification nunca propaga excecao quando app_secrets nao esta configurado
-- (nenhuma linha inserida nos fixtures) - se propagasse, as chamadas criar_notificacao acima teriam
-- abortado a transacao inteira e nenhuma asserção anterior nem chegaria a rodar. Reafirma explicitamente
-- o requisito "falha no push nao desfaz a operacao de negocio" (teste minimo 13).
SELECT lives_ok(
  $test$ SELECT public.criar_notificacao(
    '9a000000-0000-4000-8000-000000000011', 'operacional', 'teste_sem_app_secrets',
    'Sem config', 'app_secrets vazio nesta transacao de teste', NULL, NULL, NULL, NULL, 'sem-app-secrets-1'
  ) $test$,
  'criar_notificacao nao lanca excecao quando app_secrets (push_dispatch_url/secret) nao esta configurado'
);

-- ----------------------------------------------------------------------------
-- 3. Dispositivos: registrar/remover_push_subscription
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$ SELECT public.registrar_push_subscription(
    '9a000000-0000-4000-8000-000000000012', 'https://push.example/x', 'p256dh', 'auth'
  ) $test$,
  '42501',
  NULL,
  'registrar_push_subscription rejeita empresa_id que nao e a empresa do usuario autenticado'
);

SELECT ok(
  public.registrar_push_subscription(
    '9a000000-0000-4000-8000-000000000011', 'https://push.example/device-1', 'p256dh-v1', 'auth-v1', 'UA/1.0'
  ) IS NOT NULL,
  'admin A registra um dispositivo (teste minimo 1)'
);
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions WHERE endpoint = 'https://push.example/device-1'),
  1::bigint,
  'exatamente 1 linha para o endpoint'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000022', true);
SET LOCAL ROLE authenticated;

-- Mesmo endpoint, usuario diferente (simula dispositivo compartilhado): upsert reatribui em vez de duplicar.
SELECT ok(
  public.registrar_push_subscription(
    '9a000000-0000-4000-8000-000000000011', 'https://push.example/device-1', 'p256dh-v2', 'auth-v2', 'UA/2.0'
  ) IS NOT NULL,
  'usuario A reusa o mesmo endpoint (dispositivo compartilhado) sem erro'
);
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions WHERE endpoint = 'https://push.example/device-1'),
  1::bigint,
  'dispositivo duplicado nao duplica: continua exatamente 1 linha para o endpoint (teste minimo 3)'
);
SELECT is(
  (SELECT user_id FROM public.push_subscriptions WHERE endpoint = 'https://push.example/device-1'),
  '9a000000-0000-4000-8000-000000000022'::uuid,
  'a linha unica foi reatribuida ao segundo usuario (o que ativou push por ultimo neste navegador)'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000022', true);
SET LOCAL ROLE authenticated;
SELECT public.remover_push_subscription('https://push.example/device-1');
SELECT is(
  (SELECT ativo FROM public.push_subscriptions WHERE endpoint = 'https://push.example/device-1'),
  false,
  'unsubscribe desativa (nao apaga) a linha (teste minimo 2)'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. Sino: listar_minhas_notificacoes / marcar_notificacao_lida / marcar_todas_notificacoes_lidas
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000022', true);
SET LOCAL ROLE authenticated;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.listar_minhas_notificacoes(false, 50)
    WHERE tipo = 'locacao_criada' AND titulo = 'Nova locação criada'
  ),
  'usuario A ve a notificacao operacional para a qual foi elegivel (sino consistente, teste minimo 12)'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(false, 50) WHERE tipo = 'pagamento_recebido'),
  'usuario A NUNCA ve, nem no sino, a notificacao financeira que nao lhe foi destinada'
);
-- Nenhuma push_subscriptions ativa restou para o usuario A (device-1 foi desativado na secao 3) -
-- o sino continua correto mesmo assim, provando que a lista interna independe de push (teste minimo 14).
SELECT is(
  (SELECT count(*) FROM public.push_subscriptions WHERE user_id = '9a000000-0000-4000-8000-000000000022' AND ativo = true),
  0::bigint,
  'pre-condicao: usuario A nao tem nenhuma push_subscriptions ativa neste ponto'
);

SELECT ok(
  (SELECT lida FROM public.listar_minhas_notificacoes(false, 50) WHERE tipo = 'locacao_criada' LIMIT 1) = false,
  'notificacao comeca nao lida'
);

WITH alvo AS (
  SELECT destinatario_id FROM public.listar_minhas_notificacoes(false, 50) WHERE tipo = 'locacao_criada' LIMIT 1
)
SELECT public.marcar_notificacao_lida(destinatario_id) FROM alvo;

SELECT ok(
  (SELECT lida FROM public.listar_minhas_notificacoes(true, 50) WHERE tipo = 'locacao_criada' LIMIT 1) IS NULL,
  'apos marcar como lida, a notificacao some do filtro somente-nao-lidas'
);

RESET ROLE;

-- marcar_* so afeta a linha do proprio chamador - admin A ainda tem notificacoes nao lidas mesmo
-- depois do usuario A ter marcado as dele.
SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000021', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(true, 50)),
  'marcar_notificacao_lida de um usuario nunca afeta as notificacoes nao lidas de outro usuario'
);
SELECT public.marcar_todas_notificacoes_lidas();
SELECT is(
  (SELECT count(*) FROM public.listar_minhas_notificacoes(true, 50)),
  0::bigint,
  'marcar_todas_notificacoes_lidas zera o filtro somente-nao-lidas do proprio usuario'
);

-- excluir_minhas_notificacoes_lidas: o usuario apaga do proprio sino as
-- notificacoes que ja marcou como lidas. Espelha marcar_todas_* (sem
-- parametro, escopo travado em user_id = auth.uid()); a diferenca e DELETE em
-- notificacoes_destinatarios, e so nas linhas lida = true. Admin A acabou de
-- marcar tudo como lido - depois de excluir, o sino dele fica vazio.
SELECT public.excluir_minhas_notificacoes_lidas();
SELECT is(
  (SELECT count(*) FROM public.listar_minhas_notificacoes(false, 100)),
  0::bigint,
  'apos excluir_minhas_notificacoes_lidas, o sino do proprio usuario (tudo lido) fica vazio - em qualquer dispositivo, ja que a lista vem do banco, nao de storage local'
);
RESET ROLE;

-- A linha-mae em notificacoes NAO e apagada, mesmo quando o unico
-- destinatario dela (admin A na notificacao financeira) acabou de ser
-- removido - orfa fica, sem limpeza automatica nesta etapa. Assercao direta
-- em tabela, no contexto do dono (mesmo padrao da secao 2).
SELECT ok(
  EXISTS (SELECT 1 FROM public.notificacoes WHERE id = (SELECT value FROM push_scratch WHERE key = 'financeiro')),
  'notificacoes: a linha-mae sobrevive a exclusao de todos os seus destinatarios (orfa, nao limpa automaticamente)'
);
SELECT is(
  (SELECT count(*) FROM public.notificacoes_destinatarios WHERE user_id = '9a000000-0000-4000-8000-000000000021'),
  0::bigint,
  'notificacoes_destinatarios: nenhuma linha do proprio usuario restou (todas eram lidas)'
);

-- Isolamento + "nao apaga nao lida": a exclusao do admin A nao tocou nenhuma
-- linha do usuario A; o usuario A entao roda a mesma RPC e SO a linha que ele
-- proprio marcou como lida some - as nao lidas dele continuam no sino.
SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000022', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(false, 100) WHERE lida = true)
  AND EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(true, 100)),
  'excluir_minhas_notificacoes_lidas de um usuario nunca apaga linha de outro usuario (usuario A mantem sua lida e suas nao lidas)'
);
SELECT public.excluir_minhas_notificacoes_lidas();
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(false, 100) WHERE lida = true),
  'apos o proprio usuario A excluir: nenhuma notificacao lida restou no sino dele'
);
SELECT is(
  (SELECT count(*) FROM public.listar_minhas_notificacoes(false, 100)),
  (SELECT count(*) FROM public.listar_minhas_notificacoes(true, 100)),
  'as notificacoes NAO lidas do usuario A continuam todas no sino - excluir so remove as lidas'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.listar_minhas_notificacoes(true, 100) WHERE tipo = 'teste_isolamento'),
  'uma notificacao nao lida especifica do usuario A segue intacta apos ele excluir as visualizadas'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. Gatilhos de dominio (INSERT real minimo) - events e financeiro_recebimentos
-- ----------------------------------------------------------------------------

INSERT INTO public.events (empresa_id, date, name, artist, city, venue, created_by)
VALUES ('9a000000-0000-4000-8000-000000000011', current_date + 10, '__push_evento_teste__', 'Artista Teste', 'Cidade Teste', 'Local Teste', '9a000000-0000-4000-8000-000000000021');

SELECT ok(
  EXISTS (SELECT 1 FROM public.notificacoes WHERE empresa_id = '9a000000-0000-4000-8000-000000000011' AND tipo = 'evento_criado' AND mensagem LIKE '%__push_evento_teste__%'),
  'INSERT em events dispara trigger e cria notificacao evento_criado (teste minimo 8, variante agenda)'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes n JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.tipo = 'evento_criado' AND d.user_id = '9a000000-0000-4000-8000-000000000022'
  ),
  'evento_criado e core (sem feature_key) - qualquer membro ativo da empresa e elegivel, inclusive usuario sem nenhum grant especifico'
);

-- Evento so com nome+data (artist/city/venue NULL, apos
-- 20260827100000_events_optional_artist_city_venue.sql). O trigger
-- notificar_evento_criado concatena NEW.city na mensagem; sem o
-- COALESCE(' · ' || NEW.city, '') a expressao inteira viraria NULL e
-- criar_notificacao abortaria este INSERT.
INSERT INTO public.events (empresa_id, date, name, created_by)
VALUES ('9a000000-0000-4000-8000-000000000011', current_date + 11, '__push_evento_sem_cidade__', '9a000000-0000-4000-8000-000000000021');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes
    WHERE empresa_id = '9a000000-0000-4000-8000-000000000011'
      AND tipo = 'evento_criado'
      AND mensagem = '__push_evento_sem_cidade__ · ' || to_char(current_date + 11, 'DD/MM/YYYY')
  ),
  'evento com city NULL ainda dispara evento_criado e a mensagem termina na data (sem " · " pendurado nem NULL)'
);

INSERT INTO public.financeiro_recebimentos (empresa_id, lancamento_id, tipo, valor, client_uuid, executado_por)
VALUES ('9a000000-0000-4000-8000-000000000011', '9a000000-0000-4000-8000-000000000041', 'recebimento', 100.00, gen_random_uuid(), '9a000000-0000-4000-8000-000000000021');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notificacoes n JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.tipo = 'pagamento_recebido' AND n.mensagem LIKE '%__push_cliente_a__%' AND d.user_id = '9a000000-0000-4000-8000-000000000021'
  ),
  'INSERT em financeiro_recebimentos (tipo=recebimento) dispara trigger, resolve nome do cliente e notifica admin A'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notificacoes n JOIN public.notificacoes_destinatarios d ON d.notificacao_id = n.id
    WHERE n.tipo = 'pagamento_recebido' AND n.mensagem LIKE '%R$ 100.00%' AND d.user_id = '9a000000-0000-4000-8000-000000000022'
  ),
  'o mesmo evento financeiro real (nao so o teste sintetico da secao 2) tambem nao alcanca usuario operacional'
);

INSERT INTO public.financeiro_recebimentos (empresa_id, lancamento_id, tipo, valor, recebimento_estornado_id, client_uuid, executado_por)
SELECT '9a000000-0000-4000-8000-000000000011', '9a000000-0000-4000-8000-000000000041', 'estorno', 50.00, id, gen_random_uuid(), '9a000000-0000-4000-8000-000000000021'
FROM public.financeiro_recebimentos WHERE lancamento_id = '9a000000-0000-4000-8000-000000000041' AND tipo = 'recebimento' LIMIT 1;

SELECT is(
  (SELECT count(*) FROM public.notificacoes WHERE tipo = 'pagamento_recebido'),
  1::bigint,
  'estorno NAO gera uma segunda notificacao de pagamento_recebido - so tipo=recebimento dispara'
);

-- ----------------------------------------------------------------------------
-- 6. Gatilhos de dominio (locacao/custodia/manutencao) - existencia/anexo
-- ----------------------------------------------------------------------------
-- Logica de mensagem ja exaustivamente coberta na secao 2 (mesma chamada a
-- criar_notificacao); aqui so confirma que cada trigger existe e esta
-- anexado à tabela/evento certo, evitando refixturar locacao/custodia/
-- manutencao (cada uma com sua propria cadeia de constraints ja coberta por
-- outra suite).

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.material_locacao_eventos'::regclass
      AND tgname = 'trg_notificar_evento_locacao' AND NOT tgisinternal
  ),
  'trigger de notificacao de locacao existe em material_locacao_eventos'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.material_custodia_eventos'::regclass
      AND tgname = 'trg_notificar_evento_custodia' AND NOT tgisinternal
  ),
  'trigger de notificacao de custodia existe em material_custodia_eventos'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.manutencao_ordem_eventos'::regclass
      AND tgname = 'trg_notificar_evento_manutencao' AND NOT tgisinternal
  ),
  'trigger de notificacao de manutencao existe em manutencao_ordem_eventos'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.financeiro_lancamentos'::regclass
      AND tgname = 'trg_notificar_financeiro_regularizacao' AND NOT tgisinternal
  ),
  'trigger de pendencia financeira (cancelado_pendente_regularizacao) existe em financeiro_lancamentos'
);

SELECT * FROM finish();

ROLLBACK;
