-- ============================================================================
-- SCANNER REMOTO - SESSÃO AUTOMÁTICA ('misto') NEUTRA
-- ============================================================================
--
-- Cobre 20260902090000_scanner_remoto_neutral_misto_session.sql: uma sessão
-- tipo_operacao='misto' passa a poder ser aberta sem contexto operacional
-- (origem/destino/responsável/finalidade/referência/título), enquanto
-- sessões explicitamente 'checkout' continuam exigindo origem+responsável+
-- finalidade e 'checkin' continua exigindo destino - nas duas camadas (CHECK
-- da tabela e validação da RPC iniciar_sessao_scanner_remoto). Não
-- reexercita os gates de permissão (já cobertos por
-- checkin_checkout_granular_write_permissions_test.sql) nem
-- registrar_leitura_scanner_remoto. Fixture mínima e própria (prefixo 8a),
-- ator único admin_empresa (acesso irrestrito, isola o teste da
-- granularidade).
--
-- Fixtures rodam como o dono do banco (bypassa RLS). As asserções trocam de
-- papel via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE
-- authenticated, mesmo padrão do resto da suíte.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  '8a100000-0000-4000-8000-000000000001', '__srn_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '8a200000-0000-4000-8000-000000000001', '__srn_company__', 'ativo',
  '8a100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '8a300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'srn-admin@example.test', '', now(),
   '{}', '{"full_name":"SRN Admin"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '8a300000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET empresa_id = '8a200000-0000-4000-8000-000000000001',
    ativado = true,
    activated_at = now()
WHERE user_id = '8a300000-0000-4000-8000-000000000001';

-- Dependências primeiro (trigger de 20260817230000_enforce_module_dependencies_all_flows.sql
-- valida que checkin_checkout só ativa se gestao_materiais/controle_estoque já
-- estiverem ativos na mesma transação) - mesma ordem de
-- checkout_event_reference_test.sql.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '8a200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '8a200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';

-- Localizações reais: os FKs compostos scanner_remoto_sessoes_empresa_origem_fkey
-- / _destino_fkey exigem uma linha de estoque_localizacoes da mesma empresa
-- para os testes de sessão configurada (checkout/checkin explícitos).
INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('8a600000-0000-4000-8000-000000000001', '8a200000-0000-4000-8000-000000000001', 'SRN-ORIG', 'Origem', true),
  ('8a600000-0000-4000-8000-000000000002', '8a200000-0000-4000-8000-000000000001', 'SRN-DEST', 'Destino', true);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('8a700000-0000-4000-8000-000000000001', '8a200000-0000-4000-8000-000000000001', '__srn_responsible__', 'Tecnico');

-- ----------------------------------------------------------------------------
-- 1. CHECK DA TABELA - comportamento cru, sem passar pela RPC
-- ----------------------------------------------------------------------------
-- Ainda como dono (RLS/insert direto): prova que o CHECK novo permite 'misto'
-- neutro e continua barrando 'checkout'/'checkin' incompletos.

-- lives_ok/throws_ok recebem SQL cru; um INSERT simples é suportado (o próprio
-- suite do pgTAP exercita `lives_ok('INSERT ...')`).
SELECT lives_ok(
  $test$INSERT INTO public.scanner_remoto_sessoes
    (empresa_id, tipo_operacao, condicao, criado_por, client_uuid, payload_hash)
  VALUES ('8a200000-0000-4000-8000-000000000001', 'misto', 'bom',
          '8a300000-0000-4000-8000-000000000001', gen_random_uuid(), 'raw-neutral')$test$,
  'CHECK permite sessão misto neutra (contexto operacional vazio)'
);

SELECT throws_ok(
  $test$INSERT INTO public.scanner_remoto_sessoes
    (empresa_id, tipo_operacao, condicao, criado_por, client_uuid, payload_hash)
  VALUES ('8a200000-0000-4000-8000-000000000001', 'checkout', 'bom',
          '8a300000-0000-4000-8000-000000000001', gen_random_uuid(), 'raw-checkout')$test$,
  '23514', NULL,
  'CHECK ainda rejeita sessão checkout sem origem/responsável/finalidade'
);

SELECT throws_ok(
  $test$INSERT INTO public.scanner_remoto_sessoes
    (empresa_id, tipo_operacao, condicao, criado_por, client_uuid, payload_hash)
  VALUES ('8a200000-0000-4000-8000-000000000001', 'checkin', 'bom',
          '8a300000-0000-4000-8000-000000000001', gen_random_uuid(), 'raw-checkin')$test$,
  '23514', NULL,
  'CHECK ainda rejeita sessão checkin sem localização de destino'
);

-- Backward compatibility: linhas como as que já existem em produção
-- (checkout/checkin/misto configurados) continuam válidas sob o CHECK novo,
-- que é estritamente mais permissivo.
SELECT lives_ok(
  $test$INSERT INTO public.scanner_remoto_sessoes
    (empresa_id, tipo_operacao, condicao, criado_por, client_uuid, payload_hash,
     localizacao_origem_id, responsavel_tipo, responsavel_id, finalidade)
  VALUES ('8a200000-0000-4000-8000-000000000001', 'checkout', 'bom',
          '8a300000-0000-4000-8000-000000000001', gen_random_uuid(), 'raw-checkout-ok',
          '8a600000-0000-4000-8000-000000000001', 'funcionario',
          '8a700000-0000-4000-8000-000000000001', 'uso_interno')$test$,
  'CHECK continua aceitando sessão checkout configurada (linha pré-migration permanece válida)'
);

SELECT lives_ok(
  $test$INSERT INTO public.scanner_remoto_sessoes
    (empresa_id, tipo_operacao, condicao, criado_por, client_uuid, payload_hash,
     localizacao_origem_id, localizacao_destino_id, responsavel_tipo, responsavel_id, finalidade)
  VALUES ('8a200000-0000-4000-8000-000000000001', 'misto', 'bom',
          '8a300000-0000-4000-8000-000000000001', gen_random_uuid(), 'raw-misto-ok',
          '8a600000-0000-4000-8000-000000000001', '8a600000-0000-4000-8000-000000000002',
          'funcionario', '8a700000-0000-4000-8000-000000000001', 'uso_interno')$test$,
  'CHECK continua aceitando sessão misto configurada (linha pré-migration permanece válida)'
);

-- Limpa as linhas cruas para não poluir as asserções de listagem abaixo.
DELETE FROM public.scanner_remoto_sessoes
WHERE empresa_id = '8a200000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------------------
-- 2. RPC iniciar_sessao_scanner_remoto - como authenticated admin_empresa
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8a300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- (1) misto neutro pode ser criado
SELECT lives_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'misto', 'bom', '8a900000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'sessão misto neutra pode ser criada sem contexto operacional'
);

-- (2..5) os campos operacionais ficaram NULL
SELECT ok(
  (SELECT localizacao_origem_id FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'localizacao_origem_id pode ser NULL na sessão misto neutra'
);
SELECT ok(
  (SELECT localizacao_destino_id FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'localizacao_destino_id pode ser NULL na sessão misto neutra'
);
SELECT ok(
  (SELECT responsavel_tipo FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL
  AND (SELECT responsavel_id FROM public.scanner_remoto_sessoes
       WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'responsável (tipo e id) pode ser NULL na sessão misto neutra'
);
SELECT ok(
  (SELECT finalidade FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'finalidade pode ser NULL na sessão misto neutra'
);
SELECT ok(
  (SELECT referencia_tipo FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL
  AND (SELECT referencia_id FROM public.scanner_remoto_sessoes
       WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'referencia_tipo/referencia_id podem ser NULL na sessão misto neutra'
);
SELECT ok(
  (SELECT titulo FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NULL,
  'titulo pode ser NULL na sessão misto neutra'
);

-- (8) sessão criada permanece status='aberta'
SELECT is(
  (SELECT status::text FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001'),
  'aberta',
  'sessão misto neutra fica com status = aberta'
);

-- aparece normalmente em "Sessões abertas"
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.listar_sessoes_scanner_remoto(
      true, '8a200000-0000-4000-8000-000000000001'
    ) AS s
    WHERE s.client_uuid = '8a900000-0000-4000-8000-000000000001'
  ),
  'sessão misto neutra aparece em listar_sessoes_scanner_remoto (somente abertas)'
);

-- (6) checkout explícito sem campos obrigatórios continua rejeitado (SR003)
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkout', 'bom', gen_random_uuid(),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'SR003', NULL,
  'checkout explícito sem origem/responsável/finalidade continua rejeitado'
);

-- checkout explícito faltando só a finalidade também continua rejeitado
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkout', 'bom', gen_random_uuid(),
    'funcionario', '8a700000-0000-4000-8000-000000000001', NULL,
    '8a600000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'SR003', NULL,
  'checkout explícito ainda exige finalidade mesmo com origem e responsável'
);

-- (7) checkin explícito sem destino continua rejeitado (SR003)
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkin', 'bom', gen_random_uuid(),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'SR003', NULL,
  'checkin explícito sem localização de destino continua rejeitado'
);

-- par referencia_tipo/referencia_id continua validado, inclusive para misto
SELECT throws_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'misto', 'bom', gen_random_uuid(),
    NULL, NULL, NULL, NULL, NULL, 'evento', NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'SR003', NULL,
  'misto ainda rejeita referencia_tipo sem referencia_id'
);

-- (10) sessões configuradas continuam aceitas (regressão)
SELECT lives_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'misto', 'bom', gen_random_uuid(),
    'funcionario', '8a700000-0000-4000-8000-000000000001', 'uso_interno',
    '8a600000-0000-4000-8000-000000000001', '8a600000-0000-4000-8000-000000000002',
    NULL, NULL, NULL, 'Load-out configurado',
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'sessão misto totalmente configurada continua aceita (regressão)'
);
SELECT lives_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkout', 'bom', gen_random_uuid(),
    'funcionario', '8a700000-0000-4000-8000-000000000001', 'uso_interno',
    '8a600000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'sessão checkout configurada (origem+responsável+finalidade) continua aceita'
);
SELECT lives_ok(
  $test$SELECT public.iniciar_sessao_scanner_remoto(
    'checkin', 'bom', gen_random_uuid(),
    NULL, NULL, NULL, NULL, '8a600000-0000-4000-8000-000000000002',
    NULL, NULL, NULL, NULL,
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'sessão checkin configurada (destino) continua aceita'
);

-- (9) sessão neutra pode ser finalizada pela RPC existente
SELECT lives_ok(
  $test$SELECT public.encerrar_sessao_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes
     WHERE client_uuid = '8a900000-0000-4000-8000-000000000001'),
    '8a200000-0000-4000-8000-000000000001'
  )$test$,
  'sessão misto neutra pode ser finalizada por encerrar_sessao_scanner_remoto'
);
SELECT is(
  (SELECT status::text FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001'),
  'encerrada',
  'após encerrar, a sessão neutra fica com status = encerrada'
);
SELECT ok(
  (SELECT encerrada_em FROM public.scanner_remoto_sessoes
   WHERE client_uuid = '8a900000-0000-4000-8000-000000000001') IS NOT NULL,
  'encerrada_em é preenchido ao finalizar a sessão neutra'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
