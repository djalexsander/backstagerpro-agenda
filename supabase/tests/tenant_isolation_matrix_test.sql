-- ============================================================================
-- MATRIZ DE ISOLAMENTO CROSS-TENANT (Empresa A / Empresa B / Master com
-- empresa / Master sem empresa / admin / usuario)
-- ============================================================================
--
-- Prova, no banco (RLS + RPCs SECURITY DEFINER), que nenhum ator consegue
-- ler, alterar ou excluir dado operacional de uma empresa que não seja a
-- sua própria - inclusive master_admin, cujo bypass global foi removido em
-- 20260808100000_enforce_master_tenant_isolation.sql. Cobre os módulos
-- centrais (Eventos/Agenda, Financeiro, Funcionários/Painel Operacional,
-- Documentos, Backups, Impressoras, Clientes, Estoque). Check-in/Check-out,
-- Locações, Manutenções e Etiquetas já têm cenário de master dedicado nos
-- respectivos arquivos de stage (material_checkin_checkout_stage_three_
-- extended_test.sql, material_rentals_stage_four_test.sql,
-- equipment_maintenance_stage_five_test.sql, material_labels_stage_six_
-- test.sql / _remote_smoke.sql), todos atualizados junto desta correção -
-- não duplicados aqui.
--
-- Fixtures de setup rodam como o dono do banco (bypassa RLS de propósito,
-- mesmo padrão de todo o resto da suíte). As asserções então trocam de
-- papel via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE
-- authenticated, exatamente como materials_rls_identification_test.sql.

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
  'f1000000-0000-4000-8000-000000000001', '__tenant_matrix_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES
  ('f2000000-0000-4000-8000-000000000001', '__tenant_matrix_company_a__',
   'ativo', 'f1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days'),
  ('f2000000-0000-4000-8000-000000000002', '__tenant_matrix_company_b__',
   'ativo', 'f1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'matrix-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Matrix Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'matrix-user-a@example.test', '', now(),
   '{}', '{"full_name":"Matrix User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'matrix-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Matrix Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'matrix-master-a@example.test', '', now(),
   '{}', '{"full_name":"Matrix Master With Company"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'matrix-master-none@example.test', '', now(),
   '{}', '{"full_name":"Matrix Master Without Company"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000003'
);
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id = 'f3000000-0000-4000-8000-000000000002';
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000004',
  'f3000000-0000-4000-8000-000000000005'
);

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN 'f3000000-0000-4000-8000-000000000001'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000002'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000003'::uuid THEN 'f2000000-0000-4000-8000-000000000002'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000004'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  ELSE empresa_id
END
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000002',
  'f3000000-0000-4000-8000-000000000003',
  'f3000000-0000-4000-8000-000000000004'
);
-- f3...005 (master without a company) deliberately keeps profiles.empresa_id
-- NULL - that is the whole point of this actor in the matrix.

INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT company.id, catalog.id, 'active', now(), true, 'manual_admin'
FROM (VALUES
  ('f2000000-0000-4000-8000-000000000001'::uuid),
  ('f2000000-0000-4000-8000-000000000002'::uuid)
) AS company(id)
CROSS JOIN public.module_catalog AS catalog
WHERE catalog.feature_key IN (
  'financeiro_avancado', 'checklist_tecnico', 'painel_operacional',
  'documentos_avancados', 'relatorios', 'controle_estoque', 'gestao_materiais',
  'locacao_materiais', 'checkin_checkout'
);

-- Company A operational data.
INSERT INTO public.events (id, name, artist, date, status, city, venue, empresa_id, num_days)
VALUES ('f4000000-0000-4000-8000-000000000001', '__matrix_event_a__', 'Artist A', current_date, 'confirmado', 'City A', 'Venue A', 'f2000000-0000-4000-8000-000000000001', 1);
INSERT INTO public.event_days (id, event_id, day_number, empresa_id)
VALUES ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 1, 'f2000000-0000-4000-8000-000000000001');
INSERT INTO public.financials (id, event_id, empresa_id, cache)
VALUES ('f6000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 1000);
INSERT INTO public.funcionarios (id, empresa_id, nome, funcao, tipo)
VALUES ('f7000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Funcionario A', 'Tecnico', 'equipe');
INSERT INTO public.event_funcionarios (id, event_id, funcionario_id, empresa_id)
VALUES ('f7100000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001');
INSERT INTO public.event_checklist_items (id, event_id, empresa_id, categoria, descricao)
VALUES ('f8000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Som', 'Checklist A');
INSERT INTO public.document_templates (id, empresa_id, nome, tipo, conteudo)
VALUES ('f9000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Template A', 'contrato', 'conteudo A');
INSERT INTO public.generated_documents (id, empresa_id, template_id, event_id, nome, tipo)
VALUES ('fa000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Documento A', 'contrato');
INSERT INTO public.backups (id, empresa_id, nome, tipo, payload)
VALUES ('fb000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Backup A', 'manual', '{}'::jsonb);
INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, created_by, updated_by)
VALUES ('fc000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'pessoa_fisica', 'Cliente A', 'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001');
INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES ('fd000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'LOC-A', 'Localizacao A');
-- financeiro_lancamentos/parcelas/recebimentos (rental-financial ledger) had
-- their own copy of the same is_master_admin-in-USING bypass, fixed
-- alongside financials in 20260808100000; one row proves it behaviorally,
-- not just via the migration's own structural policy-text check.
INSERT INTO public.financeiro_lancamentos (id, empresa_id, origem_tipo, origem_id, valor_original)
VALUES ('fe000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'locacao_material', 'fe100000-0000-4000-8000-000000000001', 100);

-- Company B operational data (mirrors A so a leak has something real to find).
INSERT INTO public.events (id, name, artist, date, status, city, venue, empresa_id, num_days)
VALUES ('f4000000-0000-4000-8000-000000000002', '__matrix_event_b__', 'Artist B', current_date, 'confirmado', 'City B', 'Venue B', 'f2000000-0000-4000-8000-000000000002', 1);
INSERT INTO public.event_days (id, event_id, day_number, empresa_id)
VALUES ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 1, 'f2000000-0000-4000-8000-000000000002');
INSERT INTO public.financials (id, event_id, empresa_id, cache)
VALUES ('f6000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 2000);
INSERT INTO public.funcionarios (id, empresa_id, nome, funcao, tipo)
VALUES ('f7000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Funcionario B', 'Tecnico', 'equipe');
INSERT INTO public.event_funcionarios (id, event_id, funcionario_id, empresa_id)
VALUES ('f7100000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002');
INSERT INTO public.event_checklist_items (id, event_id, empresa_id, categoria, descricao)
VALUES ('f8000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Som', 'Checklist B');
INSERT INTO public.document_templates (id, empresa_id, nome, tipo, conteudo)
VALUES ('f9000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Template B', 'contrato', 'conteudo B');
INSERT INTO public.generated_documents (id, empresa_id, template_id, event_id, nome, tipo)
VALUES ('fa000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'Documento B', 'contrato');
INSERT INTO public.backups (id, empresa_id, nome, tipo, payload)
VALUES ('fb000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Backup B', 'manual', '{}'::jsonb);
INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, created_by, updated_by)
VALUES ('fc000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'pessoa_fisica', 'Cliente B', 'f3000000-0000-4000-8000-000000000003', 'f3000000-0000-4000-8000-000000000003');
INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES ('fd000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'LOC-B', 'Localizacao B');

-- ----------------------------------------------------------------------------
-- 1. ADMIN A - controle positivo (prova que a correção não quebrou o uso
--    normal: lê e escreve a própria empresa, inclusive o fluxo que
--    reproduzia o bug original event_belongs_to_company).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.events), 1::bigint, 'admin A sees only company A events');
SELECT is((SELECT count(*) FROM public.financials), 1::bigint, 'admin A sees only company A financials');
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos), 1::bigint, 'admin A sees only company A financeiro_lancamentos');
SELECT is((SELECT count(*) FROM public.funcionarios), 1::bigint, 'admin A sees only company A funcionarios');
SELECT is((SELECT count(*) FROM public.backups), 1::bigint, 'admin A sees only company A backups');
SELECT is((SELECT count(*) FROM public.clientes), 1::bigint, 'admin A sees only company A clientes');
SELECT is((SELECT count(*) FROM public.estoque_localizacoes), 1::bigint, 'admin A sees only company A stock locations');

-- Same shape that used to fail with "permission denied for function
-- event_belongs_to_company" before 20260808090000.
SELECT lives_ok(
  $test$INSERT INTO public.event_days (event_id, day_number, empresa_id)
        VALUES ('f4000000-0000-4000-8000-000000000001', 2, 'f2000000-0000-4000-8000-000000000001')$test$,
  'admin A can add a second day to its own event (event_belongs_to_company grant fix)'
);
SELECT lives_ok(
  $test$INSERT INTO public.event_checklist_items (event_id, empresa_id, categoria, descricao)
        VALUES ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Luz', 'Novo item')$test$,
  'admin A can add a checklist item to its own event'
);
SELECT lives_ok(
  $test$UPDATE public.financials SET cache = 1500 WHERE id = 'f6000000-0000-4000-8000-000000000001'$test$,
  'admin A can update its own financial record'
);

SELECT is(
  (SELECT count(*) FROM public.listar_clientes(NULL, true, 100, NULL)),
  1::bigint,
  'admin A can list its own clients via RPC'
);
SELECT lives_ok(
  $test$SELECT public.salvar_cliente('pessoa_fisica','Novo Cliente A')$test$,
  'admin A can create a client via RPC'
);
SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora('etiqueta','Zebra A')$test$,
  'admin A can save its own printer config via RPC'
);
SELECT is(
  (SELECT count(*) FROM public.obter_configuracoes_impressora(NULL)),
  1::bigint,
  'admin A reads back exactly its own printer config'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. USUARIO A - lê a própria empresa, não escreve financeiro/backups.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events), 1::bigint, 'usuario A also reads only company A events');
SELECT is((SELECT count(*) FROM public.financials), 0::bigint, 'usuario A cannot even read financials (admin-only module)');
-- financials is invisible to usuario A via USING, so the UPDATE's WHERE
-- matches zero rows and completes without error (RLS filters silently on
-- UPDATE/DELETE - it only raises when a row IS visible but WITH CHECK
-- rejects the resulting row, which is the INSERT/cross-tenant cases below).
-- A data-modifying WITH must be the top-level statement, so the mutation
-- attempt runs bare here and the real row state is checked afterward as the
-- table owner (bypasses RLS, sees ground truth).
UPDATE public.financials SET cache = 9999 WHERE id = 'f6000000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT is(
  (SELECT cache FROM public.financials WHERE id = 'f6000000-0000-4000-8000-000000000001'),
  1500::numeric,
  'usuario A''s write attempt on financials left the value unchanged (still admin A''s 1500)'
);

-- ----------------------------------------------------------------------------
-- 3. ADMIN B - isolamento clássico entre duas empresas comuns (já deveria
--    valer antes desta correção; reconfirmado para não ter regressão).
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.events), 1::bigint, 'admin B sees only its own event (not A''s)');
SELECT is(
  (SELECT count(*) FROM public.events WHERE id = 'f4000000-0000-4000-8000-000000000001'),
  0::bigint,
  'admin B cannot see company A event by id'
);
-- A data-modifying WITH must be the top-level statement, so these mutation
-- attempts run bare and the real row state is checked afterward as the
-- table owner (bypasses RLS, sees ground truth) further below.
UPDATE public.events SET name = 'hacked-by-b' WHERE id = 'f4000000-0000-4000-8000-000000000001';
DELETE FROM public.event_checklist_items WHERE id = 'f8000000-0000-4000-8000-000000000001';
SELECT throws_ok(
  $test$INSERT INTO public.financials (event_id, empresa_id, cache)
        VALUES ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002', 500)$test$,
  '42501',
  NULL,
  'admin B cannot attach a financial row to company A''s event by naming its own empresa_id'
);
SELECT throws_ok(
  $test$SELECT public.listar_clientes(NULL, true, 100, 'f2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Empresa inválida.',
  'admin B cannot list company A clients by naming its id explicitly'
);
SELECT throws_ok(
  $test$SELECT public.obter_configuracoes_impressora('f2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Empresa inválida.',
  'admin B cannot read company A printer config by naming its id explicitly'
);
RESET ROLE;

SELECT is(
  (SELECT name FROM public.events WHERE id = 'f4000000-0000-4000-8000-000000000001'),
  '__matrix_event_a__',
  'admin B''s cross-tenant UPDATE attempt left company A event name unchanged'
);
SELECT is(
  (SELECT count(*) FROM public.event_checklist_items WHERE id = 'f8000000-0000-4000-8000-000000000001'),
  1::bigint,
  'admin B''s cross-tenant DELETE attempt left company A checklist item in place'
);

-- ----------------------------------------------------------------------------
-- 4. MASTER COM EMPRESA VINCULADA (A) - opera A como se fosse admin_empresa
--    de A; não tem nenhum acesso especial a B.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.events), 1::bigint, 'master with company A sees only company A events, not B''s');
SELECT is(
  (SELECT count(*) FROM public.backups),
  1::bigint,
  'master with company A sees only company A backups'
);
SELECT lives_ok(
  $test$UPDATE public.financials SET cache = 1750 WHERE id = 'f6000000-0000-4000-8000-000000000001'$test$,
  'master with company A can write company A financials (acts as admin_empresa there)'
);
-- A data-modifying WITH must be the top-level statement, so the mutation
-- attempt runs bare and the real row state is checked right after RESET
-- ROLE at the end of this actor's section.
UPDATE public.events SET name = 'hacked-by-master' WHERE id = 'f4000000-0000-4000-8000-000000000002';
SELECT is(
  (SELECT count(*) FROM public.events WHERE id = 'f4000000-0000-4000-8000-000000000002'),
  0::bigint,
  'master with company A cannot read company B event by id'
);
SELECT is(
  (SELECT count(*) FROM public.listar_clientes(NULL, true, 100, NULL)),
  2::bigint,
  'master with company A lists exactly its own company''s clients via RPC (seed + admin A''s RPC-created one)'
);
SELECT throws_ok(
  $test$SELECT public.listar_clientes(NULL, true, 100, 'f2000000-0000-4000-8000-000000000002')$test$,
  '42501',
  'Empresa inválida.',
  'master with company A cannot list company B clients by naming its id explicitly'
);
SELECT throws_ok(
  $test$SELECT public.salvar_configuracao_impressora('etiqueta','Zebra B',NULL,NULL,NULL,'retrato',true,'{}','f2000000-0000-4000-8000-000000000002')$test$,
  '42501',
  'Empresa inválida.',
  'master with company A cannot write company B printer config by naming its id explicitly'
);
RESET ROLE;

SELECT is(
  (SELECT name FROM public.events WHERE id = 'f4000000-0000-4000-8000-000000000002'),
  '__matrix_event_b__',
  'master with company A''s cross-tenant UPDATE attempt left company B event name unchanged'
);

-- ----------------------------------------------------------------------------
-- 5. MASTER SEM EMPRESA VINCULADA - zero acesso operacional, para as duas
--    empresas, mesmo nomeando o id explicitamente.
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.events), 0::bigint, 'master without a company reads zero events');
SELECT is((SELECT count(*) FROM public.financials), 0::bigint, 'master without a company reads zero financials');
SELECT is((SELECT count(*) FROM public.funcionarios), 0::bigint, 'master without a company reads zero funcionarios');
SELECT is((SELECT count(*) FROM public.backups), 0::bigint, 'master without a company reads zero backups');
SELECT is((SELECT count(*) FROM public.financeiro_lancamentos), 0::bigint, 'master without a company reads zero financeiro_lancamentos');
SELECT is((SELECT count(*) FROM public.clientes), 0::bigint, 'master without a company reads zero clientes directly');
SELECT is((SELECT count(*) FROM public.estoque_localizacoes), 0::bigint, 'master without a company reads zero stock locations');
SELECT is((SELECT count(*) FROM public.document_templates), 0::bigint, 'master without a company reads zero document templates');
SELECT is((SELECT count(*) FROM public.generated_documents), 0::bigint, 'master without a company reads zero generated documents');

SELECT throws_ok(
  $test$INSERT INTO public.event_checklist_items (event_id, empresa_id, categoria, descricao)
        VALUES ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Som', 'tentativa')$test$,
  '42501',
  NULL,
  'master without a company cannot insert a checklist item into company A by naming its id'
);
SELECT throws_ok(
  $test$SELECT public.listar_clientes()$test$,
  '42501',
  'Empresa inválida.',
  'master without a company cannot infer a clientes tenant'
);
SELECT throws_ok(
  $test$SELECT public.listar_clientes(NULL, true, 100, 'f2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Empresa inválida.',
  'master without a company cannot read company A clients by naming its id explicitly'
);
SELECT throws_ok(
  $test$SELECT public.salvar_cliente('pessoa_fisica','Intruso',NULL,NULL,NULL,NULL,NULL,NULL,'f2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Empresa inválida.',
  'master without a company cannot create a client in company A'
);
SELECT throws_ok(
  $test$SELECT public.obter_configuracoes_impressora('f2000000-0000-4000-8000-000000000001')$test$,
  '42501',
  'Empresa inválida.',
  'master without a company cannot read company A printer config'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. HARDENING: os dois SECURITY DEFINER sem nenhum REVOKE/GRANT continuam
--    bloqueados para anon/authenticated/service_role depois de
--    20260808110000 (não é papel deste arquivo repetir o teste completo do
--    bug de cada um, só confirmar que a superfície pública ficou fechada).
-- ----------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.provision_company_module_entitlements(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.provision_company_module_entitlements(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.provision_company_module_entitlements(uuid)', 'EXECUTE'),
  'provision_company_module_entitlements is unreachable by anon/authenticated/service_role'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.sync_material_rental_status(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sync_material_rental_status(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.sync_material_rental_status(uuid,uuid)', 'EXECUTE'),
  'sync_material_rental_status is unreachable by anon/authenticated/service_role'
);

SELECT * FROM finish();

ROLLBACK;
