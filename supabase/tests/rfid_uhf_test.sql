-- ============================================================================
-- RFID UHF - rfid_tags / rfid_read_sessions
-- ============================================================================
--
-- Cobre 20260814090000_rfid_uhf_foundation.sql: schema, constraints,
-- triggers e as 6 RPCs (rfid_link_or_replace_tag, rfid_deactivate_tag,
-- rfid_resolve_epcs, rfid_list_material_tags, rfid_start_read_session,
-- rfid_finish_read_session).
--
-- gestao_materiais/rfid_materiais são módulos REAIS (inseridos pelas
-- próprias migrations, não fixtures isoladas como em
-- user_module_permissions_test.sql) porque as RPCs desta migration checam
-- user_has_module_action com a feature_key 'rfid_materiais' hardcoded no
-- corpo da função, não parametrizada - não há como apontar para um
-- module_catalog falso aqui. Os ids são resolvidos por subquery (SELECT id
-- FROM module_catalog WHERE feature_key = ...) em vez de UUID fixo, já que
-- essas linhas usam gen_random_uuid() por padrão.
--
-- RFID é o primeiro módulo gated por user_has_module_action (permissão
-- granular por usuário, 20260810090000_user_module_permissions.sql) em vez
-- do corte só-por-papel que todo outro módulo usa - a seção 5 exercita a
-- progressão real de grant via set_user_module_permissions (a mesma RPC que
-- a tela "Editar Usuário" chama), não um INSERT direto na tabela.
--
-- Fixtures rodam como o dono do banco (bypassa RLS de propósito, mas não os
-- triggers). Asserções trocam de papel via set_config('request.jwt.claim.sub',
-- ...) + SET LOCAL ROLE authenticated, mesmo padrão de
-- user_module_permissions_test.sql/tenant_isolation_matrix_test.sql.

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
  'e1000000-0000-4000-8000-000000000001', '__rfid_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES
  ('e2000000-0000-4000-8000-000000000001', '__rfid_company_a__',
   'ativo', 'e1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days'),
  ('e2000000-0000-4000-8000-000000000002', '__rfid_company_b__',
   'ativo', 'e1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days');

-- gestao_materiais/rfid_materiais são ativados nesta ordem (2 INSERTs
-- separados, não um multi-row) porque enforce_company_module_dependencies
-- exige a dependência já ativa no momento em que rfid_materiais é inserido.
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'e2000000-0000-4000-8000-000000000001', id, 'active'
FROM public.module_catalog WHERE feature_key = 'gestao_materiais';
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'e2000000-0000-4000-8000-000000000001', id, 'active'
FROM public.module_catalog WHERE feature_key = 'rfid_materiais';

INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'e2000000-0000-4000-8000-000000000002', id, 'active'
FROM public.module_catalog WHERE feature_key = 'gestao_materiais';
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'e2000000-0000-4000-8000-000000000002', id, 'active'
FROM public.module_catalog WHERE feature_key = 'rfid_materiais';

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'rfid-admin-a@example.test', '', now(),
   '{}', '{"full_name":"RFID Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'rfid-usuario-a@example.test', '', now(),
   '{}', '{"full_name":"RFID Usuario A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'rfid-admin-b@example.test', '', now(),
   '{}', '{"full_name":"RFID Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'rfid-master-with-company@example.test', '', now(),
   '{}', '{"full_name":"RFID Master With Company"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'rfid-master-no-company@example.test', '', now(),
   '{}', '{"full_name":"RFID Master No Company"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'e3000000-0000-4000-8000-000000000001', -- Admin A
  'e3000000-0000-4000-8000-000000000003'  -- Admin B
);
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id = 'e3000000-0000-4000-8000-000000000002'; -- Usuario A
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id IN (
  'e3000000-0000-4000-8000-000000000004', -- Master with company
  'e3000000-0000-4000-8000-000000000005'  -- Master without company
);

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN 'e3000000-0000-4000-8000-000000000001'::uuid THEN 'e2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'e3000000-0000-4000-8000-000000000002'::uuid THEN 'e2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'e3000000-0000-4000-8000-000000000003'::uuid THEN 'e2000000-0000-4000-8000-000000000002'::uuid
  WHEN 'e3000000-0000-4000-8000-000000000004'::uuid THEN 'e2000000-0000-4000-8000-000000000001'::uuid
  ELSE empresa_id
END
WHERE user_id IN (
  'e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000003',
  'e3000000-0000-4000-8000-000000000004'
);
-- e3...005 (master sem empresa) mantém profiles.empresa_id NULL de propósito.

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES
  ('e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', '__rfid_categoria_a__'),
  ('e5000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', '__rfid_categoria_b__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   'e5000000-0000-4000-8000-000000000001', '__RFID-A1__', 'Material individual A1', 'individual', 1),
  ('e6000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   'e5000000-0000-4000-8000-000000000001', '__RFID-A2__', 'Material individual A2', 'individual', 1),
  ('e6000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001',
   'e5000000-0000-4000-8000-000000000001', '__RFID-A3-QTD__', 'Material a granel A3', 'quantidade', 50),
  ('e6000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002',
   'e5000000-0000-4000-8000-000000000002', '__RFID-B1__', 'Material individual B1', 'individual', 1),
  ('e6000000-0000-4000-8000-000000000005', 'e2000000-0000-4000-8000-000000000001',
   'e5000000-0000-4000-8000-000000000001', '__RFID-A4__', 'Material individual A4', 'individual', 1);

-- ----------------------------------------------------------------------------
-- 1. ESTRUTURAL: RLS, policies, grants
-- ----------------------------------------------------------------------------

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.rfid_tags'::regclass)
  AND (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.rfid_read_sessions'::regclass),
  'RLS está habilitada em rfid_tags e rfid_read_sessions'
);

SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'rfid_tags'),
  1::bigint,
  'rfid_tags tem só a policy de SELECT (escrita é RPC-only)'
);
SELECT is(
  (SELECT count(*) FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'rfid_read_sessions'),
  1::bigint,
  'rfid_read_sessions tem só a policy de SELECT (escrita é RPC-only)'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.rfid_tags', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.rfid_tags', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.rfid_tags', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.rfid_tags', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.rfid_tags', 'SELECT'),
  'rfid_tags: authenticated só tem SELECT direto, anon não tem nada'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.rfid_read_sessions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.rfid_read_sessions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.rfid_read_sessions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.rfid_read_sessions', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.rfid_read_sessions', 'SELECT'),
  'rfid_read_sessions: authenticated só tem SELECT direto, anon não tem nada'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.rfid_link_or_replace_tag(uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rfid_deactivate_tag(uuid,public.rfid_tag_status,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rfid_resolve_epcs(text[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rfid_list_material_tags(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rfid_start_read_session(public.rfid_read_session_type,text,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rfid_finish_read_session(uuid,public.rfid_read_session_status,integer,integer,integer,integer,integer,jsonb)', 'EXECUTE'),
  'authenticated pode executar as 6 RPCs públicas'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.rfid_link_or_replace_tag(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rfid_deactivate_tag(uuid,public.rfid_tag_status,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rfid_resolve_epcs(text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rfid_list_material_tags(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rfid_start_read_session(public.rfid_read_session_type,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rfid_finish_read_session(uuid,public.rfid_read_session_status,integer,integer,integer,integer,integer,jsonb)', 'EXECUTE'),
  'anon não pode executar nenhuma das 6 RPCs'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.rfid_tags (empresa_id, material_id, epc)
    VALUES (
      'e2000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      'not-hex!!'
    )
  $test$,
  '23514',
  NULL,
  'CHECK rejeita EPC fora do formato hexadecimal esperado'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.rfid_tags (empresa_id, material_id, epc)
    VALUES (
      'e2000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000003', -- material a granel (quantidade)
      'AABBCCDD11223344'
    )
  $test$,
  NULL,
  'Somente materiais de controle individual podem receber tag RFID',
  'trigger rejeita tag em material de controle por quantidade mesmo via INSERT direto'
);

-- ----------------------------------------------------------------------------
-- 2. ADMIN A: vincular, tentar conflito, trocar, desativar
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT status FROM public.rfid_link_or_replace_tag(
    'e6000000-0000-4000-8000-000000000001', 'aabbccdd11223344'
  )),
  'ativa'::public.rfid_tag_status,
  'admin A vincula a primeira tag ao material A1 (EPC minúsculo é normalizado)'
);
SELECT is(
  (SELECT epc FROM public.rfid_tags WHERE material_id = 'e6000000-0000-4000-8000-000000000001' AND status = 'ativa'),
  'AABBCCDD11223344',
  'EPC gravado em caixa alta, independente de como foi digitado'
);

SELECT throws_ok(
  $test$
    SELECT public.rfid_link_or_replace_tag(
      'e6000000-0000-4000-8000-000000000002', 'AABBCCDD11223344'
    )
  $test$,
  '23505',
  NULL,
  'impede conflito: mesma tag ativa não pode ser vinculada a um segundo material'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags WHERE material_id = 'e6000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a tentativa de conflito não deixou nenhuma linha órfã no material A2'
);

SELECT throws_ok(
  $test$
    SELECT public.rfid_link_or_replace_tag(
      'e6000000-0000-4000-8000-000000000003', 'BBBBBBBBBBBBBBBB'
    )
  $test$,
  'RF002',
  NULL,
  'RPC rejeita tag em material de controle por quantidade (mesma regra do trigger, mensagem amigável)'
);

SELECT throws_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000001', 'zz')$test$,
  'RF001',
  NULL,
  'RPC rejeita EPC inválido antes de tocar o banco'
);

-- Troca: material A1 já tem AABBCCDD11223344 ativa; troca para uma nova.
SELECT lives_ok(
  $test$
    SELECT public.rfid_link_or_replace_tag(
      'e6000000-0000-4000-8000-000000000001', 'CCDDEEFF11223344'
    )
  $test$,
  'admin A troca a tag do material A1 por uma nova'
);
SELECT is(
  (SELECT status FROM public.rfid_tags WHERE epc = 'AABBCCDD11223344'),
  'inativa'::public.rfid_tag_status,
  'a tag antiga fica inativa após a troca (nunca sobrescrita)'
);
SELECT is(
  (SELECT status FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'),
  'ativa'::public.rfid_tag_status,
  'a nova tag fica ativa'
);
SELECT is(
  (SELECT substituida_por_tag_id FROM public.rfid_tags WHERE epc = 'AABBCCDD11223344'),
  (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'),
  'a tag antiga aponta para a nova via substituida_por_tag_id'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags WHERE material_id = 'e6000000-0000-4000-8000-000000000001'),
  2::bigint,
  'histórico preservado: 2 linhas para o material A1 (antiga inativa + nova ativa), nenhuma apagada'
);

-- A antiga tag (AABBCCDD11223344) agora está livre - pode ser vinculada a
-- outro material sem violar o índice único parcial (só bloqueia ATIVAS).
SELECT lives_ok(
  $test$
    SELECT public.rfid_link_or_replace_tag(
      'e6000000-0000-4000-8000-000000000002', 'AABBCCDD11223344'
    )
  $test$,
  'EPC antigo (agora inativo em outro material) pode ser reaproveitado como tag ativa de um material diferente'
);

-- Desativar sem substituição.
SELECT lives_ok(
  $test$SELECT public.rfid_deactivate_tag(
    (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'),
    'danificada', 'Case caiu no chão'
  )$test$,
  'admin A desativa a tag do material A1 como danificada'
);
SELECT is(
  (SELECT status FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'),
  'danificada'::public.rfid_tag_status,
  'status refletido como danificada'
);
SELECT ok(
  (SELECT desativada_em FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344') IS NOT NULL,
  'desativada_em é preenchido automaticamente'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags WHERE material_id = 'e6000000-0000-4000-8000-000000000001' AND status = 'ativa'),
  0::bigint,
  'material A1 fica sem tag ativa após a desativação (não é vinculação automática de outra)'
);

SELECT throws_ok(
  $test$SELECT public.rfid_deactivate_tag(
    (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'), 'inativa', NULL
  )$test$,
  'RF005',
  NULL,
  'não é possível desativar uma tag que já está inativa'
);

SELECT throws_ok(
  $test$SELECT public.rfid_deactivate_tag(
    (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344'), 'ativa', NULL
  )$test$,
  'RF004',
  NULL,
  'rfid_deactivate_tag recusa _novo_status=ativa (reativação não é uma "desativação")'
);

-- Histórico completo via RPC de leitura.
SELECT is(
  (SELECT count(*) FROM public.rfid_list_material_tags('e6000000-0000-4000-8000-000000000001')),
  2::bigint,
  'rfid_list_material_tags devolve as 2 linhas de histórico do material A1'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. TRIGGER: imutabilidade e bloqueio de reativação (mesmo via UPDATE direto)
-- ----------------------------------------------------------------------------

SELECT throws_ok(
  format(
    $fmt$UPDATE public.rfid_tags SET epc = 'FFFFFFFFFFFFFFFF' WHERE id = %L$fmt$,
    (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344')
  ),
  NULL,
  'EPC de uma tag é imutável; para trocar, desative e vincule uma nova',
  'UPDATE direto não consegue alterar o EPC de uma linha existente'
);

SELECT throws_ok(
  format(
    $fmt$UPDATE public.rfid_tags SET status = 'ativa' WHERE id = %L$fmt$,
    (SELECT id FROM public.rfid_tags WHERE epc = 'CCDDEEFF11223344')
  ),
  NULL,
  'Uma tag desativada não pode ser reativada; crie um novo vínculo',
  'UPDATE direto não consegue reativar uma tag já desativada'
);

-- ----------------------------------------------------------------------------
-- 4. RESOLUÇÃO DE EPC (ativa / inativa / desconhecida) + isolamento
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])),
  'e6000000-0000-4000-8000-000000000002'::uuid,
  'resolve a tag ativa para o material correto (A2, após o reaproveitamento)'
);
SELECT is(
  (SELECT tag_status FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])),
  'ativa'::public.rfid_tag_status,
  'status devolvido é ativa'
);

SELECT is(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['CCDDEEFF11223344'])),
  'e6000000-0000-4000-8000-000000000001'::uuid,
  'tag desativada ainda resolve para o material (para a UI poder mostrar "tag desativada"), não como desconhecida'
);
SELECT is(
  (SELECT tag_status FROM public.rfid_resolve_epcs(ARRAY['CCDDEEFF11223344'])),
  'danificada'::public.rfid_tag_status,
  'status devolvido reflete danificada, não "ativa"'
);

SELECT is(
  (SELECT count(*) FROM public.rfid_resolve_epcs(ARRAY['0000000000000000'])),
  1::bigint,
  'EPC nunca cadastrado ainda gera uma linha de resultado (não é descartado)'
);
SELECT ok(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['0000000000000000'])) IS NULL,
  'EPC desconhecido resolve com material_id nulo'
);

SELECT is(
  (SELECT count(*) FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344', 'not-hex', '0000000000000000'])),
  2::bigint,
  'entrada malformada é descartada silenciosamente do lote, sem quebrar a resolução das demais'
);

SELECT is(
  (SELECT count(*) FROM public.rfid_resolve_epcs(
    ARRAY['AABBCCDD11223344', 'AABBCCDD11223344', 'CCDDEEFF11223344']
  )),
  2::bigint,
  'EPCs duplicados no array de entrada são deduplicados (uma linha por EPC distinto)'
);

RESET ROLE;

-- Empresa B não enxerga nada da empresa A pelo EPC.
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])) IS NULL,
  'admin B não resolve um EPC ativo pertencente à empresa A - aparece como desconhecido, não como erro'
);
SELECT throws_ok(
  $test$SELECT public.rfid_list_material_tags('e6000000-0000-4000-8000-000000000001')$test$,
  '42501',
  NULL,
  'admin B não lista o histórico de tags de um material da empresa A'
);
SELECT throws_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000001', 'DEADBEEFDEADBEEF')$test$,
  '42501',
  NULL,
  'admin B não consegue vincular tag a um material da empresa A'
);
SELECT throws_ok(
  $test$SELECT public.rfid_deactivate_tag(
    -- AABBCCDD11223344 já foi reaproveitado (seção 2): status='ativa' escolhe
    -- a linha corrente em A2 sem ambiguidade (a antiga em A1 ficou inativa).
    (SELECT id FROM public.rfid_tags WHERE epc = 'AABBCCDD11223344' AND status = 'ativa'),
    'inativa', NULL
  )$test$,
  '42501',
  NULL,
  'admin B não consegue desativar uma tag da empresa A'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. PAPÉIS: usuario precisa de grant explícito por ação (nem visualizar é
--    automático só por a empresa ter o módulo); admin_empresa/master seguem
--    irrestritos - nada novo para eles nesta migration.
-- ----------------------------------------------------------------------------

-- Usuario A começa sem nenhuma linha em user_module_permissions para
-- rfid_materiais: nunca foi concedido nada, nem visualizar.
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])$test$,
  '42501',
  NULL,
  'usuario A sem nenhum grant não resolve EPC - módulo contratado pela empresa não basta'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags),
  0::bigint,
  'usuario A sem grant não enxerga nenhuma linha de rfid_tags via SELECT direto (mesma checagem da RLS)'
);
RESET ROLE;

-- Admin A concede só "visualizar" - via a mesma RPC que a tela "Editar
-- Usuário" (UserModulePermissionsFields) chama, não um INSERT direto.
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      '[{"feature_key":"rfid_materiais","can_view":true,"can_create":false,"can_edit":false,"can_delete":false}]'::jsonb
    )
  $test$,
  'admin A concede só "visualizar" RFID para usuario A'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])) IS NOT NULL,
  'usuario A com can_view agora resolve EPC'
);
SELECT ok(
  (SELECT count(*) FROM public.rfid_tags) > 0,
  'usuario A com can_view agora enxerga rfid_tags via SELECT direto'
);
SELECT throws_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000005', 'FEEDFACEFEEDFACE')$test$,
  '42501',
  NULL,
  'usuario A com can_view mas sem can_create ainda não vincula tag (material A4, individual, sem tag)'
);
SELECT throws_ok(
  $test$SELECT public.rfid_start_read_session('conferencia_livre', NULL, NULL, NULL)$test$,
  '42501',
  NULL,
  'usuario A sem can_create também não inicia uma sessão de conferência'
);
RESET ROLE;

-- Admin A amplia para "visualizar + criar".
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      '[{"feature_key":"rfid_materiais","can_view":true,"can_create":true,"can_edit":false,"can_delete":false}]'::jsonb
    )
  $test$,
  'admin A amplia usuario A para visualizar + criar'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000005', 'FEEDFACEFEEDFACE')$test$,
  'usuario A com can_create agora vincula tag ao material A4'
);
SELECT lives_ok(
  $test$SELECT public.rfid_start_read_session('conferencia_livre', NULL, NULL, NULL)$test$,
  'usuario A com can_create também inicia uma sessão de conferência'
);
SELECT throws_ok(
  $test$SELECT public.rfid_deactivate_tag(
    (SELECT id FROM public.rfid_tags WHERE epc = 'FEEDFACEFEEDFACE'), 'inativa', NULL
  )$test$,
  '42501',
  NULL,
  'usuario A com can_create mas sem can_delete ainda não desativa tag'
);
RESET ROLE;

-- Admin A concede também "excluir".
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$
    SELECT public.set_user_module_permissions(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      '[{"feature_key":"rfid_materiais","can_view":true,"can_create":true,"can_edit":false,"can_delete":true}]'::jsonb
    )
  $test$,
  'admin A concede também excluir para usuario A'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.rfid_deactivate_tag(
    (SELECT id FROM public.rfid_tags WHERE epc = 'FEEDFACEFEEDFACE'), 'inativa', NULL
  )$test$,
  'usuario A com can_delete agora desativa a tag do material A4'
);
RESET ROLE;

-- admin_empresa nunca depende de nenhuma linha em user_module_permissions.
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.user_module_permissions
   WHERE user_id = 'e3000000-0000-4000-8000-000000000001'),
  0::bigint,
  'admin A nunca teve nenhuma linha própria em user_module_permissions'
);
SELECT lives_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000001', '1111222233334444')$test$,
  'admin A opera RFID irrestrito mesmo sem nenhuma linha de permissão granular própria'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000005', '2222333344445555')$test$,
  'master COM empresa vinculada (A) continua irrestrito - comportamento já existente, não uma concessão nova desta feature'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])$test$,
  '42501',
  NULL,
  'master SEM empresa vinculada não tem acesso operacional (mesma regra do resto do sistema) - nem visualizar'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. SESSÕES DE CONFERÊNCIA
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT public.rfid_start_read_session('conferencia_locacao', 'locacao', NULL)$test$,
  'RF006',
  NULL,
  'referencia_tipo sem referencia_id é rejeitado'
);

SELECT ok(
  (SELECT status FROM public.rfid_start_read_session(
    'conferencia_locacao', 'locacao', 'f0000000-0000-4000-8000-000000000001', 'Bancada RFID'
  )) = 'em_andamento',
  'sessão de conferência de locação inicia em_andamento'
);
-- tipo é filtro suficiente para identificar a linha sem ambiguidade (é a
-- única sessão desse tipo no teste inteiro) - evitar depender de created_at
-- para desempate, já que now() fica congelado no início da transação e
-- todas as linhas deste arquivo compartilham o mesmo valor.
SELECT is(
  (SELECT responsavel_user_id FROM public.rfid_read_sessions WHERE tipo = 'conferencia_locacao'),
  'e3000000-0000-4000-8000-000000000001'::uuid,
  'responsavel_user_id é sempre o autor autenticado, nunca informado pelo chamador'
);

SELECT lives_ok(
  $test$
    SELECT public.rfid_finish_read_session(
      (SELECT id FROM public.rfid_read_sessions WHERE tipo = 'conferencia_locacao'),
      'concluida', 30, 28, 2, 1, 1,
      '{"found":["e6000000-0000-4000-8000-000000000001"]}'::jsonb
    )
  $test$,
  'finaliza a sessão como concluída com o resumo já calculado pelo motor do frontend'
);
SELECT is(
  (SELECT found_count FROM public.rfid_read_sessions WHERE tipo = 'conferencia_locacao'),
  28,
  'contagens ficam gravadas quando a sessão é concluída'
);

SELECT throws_ok(
  $test$
    SELECT public.rfid_finish_read_session(
      (SELECT id FROM public.rfid_read_sessions WHERE tipo = 'conferencia_locacao'),
      'concluida', 1, 1, 0, 0, 0, NULL
    )
  $test$,
  'RF008',
  NULL,
  'uma sessão já encerrada não pode ser finalizada de novo'
);

-- Sessão cancelada: contagens não são gravadas mesmo se informadas.
SELECT public.rfid_start_read_session('conferencia_livre', NULL, NULL, NULL);
SELECT lives_ok(
  format(
    $fmt$SELECT public.rfid_finish_read_session(%L, 'cancelada', 10, 5, 5, 0, 0, '{"x":1}'::jsonb)$fmt$,
    (SELECT id FROM public.rfid_read_sessions WHERE tipo = 'conferencia_livre' ORDER BY created_at DESC LIMIT 1)
  ),
  'sessão livre pode ser cancelada'
);
SELECT ok(
  (SELECT found_count IS NULL AND resultado IS NULL FROM public.rfid_read_sessions
   WHERE tipo = 'conferencia_livre' ORDER BY created_at DESC LIMIT 1),
  'contagens/resultado NÃO são gravados para uma sessão cancelada, mesmo enviados pelo chamador'
);

RESET ROLE;

-- Isolamento entre empresas nas sessões.
SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format(
    $fmt$SELECT public.rfid_finish_read_session(%L, 'concluida', 1, 1, 0, 0, 0, NULL)$fmt$,
    (SELECT id FROM public.rfid_read_sessions WHERE tipo = 'conferencia_livre' ORDER BY created_at DESC LIMIT 1)
  ),
  '42501',
  NULL,
  'admin B não consegue finalizar uma sessão iniciada pela empresa A'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. DEPENDÊNCIA DE MÓDULO (mecanismo genérico já existente, só confirmando
--    que rfid_materiais está corretamente amarrado a gestao_materiais)
-- ----------------------------------------------------------------------------

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES (
  'e2000000-0000-4000-8000-000000000009', '__rfid_company_no_base__',
  'ativo', 'e1000000-0000-4000-8000-000000000001', false, false, 'pago',
  now() + interval '30 days'
);

SELECT throws_ok(
  $test$
    INSERT INTO public.empresa_modules (empresa_id, module_id, status)
    SELECT 'e2000000-0000-4000-8000-000000000009', id, 'active'
    FROM public.module_catalog WHERE feature_key = 'rfid_materiais'
  $test$,
  NULL,
  'Cannot activate a module before its dependencies',
  'rfid_materiais não pode ser ativado sem gestao_materiais ativo antes (dependência declarada nesta migration)'
);

-- ----------------------------------------------------------------------------
-- 8. ENTITLEMENT: empresa sem módulo ativo, desativação preserva dados,
--    reativação recupera o mesmo acesso - RFID é add-on, não um direito
--    automático de quem já tem gestao_materiais.
-- ----------------------------------------------------------------------------

-- 8a. e2...009 (fixture da seção 7) não tem NENHUM módulo ativo, nem
-- gestao_materiais - nem admin_empresa desta empresa consegue usar RFID.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000009',
  'authenticated', 'authenticated', 'rfid-admin-no-base@example.test', '', now(),
  '{}', '{"full_name":"RFID Admin No Base"}', now(), now()
);
UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = 'e3000000-0000-4000-8000-000000000009';
UPDATE public.profiles SET empresa_id = 'e2000000-0000-4000-8000-000000000009'
WHERE user_id = 'e3000000-0000-4000-8000-000000000009';

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000009', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])$test$,
  '42501',
  NULL,
  'empresa sem rfid_materiais ativo: nem admin_empresa resolve EPC'
);
SELECT throws_ok(
  $test$SELECT public.rfid_start_read_session('conferencia_livre', NULL, NULL, NULL)$test$,
  '42501',
  NULL,
  'empresa sem rfid_materiais ativo: nem admin_empresa inicia sessão'
);
RESET ROLE;

-- 8b. Desativar o módulo para a empresa A preserva os dados já gravados mas
-- bloqueia novas operações, inclusive para admin_empresa.
UPDATE public.empresa_modules
SET status = 'inactive'
WHERE empresa_id = 'e2000000-0000-4000-8000-000000000001'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'rfid_materiais');

SELECT ok(
  (SELECT count(*) FROM public.rfid_tags WHERE empresa_id = 'e2000000-0000-4000-8000-000000000001') > 0,
  'desativar o módulo NÃO apaga nenhuma linha de rfid_tags já existente (consulta como dono, ignorando RLS)'
);
SELECT ok(
  (SELECT count(*) FROM public.rfid_read_sessions WHERE empresa_id = 'e2000000-0000-4000-8000-000000000001') > 0,
  'desativar o módulo NÃO apaga nenhuma sessão de conferência já existente'
);

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])$test$,
  '42501',
  NULL,
  'módulo desativado: admin A não resolve EPC mesmo sendo admin_empresa'
);
SELECT throws_ok(
  $test$SELECT public.rfid_link_or_replace_tag('e6000000-0000-4000-8000-000000000001', '3333444455556666')$test$,
  '42501',
  NULL,
  'módulo desativado: admin A não vincula tag'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags),
  0::bigint,
  'módulo desativado: até o SELECT direto (RLS) some para admin A - dados continuam no banco, só inacessíveis'
);
RESET ROLE;

-- 8c. Reativar o módulo recupera o acesso aos MESMOS dados (não recria nada).
UPDATE public.empresa_modules
SET status = 'active'
WHERE empresa_id = 'e2000000-0000-4000-8000-000000000001'
  AND module_id = (SELECT id FROM public.module_catalog WHERE feature_key = 'rfid_materiais');

SELECT set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT material_id FROM public.rfid_resolve_epcs(ARRAY['AABBCCDD11223344'])) IS NOT NULL,
  'módulo reativado: admin A volta a resolver o mesmo EPC de antes'
);
SELECT is(
  (SELECT count(*) FROM public.rfid_tags WHERE material_id = 'e6000000-0000-4000-8000-000000000001'),
  3::bigint,
  'módulo reativado: histórico de tags do material A1 é exatamente o mesmo de antes da desativação (3 linhas: AABBCCDD inativa, CCDDEEFF danificada, 1111222233334444 ativa)'
);
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
