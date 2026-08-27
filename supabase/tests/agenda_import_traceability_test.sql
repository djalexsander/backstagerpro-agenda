-- ============================================================================
-- IMPORTADOR DA AGENDA - rastreabilidade + import atômico + event_days/campos
-- ============================================================================
--
-- Cobre 20260827110000_agenda_import_traceability.sql e
--       20260827120000_events_import_fields_and_days.sql:
--   public.event_import_origins  (tabela + RLS lockdown + UNIQUE de dedupe)
--   public.importar_agenda_eventos(text, jsonb)  (events + event_days + origem)
--   public.listar_eventos_agenda_ja_importados(text, text[])
--   colunas próprias: events.state / setup_time / staff_notes / contratante_*
--
-- Sem Docker neste ambiente (mesma limitação de todo o resto da suíte) -
-- escrito e revisado estaticamente. Fixtures rodam como o dono do banco
-- (bypassa RLS); as asserções trocam de papel via
-- set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE authenticated.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. FIXTURES (prefixo a1)
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria)
VALUES ('a1100000-0000-4000-8000-000000000001', '__ait_plan__', 100, 20, 100, true, 'mensal', 'plano_base');

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('a1200000-0000-4000-8000-000000000001', '__ait_company_a__', 'ativo',
   'a1100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('a1200000-0000-4000-8000-000000000002', '__ait_company_b__', 'ativo',
   'a1100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'ait-admin-a@example.test', '', now(), '{}', '{"full_name":"AIT Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'ait-user-a@example.test', '', now(), '{}', '{"full_name":"AIT Usuario A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1300000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'ait-admin-b@example.test', '', now(), '{}', '{"full_name":"AIT Admin B"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN ('a1300000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000003');
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id = 'a1300000-0000-4000-8000-000000000002';

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN 'a1300000-0000-4000-8000-000000000001'::uuid THEN 'a1200000-0000-4000-8000-000000000001'::uuid
  WHEN 'a1300000-0000-4000-8000-000000000002'::uuid THEN 'a1200000-0000-4000-8000-000000000001'::uuid
  WHEN 'a1300000-0000-4000-8000-000000000003'::uuid THEN 'a1200000-0000-4000-8000-000000000002'::uuid
  ELSE empresa_id END
WHERE user_id IN ('a1300000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000002', 'a1300000-0000-4000-8000-000000000003');

CREATE TEMP TABLE ait_scratch (key text PRIMARY KEY, value jsonb) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURAL: RLS, sem policy, sem GRANT direto para authenticated
-- ----------------------------------------------------------------------------

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.event_import_origins'::regclass),
  'RLS habilitada em event_import_origins'
);
SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'event_import_origins'),
  0::bigint,
  'event_import_origins nao tem policy - acesso so por RPC SECURITY DEFINER'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.event_import_origins', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_import_origins', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.event_import_origins', 'SELECT'),
  'authenticated/anon nao tem privilegio direto em event_import_origins'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.importar_agenda_eventos(text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.listar_eventos_agenda_ja_importados(text,text[])', 'EXECUTE'),
  'authenticated tem EXECUTE nas duas RPCs de importacao'
);

-- Colunas próprias existem e são opcionais (migration 20260827120000)
SELECT bag_eq(
  $$ SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name IN ('state','setup_time','staff_notes',
                           'contratante_nome','contratante_cidade','contratante_telefone') $$,
  $$ VALUES ('state'),('setup_time'),('staff_notes'),
            ('contratante_nome'),('contratante_cidade'),('contratante_telefone') $$,
  'events ganhou as 6 colunas próprias da importação'
);
SELECT is(
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'events'
     AND column_name IN ('state','setup_time','staff_notes',
                         'contratante_nome','contratante_cidade','contratante_telefone')
     AND is_nullable = 'NO'),
  0::bigint,
  'as 6 colunas novas são todas NULLABLE (nenhuma obrigatória)'
);

-- ----------------------------------------------------------------------------
-- 2. IMPORTAR 3 EVENTOS NOVOS  (itens 1, 4-9, 11, 13-16, 20 + event_days/campos)
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

INSERT INTO ait_scratch (key, value)
SELECT 'r1', public.importar_agenda_eventos(
  'gestao_eventos_pro',
  jsonb_build_array(
    jsonb_build_object('source_event_id', 'src-1', 'name', 'Show Um', 'date', '2026-09-10',
      'artist', 'Banda Um', 'city', 'Recife', 'venue', 'Teatro Um', 'show_time', '21:00:00',
      'status', 'confirmado',
      'state', 'PE', 'setup_time', '14:00', 'staff_notes', 'Chegar 2h antes.',
      'contratante_nome', 'Prefeitura', 'contratante_cidade', 'Recife',
      'contratante_telefone', '(81) 3333-0000',
      'logistics_departure', '2026-09-09T14:30:00',
      'observations', 'Obs do show um.'),
    jsonb_build_object('source_event_id', 'src-2', 'name', 'Show Dois', 'date', '2026-09-11',
      'artist', NULL, 'city', NULL, 'venue', NULL, 'show_time', NULL,
      'status', 'pendente',
      'state', NULL, 'setup_time', NULL, 'staff_notes', NULL,
      'contratante_nome', NULL, 'contratante_cidade', NULL, 'contratante_telefone', NULL,
      'logistics_departure', NULL, 'observations', NULL),
    jsonb_build_object('source_event_id', 'src-3', 'name', 'Show Tres', 'date', '2026-09-12',
      'artist', 'Trio', 'city', 'Olinda', 'venue', 'Praca', 'show_time', '20:30',
      'status', 'cancelado',
      'state', 'PE', 'observations', NULL)
  )
);

SELECT is(
  (SELECT value FROM ait_scratch WHERE key = 'r1'),
  jsonb_build_object('imported', 3, 'skipped', 0),
  'importar 3 eventos novos retorna imported=3, skipped=0 (item 20)'
);

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.events WHERE empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  3::bigint,
  '3 linhas criadas em events para a empresa A (item 1)'
);
SELECT is(
  (SELECT count(*) FROM public.event_import_origins WHERE empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  3::bigint,
  '3 linhas de rastreabilidade em event_import_origins'
);
-- Item 1 (correção): a RPC também cria event_days (Dia 1), como o EventForm.
SELECT is(
  (SELECT count(*) FROM public.event_days ed
   JOIN public.events e ON e.id = ed.event_id
   WHERE e.empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  3::bigint,
  '3 linhas em event_days (uma Dia 1 por evento importado)'
);
SELECT is(
  (SELECT source_system FROM public.event_import_origins WHERE source_event_id = 'src-1'),
  'gestao_eventos_pro',
  'source_system gravado exatamente como recebido (item 4)'
);
SELECT is(
  (SELECT empresa_id FROM public.event_import_origins WHERE source_event_id = 'src-1'),
  'a1200000-0000-4000-8000-000000000001'::uuid,
  'empresa_id vem de get_user_empresa_id do ator, nao de parametro (item 16)'
);

-- events.id != source_event_id, e source_event_id NAO aparece em events (item 5, 6)
SELECT ok(
  (SELECT origin.event_id::text <> origin.source_event_id
   FROM public.event_import_origins AS origin WHERE origin.source_event_id = 'src-1'),
  'events.id (uuid proprio do Backstage) e diferente do source_event_id (item 6)'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
      AND column_name IN ('source_event_id', 'source_system')
  ),
  'events nao ganhou coluna de origem - identidade da origem fica so em event_import_origins (item 5)'
);

-- Mapeamento por evento (src-1: tudo preenchido, cada campo na SUA coluna)
WITH e AS (
  SELECT ev.* FROM public.events ev
  WHERE ev.id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-1')
)
SELECT is((SELECT name FROM e), 'Show Um', 'src-1: name')
UNION ALL SELECT is((SELECT date FROM e)::text, '2026-09-10', 'src-1: date')
UNION ALL SELECT is((SELECT artist FROM e), 'Banda Um', 'src-1: artist')
UNION ALL SELECT is((SELECT city FROM e), 'Recife', 'src-1: city (SOMENTE cidade, sem UF)')
UNION ALL SELECT is((SELECT state FROM e), 'PE', 'src-1: state na coluna própria (nao em observations)')
UNION ALL SELECT is((SELECT venue FROM e), 'Teatro Um', 'src-1: venue')
UNION ALL SELECT is((SELECT show_time FROM e)::text, '21:00:00', 'src-1: show_time normalizado (item 13)')
UNION ALL SELECT is((SELECT setup_time FROM e), '14:00', 'src-1: setup_time na coluna própria')
UNION ALL SELECT is((SELECT staff_notes FROM e), 'Chegar 2h antes.', 'src-1: staff_notes na coluna própria')
UNION ALL SELECT is((SELECT contratante_nome FROM e), 'Prefeitura', 'src-1: contratante_nome na coluna própria')
UNION ALL SELECT is((SELECT contratante_cidade FROM e), 'Recife', 'src-1: contratante_cidade na coluna própria')
UNION ALL SELECT is((SELECT contratante_telefone FROM e), '(81) 3333-0000', 'src-1: contratante_telefone na coluna própria')
UNION ALL SELECT is((SELECT status FROM e)::text, 'confirmado', 'src-1: status convertido (item 14)')
UNION ALL SELECT is((SELECT num_days FROM e), 1, 'src-1: num_days = 1')
UNION ALL SELECT is((SELECT material_list FROM e), NULL::text, 'src-1: material_list NULL')
UNION ALL SELECT is((SELECT logistics_departure FROM e), '2026-09-09 14:30:00+00'::timestamptz,
  'src-1: logistics_departure = data+hora ingênua interpretada em UTC (regra do EventForm)')
UNION ALL SELECT is((SELECT observations FROM e), 'Obs do show um.',
  'src-1: observations = SÓ a observação geral, sem cópia dos outros campos (item 15)');

-- src-1: event_days Dia 1 espelha o evento (mesma forma do EventForm)
WITH d AS (
  SELECT ed.* FROM public.event_days ed
  WHERE ed.event_id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-1')
)
SELECT is((SELECT count(*) FROM d), 1::bigint, 'src-1: exatamente 1 event_day')
UNION ALL SELECT is((SELECT day_number FROM d), 1, 'src-1: event_days.day_number = 1')
UNION ALL SELECT is((SELECT date FROM d)::text, '2026-09-10', 'src-1: event_days.date = data do evento')
UNION ALL SELECT is((SELECT artist FROM d), 'Banda Um', 'src-1: event_days.artist = artista do evento')
UNION ALL SELECT is((SELECT show_time FROM d)::text, '21:00:00', 'src-1: event_days.show_time = horario do evento')
UNION ALL SELECT is((SELECT observations FROM d), NULL::text, 'src-1: event_days.observations começa NULL')
UNION ALL SELECT is((SELECT empresa_id FROM d), 'a1200000-0000-4000-8000-000000000001'::uuid,
  'src-1: event_days.empresa_id = empresa do ator');

-- src-2: opcionais todos NULL, inclusive as colunas novas
WITH e AS (
  SELECT ev.* FROM public.events ev
  WHERE ev.id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-2')
)
SELECT is((SELECT artist FROM e), NULL::text, 'src-2: artist NULL (item 7)')
UNION ALL SELECT is((SELECT city FROM e), NULL::text, 'src-2: city NULL (item 8)')
UNION ALL SELECT is((SELECT venue FROM e), NULL::text, 'src-2: venue NULL (item 9)')
UNION ALL SELECT is((SELECT show_time FROM e), NULL::time, 'src-2: show_time NULL')
UNION ALL SELECT is((SELECT observations FROM e), NULL::text, 'src-2: observations NULL')
UNION ALL SELECT is((SELECT state FROM e), NULL::text, 'src-2: state NULL (campo vazio -> NULL)')
UNION ALL SELECT is((SELECT setup_time FROM e), NULL::text, 'src-2: setup_time NULL')
UNION ALL SELECT is((SELECT staff_notes FROM e), NULL::text, 'src-2: staff_notes NULL')
UNION ALL SELECT is((SELECT contratante_nome FROM e), NULL::text, 'src-2: contratante_nome NULL')
UNION ALL SELECT is((SELECT contratante_cidade FROM e), NULL::text, 'src-2: contratante_cidade NULL')
UNION ALL SELECT is((SELECT contratante_telefone FROM e), NULL::text, 'src-2: contratante_telefone NULL')
UNION ALL SELECT is((SELECT logistics_departure FROM e), NULL::timestamptz, 'src-2: logistics_departure NULL')
UNION ALL SELECT is((SELECT status FROM e)::text, 'pendente', 'src-2: status pendente');

-- src-2: event_days Dia 1 com artist '' (COALESCE, igual ao reconcileEventDays)
WITH d AS (
  SELECT ed.* FROM public.event_days ed
  WHERE ed.event_id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-2')
)
SELECT is((SELECT count(*) FROM d), 1::bigint, 'src-2: exatamente 1 event_day')
UNION ALL SELECT is((SELECT day_number FROM d), 1, 'src-2: event_days.day_number = 1')
UNION ALL SELECT is((SELECT date FROM d)::text, '2026-09-11', 'src-2: event_days.date = data do evento')
UNION ALL SELECT is((SELECT artist FROM d), '', 'src-2: event_days.artist = '''' quando o evento nao tem artista')
UNION ALL SELECT is((SELECT show_time FROM d), NULL::time, 'src-2: event_days.show_time NULL');

SELECT is(
  (SELECT state FROM public.events WHERE id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-3')),
  'PE',
  'src-3: UF vai para events.state (nunca mais empurrada como texto em observations)'
);
SELECT is(
  (SELECT observations FROM public.events WHERE id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-3')),
  NULL::text,
  'src-3: observations NULL (nao recebe "UF do evento: ...")'
);

-- ----------------------------------------------------------------------------
-- 3. DEDUPE: reimportar o mesmo arquivo nao duplica  (itens 2, 3)
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- src-1 e src-2 ja importados; src-4 novo.
INSERT INTO ait_scratch (key, value)
SELECT 'r2', public.importar_agenda_eventos(
  'gestao_eventos_pro',
  jsonb_build_array(
    jsonb_build_object('source_event_id', 'src-1', 'name', 'Show Um (2)', 'date', '2026-09-10', 'status', 'confirmado'),
    jsonb_build_object('source_event_id', 'src-2', 'name', 'Show Dois (2)', 'date', '2026-09-11', 'status', 'pendente'),
    jsonb_build_object('source_event_id', 'src-4', 'name', 'Show Quatro', 'date', '2026-09-13', 'status', 'confirmado')
  )
);
SELECT is(
  (SELECT value FROM ait_scratch WHERE key = 'r2'),
  jsonb_build_object('imported', 1, 'skipped', 2),
  'reimport: 2 ja importados sao pulados, so o novo entra (item 2)'
);

-- Todos ja importados
INSERT INTO ait_scratch (key, value)
SELECT 'r3', public.importar_agenda_eventos(
  'gestao_eventos_pro',
  jsonb_build_array(
    jsonb_build_object('source_event_id', 'src-1', 'name', 'x', 'date', '2026-09-10', 'status', 'confirmado'),
    jsonb_build_object('source_event_id', 'src-3', 'name', 'x', 'date', '2026-09-12', 'status', 'confirmado')
  )
);
SELECT is(
  (SELECT value FROM ait_scratch WHERE key = 'r3'),
  jsonb_build_object('imported', 0, 'skipped', 2),
  'todos ja importados -> imported=0 (item 3)'
);

-- listar_eventos_agenda_ja_importados enxerga so os desta empresa
SELECT bag_eq(
  $$ SELECT source_event_id FROM public.listar_eventos_agenda_ja_importados(
       'gestao_eventos_pro', ARRAY['src-1','src-2','src-3','src-4','src-999']) $$,
  $$ VALUES ('src-1'),('src-2'),('src-3'),('src-4') $$,
  'listar_eventos_agenda_ja_importados devolve exatamente os ja importados desta empresa'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.events WHERE empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  4::bigint,
  'depois de 2 reimports, empresa A tem 4 eventos (nenhum duplicado)'
);
SELECT is(
  (SELECT count(*) FROM public.event_days ed
   JOIN public.events e ON e.id = ed.event_id
   WHERE e.empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  4::bigint,
  'event_days tambem fica em 4 (reimport de ja-importado nao cria outro Dia 1)'
);
SELECT is(
  (SELECT count(*) FROM public.event_days
   WHERE event_id = (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-1')),
  1::bigint,
  'src-1 continua com exatamente 1 event_day apos ser pulado no reimport'
);

-- ----------------------------------------------------------------------------
-- 4. ROLLBACK: erro real no meio do lote nao deixa nada  (item 19)
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT public.importar_agenda_eventos('gestao_eventos_pro', jsonb_build_array(
       jsonb_build_object('source_event_id', 'src-roll-1', 'name', 'Bom', 'date', '2026-10-01', 'status', 'confirmado'),
       jsonb_build_object('source_event_id', 'src-roll-2', 'name', 'Ruim', 'date', 'data-invalida', 'status', 'confirmado')
     )) $$,
  '22023', NULL,
  'data invalida no 2o evento aborta a RPC'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.event_import_origins WHERE source_event_id IN ('src-roll-1', 'src-roll-2')),
  0::bigint,
  'nenhum evento do lote com erro foi persistido (rollback total, item 19)'
);
SELECT is(
  (SELECT count(*) FROM public.events WHERE empresa_id = 'a1200000-0000-4000-8000-000000000001'),
  4::bigint,
  'events da empresa A continua em 4 apos o lote que falhou'
);
SELECT is(
  (SELECT count(*) FROM public.events WHERE name IN ('Bom', 'Ruim')),
  0::bigint,
  'o evento "Bom" (antes do erro) tambem sumiu - rollback pega events'
);
SELECT is(
  (SELECT count(*) FROM public.event_days ed JOIN public.events e ON e.id = ed.event_id
   WHERE e.name IN ('Bom', 'Ruim')),
  0::bigint,
  'nenhum event_day do lote que falhou sobreviveu (rollback inclui event_days, item 19)'
);

-- ----------------------------------------------------------------------------
-- 5. UNIQUE impede duplicacao concorrente  (item 18)
-- ----------------------------------------------------------------------------

SELECT throws_ok(
  $$ INSERT INTO public.event_import_origins (empresa_id, event_id, source_system, source_event_id)
     VALUES ('a1200000-0000-4000-8000-000000000001',
             (SELECT event_id FROM public.event_import_origins WHERE source_event_id = 'src-1'),
             'gestao_eventos_pro', 'src-1') $$,
  '23505', NULL,
  'UNIQUE (empresa_id, source_system, source_event_id) bloqueia insercao concorrente da mesma origem'
);

-- ----------------------------------------------------------------------------
-- 6. ISOLAMENTO POR EMPRESA
-- ----------------------------------------------------------------------------

-- Usuario comum (nao admin) da empresa A: sem permissao de escrita.
SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.importar_agenda_eventos('gestao_eventos_pro', jsonb_build_array(
       jsonb_build_object('source_event_id', 'src-user', 'name', 'x', 'date', '2026-10-05', 'status', 'confirmado'))) $$,
  '42501', NULL,
  'usuario comum (sem admin_empresa) nao pode importar'
);
RESET ROLE;

-- Admin da empresa B importa: cai na empresa B, nunca na A.
SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.importar_agenda_eventos('gestao_eventos_pro', jsonb_build_array(
    jsonb_build_object('source_event_id', 'src-1', 'name', 'Mesmo id, outra empresa', 'date', '2026-09-10', 'status', 'confirmado'))),
  jsonb_build_object('imported', 1, 'skipped', 0),
  'src-1 da empresa B e NOVO (a dedupe e por empresa) - importa normalmente'
);
RESET ROLE;
SELECT is(
  (SELECT empresa_id FROM public.event_import_origins
   WHERE source_event_id = 'src-1' AND empresa_id = 'a1200000-0000-4000-8000-000000000002'),
  'a1200000-0000-4000-8000-000000000002'::uuid,
  'a origem de src-1 da empresa B aponta para a empresa B'
);
SELECT is(
  (SELECT count(*) FROM public.event_import_origins WHERE source_event_id = 'src-1'),
  2::bigint,
  'src-1 existe uma vez por empresa (A e B), sem conflito'
);

SELECT * FROM finish();

ROLLBACK;
