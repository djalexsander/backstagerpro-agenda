-- Regression test for 20260914100000_company_delete_cascade.sql.
-- Proves that a Master can delete a company which has printer configuration,
-- that representative tenant-owned data is cascaded, and that another tenant
-- plus global Auth identities remain untouched.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(22);

-- Schema contract established by the FK audit: 55 tenant-owned relationships
-- cascade and the two global relationships (profiles/system_logs) set NULL.
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.empresas'::regclass),
  57,
  'all audited foreign keys referencing empresas are present'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.empresas'::regclass AND confdeltype = 'c'),
  55,
  'all tenant-owned foreign keys use ON DELETE CASCADE'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.empresas'::regclass AND confdeltype = 'n'),
  2,
  'the two global relationships retain ON DELETE SET NULL'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.empresas'::regclass
     AND confdeltype NOT IN ('c', 'n')),
  0,
  'no direct company foreign key can block company deletion'
);
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint
   WHERE conname = 'empresa_impressora_config_empresa_id_fkey'),
  'c',
  'printer configuration cascades with its company'
);
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint
   WHERE conname = 'empresa_bobina_perfis_empresa_id_fkey'),
  'c',
  'label-roll profiles cascade with their company'
);
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint
   WHERE conname = 'user_module_permissions_empresa_id_fkey'),
  'c',
  'per-company module permissions cascade with their company'
);
SELECT ok(
  (SELECT condeferrable AND condeferred FROM pg_constraint
   WHERE conname = 'materiais_categoria_id_fkey'),
  'material/category integrity is deferred so the company cascade can finish'
);
SELECT ok(
  (SELECT condeferrable AND condeferred FROM pg_constraint
   WHERE conname = 'financeiro_parcelas_empresa_lancamento_fkey'),
  'financial integrity is deferred so the company cascade can finish'
);
SELECT ok(
  (SELECT condeferrable AND condeferred FROM pg_constraint
   WHERE conname = 'asaas_payments_related_batch_request_id_fkey'),
  'Asaas/batch integrity is deferred so the company cascade can finish'
);
SELECT like(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'etiqueta_impressoes_modelo_company_fk'),
  '%ON DELETE SET NULL (modelo_id)%',
  'printing history only clears modelo_id when a label model is deleted'
);
SELECT like(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'etiqueta_solicitacoes_modelo_company_fk'),
  '%ON DELETE SET NULL (modelo_id)%',
  'label requests only clear modelo_id when a label model is deleted'
);

INSERT INTO public.empresas (id, nome_empresa) VALUES
  ('dc000000-0000-4000-8000-000000000001', '__delete_company_a__'),
  ('dc000000-0000-4000-8000-000000000002', '__delete_company_b__');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'dc100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'delete-company-master@example.test', '', now(),
   '{}', '{"full_name":"Delete Company Master"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dc100000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'delete-company-member-a@example.test', '', now(),
   '{}', '{"full_name":"Delete Company Member A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dc100000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'delete-company-member-b@example.test', '', now(),
   '{}', '{"full_name":"Delete Company Member B"}', now(), now());

UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id = 'dc100000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'dc100000-0000-4000-8000-000000000002',
  'dc100000-0000-4000-8000-000000000003'
);
UPDATE public.profiles
SET empresa_id = CASE user_id
  WHEN 'dc100000-0000-4000-8000-000000000002'::uuid
    THEN 'dc000000-0000-4000-8000-000000000001'::uuid
  WHEN 'dc100000-0000-4000-8000-000000000003'::uuid
    THEN 'dc000000-0000-4000-8000-000000000002'::uuid
END
WHERE user_id IN (
  'dc100000-0000-4000-8000-000000000002',
  'dc100000-0000-4000-8000-000000000003'
);

INSERT INTO public.clientes (
  id, empresa_id, tipo_pessoa, nome, created_by, updated_by
) VALUES
  ('dcc00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'pessoa_fisica', 'Cliente A', 'dc100000-0000-4000-8000-000000000002', 'dc100000-0000-4000-8000-000000000002'),
  ('dcc00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'pessoa_fisica', 'Cliente B', 'dc100000-0000-4000-8000-000000000003', 'dc100000-0000-4000-8000-000000000003');

INSERT INTO public.financeiro_lancamentos (
  id, empresa_id, origem_tipo, origem_id, cliente_id, descricao, valor_original
) VALUES
  ('dcd00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'teste_exclusao_empresa', 'dcd10000-0000-4000-8000-000000000001', 'dcc00000-0000-4000-8000-000000000001', 'Lançamento A', 100),
  ('dcd00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'teste_exclusao_empresa', 'dcd10000-0000-4000-8000-000000000002', 'dcc00000-0000-4000-8000-000000000002', 'Lançamento B', 100);

INSERT INTO public.financeiro_parcelas (
  id, empresa_id, lancamento_id, numero, valor, vencimento
) VALUES
  ('dce00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'dcd00000-0000-4000-8000-000000000001', 1, 100, current_date),
  ('dce00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'dcd00000-0000-4000-8000-000000000002', 1, 100, current_date);

INSERT INTO public.financeiro_recebimentos (
  id, empresa_id, lancamento_id, parcela_id, valor, client_uuid
) VALUES
  ('dcf00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'dcd00000-0000-4000-8000-000000000001', 'dce00000-0000-4000-8000-000000000001', 50, 'dcf10000-0000-4000-8000-000000000001'),
  ('dcf00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'dcd00000-0000-4000-8000-000000000002', 'dce00000-0000-4000-8000-000000000002', 50, 'dcf10000-0000-4000-8000-000000000002');

INSERT INTO public.empresa_bobina_perfis (
  id, empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm
) VALUES
  ('dc200000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'Bobina A', 50, 30),
  ('dc200000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'Bobina B', 50, 30);

INSERT INTO public.empresa_impressora_config (
  id, empresa_id, finalidade, nome_impressora, perfil_bobina_padrao_id
) VALUES
  ('dc300000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'etiqueta', 'Impressora A', 'dc200000-0000-4000-8000-000000000001'),
  ('dc300000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'etiqueta', 'Impressora B', 'dc200000-0000-4000-8000-000000000002');

INSERT INTO public.backups (id, empresa_id, nome) VALUES
  ('dc400000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'Backup A'),
  ('dc400000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'Backup B');

INSERT INTO public.pagamentos (id, empresa_id, valor) VALUES
  ('dc500000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 100),
  ('dc500000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 100);

INSERT INTO public.module_batch_requests (id, empresa_id, valor_total) VALUES
  ('dc510000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 100),
  ('dc510000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 100);

INSERT INTO public.asaas_payments (
  id, payment_type, empresa_id, amount, related_batch_request_id
) VALUES
  ('dc600000-0000-4000-8000-000000000001', 'modules', 'dc000000-0000-4000-8000-000000000001', 100, 'dc510000-0000-4000-8000-000000000001'),
  ('dc600000-0000-4000-8000-000000000002', 'modules', 'dc000000-0000-4000-8000-000000000002', 100, 'dc510000-0000-4000-8000-000000000002');

INSERT INTO public.events (id, empresa_id, date, name, artist, city, venue) VALUES
  ('dc700000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', current_date, 'Evento A', 'Artista A', 'Cidade A', 'Local A'),
  ('dc700000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', current_date, 'Evento B', 'Artista B', 'Cidade B', 'Local B');

INSERT INTO public.categorias_materiais (id, empresa_id, nome) VALUES
  ('dc800000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'Categoria A'),
  ('dc800000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'Categoria B');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES
  ('dc900000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'dc800000-0000-4000-8000-000000000001', 'MAT-A', 'Material A', 'quantidade', 0),
  ('dc900000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'dc800000-0000-4000-8000-000000000002', 'MAT-B', 'Material B', 'quantidade', 0);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome) VALUES
  ('dca00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'LOC-A', 'Local A'),
  ('dca00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'LOC-B', 'Local B');

INSERT INTO public.estoque_saldos (
  id, empresa_id, material_id, localizacao_id, quantidade
) VALUES
  ('dcb00000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'dc900000-0000-4000-8000-000000000001', 'dca00000-0000-4000-8000-000000000001', 0),
  ('dcb00000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'dc900000-0000-4000-8000-000000000002', 'dca00000-0000-4000-8000-000000000002', 0);

-- Flush deferred validations raised by the fixture itself, then defer again so
-- the company delete can remove all sides of the tenant-internal FKs first.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT set_config('request.jwt.claim.sub', 'dc100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ DELETE FROM public.empresas WHERE id = 'dc000000-0000-4000-8000-000000000001' $$,
  'master can delete a company with printer and other tenant-owned data'
);

RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;

SELECT is(
  (SELECT count(*)::integer FROM public.empresas
   WHERE id = 'dc000000-0000-4000-8000-000000000001'),
  0,
  'the selected company is deleted'
);
SELECT is(
  (SELECT count(*)::integer FROM (
    SELECT empresa_id FROM public.empresa_impressora_config
    UNION ALL SELECT empresa_id FROM public.empresa_bobina_perfis
    UNION ALL SELECT empresa_id FROM public.clientes
    UNION ALL SELECT empresa_id FROM public.financeiro_lancamentos
    UNION ALL SELECT empresa_id FROM public.financeiro_parcelas
    UNION ALL SELECT empresa_id FROM public.financeiro_recebimentos
    UNION ALL SELECT empresa_id FROM public.backups
    UNION ALL SELECT empresa_id FROM public.pagamentos
    UNION ALL SELECT empresa_id FROM public.module_batch_requests
    UNION ALL SELECT empresa_id FROM public.asaas_payments
    UNION ALL SELECT empresa_id FROM public.events
    UNION ALL SELECT empresa_id FROM public.categorias_materiais
    UNION ALL SELECT empresa_id FROM public.materiais
    UNION ALL SELECT empresa_id FROM public.estoque_localizacoes
    UNION ALL SELECT empresa_id FROM public.estoque_saldos
  ) AS owned WHERE empresa_id = 'dc000000-0000-4000-8000-000000000001'),
  0,
  'all representative dependent rows of the deleted company are removed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.empresas
   WHERE id = 'dc000000-0000-4000-8000-000000000002'),
  1,
  'the other company remains intact'
);
SELECT is(
  (SELECT count(*)::integer FROM (
    SELECT empresa_id FROM public.empresa_impressora_config
    UNION ALL SELECT empresa_id FROM public.empresa_bobina_perfis
    UNION ALL SELECT empresa_id FROM public.clientes
    UNION ALL SELECT empresa_id FROM public.financeiro_lancamentos
    UNION ALL SELECT empresa_id FROM public.financeiro_parcelas
    UNION ALL SELECT empresa_id FROM public.financeiro_recebimentos
    UNION ALL SELECT empresa_id FROM public.backups
    UNION ALL SELECT empresa_id FROM public.pagamentos
    UNION ALL SELECT empresa_id FROM public.module_batch_requests
    UNION ALL SELECT empresa_id FROM public.asaas_payments
    UNION ALL SELECT empresa_id FROM public.events
    UNION ALL SELECT empresa_id FROM public.categorias_materiais
    UNION ALL SELECT empresa_id FROM public.materiais
    UNION ALL SELECT empresa_id FROM public.estoque_localizacoes
    UNION ALL SELECT empresa_id FROM public.estoque_saldos
  ) AS owned WHERE empresa_id = 'dc000000-0000-4000-8000-000000000002'),
  15,
  'all representative dependent rows of the other company remain intact'
);
SELECT is(
  (SELECT count(*)::integer FROM auth.users
   WHERE id = 'dc100000-0000-4000-8000-000000000002'),
  1,
  'deleting a company does not delete its member Auth identity'
);
SELECT is(
  (SELECT count(*)::integer FROM public.profiles
   WHERE user_id = 'dc100000-0000-4000-8000-000000000002' AND empresa_id IS NULL),
  1,
  'the deleted company is cleared from the surviving profile'
);
SELECT is(
  (SELECT count(*)::integer FROM public.empresa_usuarios
   WHERE empresa_id = 'dc000000-0000-4000-8000-000000000001'),
  0,
  'memberships of the deleted company are cascaded'
);
SELECT is(
  (SELECT count(*)::integer FROM public.empresa_usuarios
   WHERE empresa_id = 'dc000000-0000-4000-8000-000000000002'),
  1,
  'memberships of the other company remain intact'
);
SELECT throws_ok(
  $$ DELETE FROM public.empresa_usuarios
     WHERE empresa_id = 'dc000000-0000-4000-8000-000000000002'
       AND user_id = 'dc100000-0000-4000-8000-000000000003' $$,
  'P0001',
  'The active company membership must be switched before it is removed',
  'direct deletion of an active membership remains protected'
);

SELECT * FROM finish();
ROLLBACK;
