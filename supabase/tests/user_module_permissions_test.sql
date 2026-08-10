-- ============================================================================
-- PERMISSÕES GRANULARES POR USUÁRIO E MÓDULO - user_module_permissions
-- ============================================================================
--
-- Cobre 20260810090000_user_module_permissions.sql: tabela RPC-only,
-- helper user_has_module_action, list_/set_user_module_permissions e o
-- backfill idempotente. Módulos de catálogo próprios (__ump_alpha__/
-- __ump_beta__) para não depender do seed real de module_catalog - mesmo
-- padrão de isolamento de fixtures usado em backend_entitlements_test.sql.
--
-- Fixtures rodam como o dono do banco (bypassa RLS de propósito). As
-- asserções então trocam de papel via set_config('request.jwt.claim.sub', ...)
-- + SET LOCAL ROLE authenticated, exatamente como tenant_isolation_matrix_
-- test.sql.

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
  'd1000000-0000-4000-8000-000000000001', '__ump_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES
  ('d2000000-0000-4000-8000-000000000001', '__ump_company_a__',
   'ativo', 'd1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days'),
  ('d2000000-0000-4000-8000-000000000002', '__ump_company_b__',
   'ativo', 'd1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days');

INSERT INTO public.module_catalog (id, nome, feature_key, valor, ativo, ordem)
VALUES
  ('d4000000-0000-4000-8000-000000000001', '__UMP Alpha__', '__ump_alpha__', 10, true, 1),
  ('d4000000-0000-4000-8000-000000000002', '__UMP Beta__', '__ump_beta__', 10, true, 2);

-- Company A: alpha ativo, beta ainda pendente (não ativo) - usado para
-- provar que set_ rejeita módulo indisponível. Company B: alpha ativo (para
-- os testes de isolamento entre empresas terem algo real para vazar).
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'active'),
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002', 'pending'),
  ('d2000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000001', 'active');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'ump-admin-a@example.test', '', now(),
   '{}', '{"full_name":"UMP Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'ump-usuario-a-granted@example.test', '', now(),
   '{}', '{"full_name":"UMP Usuario A Granted"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'ump-usuario-a-nogrant@example.test', '', now(),
   '{}', '{"full_name":"UMP Usuario A NoGrant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'ump-admin-b@example.test', '', now(),
   '{}', '{"full_name":"UMP Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'ump-usuario-b@example.test', '', now(),
   '{}', '{"full_name":"UMP Usuario B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'ump-master-with-company@example.test', '', now(),
   '{}', '{"full_name":"UMP Master With Company"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000007',
   'authenticated', 'authenticated', 'ump-master-no-company@example.test', '', now(),
   '{}', '{"full_name":"UMP Master No Company"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3000000-0000-4000-8000-000000000008',
   'authenticated', 'authenticated', 'ump-dual-role@example.test', '', now(),
   '{}', '{"full_name":"UMP Dual Role"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'd3000000-0000-4000-8000-000000000001', -- Admin A
  'd3000000-0000-4000-8000-000000000004', -- Admin B
  'd3000000-0000-4000-8000-000000000008'  -- Dual Role (base row; master_admin added below)
);
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  'd3000000-0000-4000-8000-000000000002', -- Usuario A Granted
  'd3000000-0000-4000-8000-000000000003', -- Usuario A NoGrant
  'd3000000-0000-4000-8000-000000000005'  -- Usuario B
);
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id IN (
  'd3000000-0000-4000-8000-000000000006', -- Master With Company
  'd3000000-0000-4000-8000-000000000007'  -- Master No Company
);
-- Dual Role holds BOTH an admin_empresa row (above) AND a master_admin row
-- (here) - proves the explicit is_master_admin guard wins even when the
-- caller/target also qualifies as admin_empresa via has_role.
INSERT INTO public.user_roles (user_id, role)
VALUES ('d3000000-0000-4000-8000-000000000008', 'master_admin');

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN 'd3000000-0000-4000-8000-000000000001'::uuid THEN 'd2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000002'::uuid THEN 'd2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000003'::uuid THEN 'd2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000004'::uuid THEN 'd2000000-0000-4000-8000-000000000002'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000005'::uuid THEN 'd2000000-0000-4000-8000-000000000002'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000006'::uuid THEN 'd2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'd3000000-0000-4000-8000-000000000008'::uuid THEN 'd2000000-0000-4000-8000-000000000001'::uuid
  ELSE empresa_id
END
WHERE user_id IN (
  'd3000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000003',
  'd3000000-0000-4000-8000-000000000004',
  'd3000000-0000-4000-8000-000000000005',
  'd3000000-0000-4000-8000-000000000006',
  'd3000000-0000-4000-8000-000000000008'
);
-- d3...007 (master sem empresa) mantém profiles.empresa_id NULL de propósito.

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURAL: RLS, zero policies diretas, grants de tabela e de função
-- ----------------------------------------------------------------------------

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid = 'public.user_module_permissions'::regclass),
  'RLS está habilitada em user_module_permissions'
);

SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_module_permissions'),
  0::bigint,
  'nenhuma policy direta existe - acesso é só via RPC'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_module_permissions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.user_module_permissions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.user_module_permissions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.user_module_permissions', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.user_module_permissions', 'SELECT'),
  'authenticated/anon não têm nenhum privilégio direto na tabela (REVOKE aplicado)'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.list_user_module_permissions(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_user_module_permissions(uuid,uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.user_has_module_action(uuid,text,text)', 'EXECUTE'),
  'authenticated pode executar as 3 funções públicas'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.list_user_module_permissions(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.set_user_module_permissions(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.user_has_module_action(uuid,text,text)', 'EXECUTE'),
  'anon não pode executar nenhuma das 3 funções públicas'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.backfill_user_module_view_permissions()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.backfill_user_module_view_permissions()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.backfill_user_module_view_permissions()', 'EXECUTE'),
  'o backfill é inalcançável por anon/authenticated/service_role (só o dono chama)'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create)
    VALUES (
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      '__ump_alpha__',
      false, true
    )
  $test$,
  '23514',
  NULL,
  'CHECK impede can_create=true com can_view=false'
);

-- ----------------------------------------------------------------------------
-- 2. ADMIN A gerencia permissões de USUARIO A GRANTED
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  )),
  1::bigint,
  'list_ mostra só o módulo ativo (alpha) da empresa A - beta (pending) não aparece'
);
SELECT ok(
  NOT (SELECT can_view FROM public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  ) WHERE feature_key = '__ump_alpha__'),
  'antes de qualquer set_, usuario A granted não tem can_view em alpha'
);

SELECT lives_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      '[{"feature_key":"__ump_alpha__","can_view":true,"can_create":true,"can_edit":false,"can_delete":false}]'::jsonb
    )
  $test$,
  'admin A concede visualizar+criar em alpha para usuario A granted'
);

SELECT is(
  (SELECT can_view FROM public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  ) WHERE feature_key = '__ump_alpha__'),
  true,
  'list_ reflete can_view=true após o set_'
);
SELECT is(
  (SELECT can_create FROM public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  ) WHERE feature_key = '__ump_alpha__'),
  true,
  'list_ reflete can_create=true após o set_'
);
SELECT is(
  (SELECT can_edit FROM public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  ) WHERE feature_key = '__ump_alpha__'),
  false,
  'can_edit continua false (não foi concedido)'
);

SELECT throws_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      '[{"feature_key":"__ump_beta__","can_view":true}]'::jsonb
    )
  $test$,
  'UP004',
  NULL,
  'admin A não consegue conceder permissão em módulo ainda não ativo (beta=pending)'
);

SELECT throws_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000005',
      '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
    )
  $test$,
  'UP001',
  NULL,
  'admin A não consegue definir permissão para usuario B (não pertence à empresa A)'
);

SELECT throws_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
    )
  $test$,
  'UP003',
  NULL,
  'admin A não consegue definir permissão granular para outro admin_empresa (nem para si mesmo)'
);

SELECT throws_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000006',
      '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
    )
  $test$,
  'UP002',
  NULL,
  'admin A não consegue definir permissão granular para uma conta master_admin'
);

SELECT throws_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000008',
      '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
    )
  $test$,
  'UP002',
  NULL,
  'alvo com role dupla (admin_empresa + master_admin) ainda é tratado como master_admin - rejeitado'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. USUARIO A (comum) só lê a própria linha; nunca grava
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT can_create FROM public.list_user_module_permissions('d2000000-0000-4000-8000-000000000001')
   WHERE feature_key = '__ump_alpha__'),
  true,
  'usuario A lê as próprias permissões (self-read, sem informar _user_id)'
);

SELECT throws_ok(
  $test$SELECT public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003'
  )$test$,
  '42501',
  NULL,
  'usuario A não consegue ler permissões de outro usuário (não é admin_empresa)'
);

SELECT throws_ok(
  $test$SELECT public.set_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000003',
    '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
  )$test$,
  '42501',
  NULL,
  'usuario A não consegue chamar set_ - nem para si, nem para ninguém'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. ISOLAMENTO ENTRE EMPRESAS (admin B contra a empresa A)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.list_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'
  )$test$,
  '42501',
  NULL,
  'admin B não lê permissões da empresa A nomeando o empresa_id explicitamente'
);
SELECT throws_ok(
  $test$SELECT public.set_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
  )$test$,
  '42501',
  NULL,
  'admin B não grava permissões na empresa A nomeando o empresa_id explicitamente'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. MASTER NÃO TEM NENHUM ACESSO A PERMISSÕES DE EMPRESA (decisão de
--    produto confirmada - nem leitura, nem mesmo na própria empresa
--    vinculada, e o mesmo vale para quem também detém admin_empresa).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.list_user_module_permissions('d2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Master admin não gerencia permissões de empresa.',
  'master COM empresa vinculada (A) não lista permissões nem da própria empresa'
);
SELECT throws_ok(
  $test$SELECT public.set_user_module_permissions(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    '[{"feature_key":"__ump_alpha__","can_view":true}]'::jsonb
  )$test$,
  '42501',
  'Master admin não gerencia permissões de empresa.',
  'master COM empresa vinculada (A) não grava permissões nem da própria empresa'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.list_user_module_permissions('d2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Master admin não gerencia permissões de empresa.',
  'master SEM empresa vinculada também é bloqueado (não é só um efeito colateral de get_user_empresa_id NULL)'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000008', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.list_user_module_permissions('d2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Master admin não gerencia permissões de empresa.',
  'ator com role dupla (admin_empresa + master_admin) é bloqueado como master, mesmo qualificando como admin_empresa'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. HELPER user_has_module_action (uso futuro em RLS de outras tabelas;
--    aqui só a lógica pura, chamada diretamente)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'create'),
  'admin_empresa: acesso irrestrito ao módulo ativo (sem depender de nenhuma linha na tabela)'
);
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_beta__', 'view'),
  'admin_empresa: módulo não ativo (beta) continua negado mesmo para admin'
);
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'bogus'),
  'ação desconhecida retorna false, não erro'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'view'),
  'usuario A granted: view concedido -> true'
);
SELECT ok(
  public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'create'),
  'usuario A granted: create concedido -> true'
);
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'edit'),
  'usuario A granted: edit NAO concedido -> false'
);
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_beta__', 'view'),
  'usuario A granted: beta não é módulo ativo -> false mesmo sem checar a tabela de permissões'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'view'),
  'usuario A nogrant (antes do backfill): nenhuma linha concedida -> false por padrão'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'create'),
  'master COM empresa vinculada: helper preserva o comportamento JA EXISTENTE (age como admin_empresa na própria empresa) - não é acesso novo desta feature'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'view'),
  'master SEM empresa vinculada: zero acesso operacional, igual ao resto do sistema'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT public.user_has_module_action('d2000000-0000-4000-8000-000000000001', '__ump_alpha__', 'view'),
  'usuario B: empresa_id não bate com a própria -> false (isolamento cross-tenant no helper também)'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. BACKFILL: idempotente, só afeta "usuario", nunca sobrescreve customização
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM public.user_module_permissions
   WHERE user_id = 'd3000000-0000-4000-8000-000000000003'),
  0::bigint,
  'usuario A nogrant não tem nenhuma linha antes do backfill'
);

SELECT lives_ok(
  $test$SELECT public.backfill_user_module_view_permissions()$test$,
  'backfill roda sem erro (chamado de novo, simulando dado pré-existente)'
);

SELECT is(
  (SELECT can_view FROM public.user_module_permissions
   WHERE user_id = 'd3000000-0000-4000-8000-000000000003' AND feature_key = '__ump_alpha__'),
  true,
  'backfill concede can_view=true em alpha (módulo ativo) para usuario A nogrant'
);
SELECT is(
  (SELECT can_create FROM public.user_module_permissions
   WHERE user_id = 'd3000000-0000-4000-8000-000000000003' AND feature_key = '__ump_alpha__'),
  false,
  'backfill nunca concede can_create - só leitura'
);
SELECT is(
  (SELECT count(*) FROM public.user_module_permissions
   WHERE user_id = 'd3000000-0000-4000-8000-000000000003' AND feature_key = '__ump_beta__'),
  0::bigint,
  'backfill não cria linha para módulo não ativo (beta)'
);
SELECT is(
  (SELECT count(*) FROM public.user_module_permissions
   WHERE user_id IN (
     'd3000000-0000-4000-8000-000000000001', -- admin A
     'd3000000-0000-4000-8000-000000000006', -- master with company
     'd3000000-0000-4000-8000-000000000008'  -- dual role
   )),
  0::bigint,
  'backfill nunca cria linha para admin_empresa/master_admin'
);

SELECT lives_ok(
  $test$SELECT public.backfill_user_module_view_permissions()$test$,
  'backfill é idempotente - segunda chamada não erra'
);
SELECT is(
  (SELECT can_create FROM public.user_module_permissions
   WHERE user_id = 'd3000000-0000-4000-8000-000000000002' AND feature_key = '__ump_alpha__'),
  true,
  'backfill repetido NÃO reverte a customização feita pelo admin A na seção 2 (ON CONFLICT DO NOTHING)'
);

SELECT * FROM finish();

ROLLBACK;
