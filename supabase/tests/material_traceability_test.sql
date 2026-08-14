-- ============================================================================
-- Rastreabilidade de Materiais - buscar_rastreabilidade_materiais /
-- obter_rastreabilidade_material / resumo_situacao_material
-- ============================================================================
--
-- Cobre 20260814100000_material_traceability_foundation.sql. Não exercita
-- checkout/checkin/locacao/manutencao/RFID em si (isso já é coberto por
-- checkin_checkout_test.sql / material_rentals_test.sql / equipment_
-- maintenance_test.sql / rfid_uhf_test.sql) - aqui essas RPCs só são usadas
-- para produzir estado físico realista (custódia aberta, locação concluída
-- duas vezes, manutenção aberta, tag RFID vinculada) que a camada de
-- rastreabilidade então precisa ler e agregar corretamente.
--
-- gestao_materiais/controle_estoque/checkin_checkout/locacao_materiais/
-- manutencao_equipamentos/rfid_materiais são módulos REAIS (mesma razão do
-- rfid_uhf_test.sql: as RPCs desta migration checam feature_key hardcoded).
--
-- Fixtures rodam como o dono do banco (bypassa RLS, mas não os triggers -
-- por isso material_custodias/material_locacoes/manutencao_ordens/rfid_tags
-- são sempre produzidos via as RPCs canônicas de cada domínio, nunca por
-- INSERT direto). materiais/clientes/categorias/localizações são inseridos
-- diretamente, mesmo padrão de rfid_uhf_test.sql.
--
-- Encadeamento de ids entre chamadas de RPC (locação -> item -> custódia)
-- usa uma tabela temporária (trace_scratch), não \gset/\set: nenhum outro
-- arquivo em supabase/tests usa meta-comandos do psql, então esta suíte
-- segue o mesmo padrão SQL-puro por consistência com o runner existente.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE trace_scratch (key text PRIMARY KEY, value uuid) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- 0. FIXTURES
-- ----------------------------------------------------------------------------

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  'f1000000-0000-4000-8000-000000000001', '__trace_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado, precisa_escolher_plano,
  status_pagamento, vencimento
) VALUES
  ('f2000000-0000-4000-8000-000000000001', '__trace_company_a__',
   'ativo', 'f1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days'),
  ('f2000000-0000-4000-8000-000000000002', '__trace_company_b__',
   'ativo', 'f1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days');

-- Empresa A: todos os módulos do domínio de materiais ativos, incluindo RFID.
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'f2000000-0000-4000-8000-000000000001', id, 'active'
FROM public.module_catalog
WHERE feature_key IN (
  'gestao_materiais', 'controle_estoque', 'checkin_checkout',
  'locacao_materiais', 'manutencao_equipamentos', 'rfid_materiais'
);

-- Empresa B: só o essencial para existir/buscar materiais - sem locação e
-- deliberadamente SEM rfid_materiais (cobre "RFID desativado para a empresa").
INSERT INTO public.empresa_modules (empresa_id, module_id, status)
SELECT 'f2000000-0000-4000-8000-000000000002', id, 'active'
FROM public.module_catalog
WHERE feature_key IN ('gestao_materiais', 'controle_estoque', 'checkin_checkout');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'trace-admin-a@example.test', '', now(),
   '{}', '{"full_name":"Trace Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'trace-usuario-a-com@example.test', '', now(),
   '{}', '{"full_name":"Trace Usuario A Com Permissao"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'trace-usuario-a-sem@example.test', '', now(),
   '{}', '{"full_name":"Trace Usuario A Sem Permissao"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'trace-admin-b@example.test', '', now(),
   '{}', '{"full_name":"Trace Admin B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'trace-master-with-company@example.test', '', now(),
   '{}', '{"full_name":"Trace Master With Company"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f3000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'trace-master-no-company@example.test', '', now(),
   '{}', '{"full_name":"Trace Master No Company"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000001', -- Admin A
  'f3000000-0000-4000-8000-000000000004'  -- Admin B
);
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000002', -- Usuario A com permissão
  'f3000000-0000-4000-8000-000000000003'  -- Usuario A sem permissão
);
UPDATE public.user_roles SET role = 'master_admin'
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000005', -- Master com empresa
  'f3000000-0000-4000-8000-000000000006'  -- Master sem empresa
);

UPDATE public.profiles SET empresa_id = CASE user_id
  WHEN 'f3000000-0000-4000-8000-000000000001'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000002'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000003'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000004'::uuid THEN 'f2000000-0000-4000-8000-000000000002'::uuid
  WHEN 'f3000000-0000-4000-8000-000000000005'::uuid THEN 'f2000000-0000-4000-8000-000000000001'::uuid
  ELSE empresa_id
END
WHERE user_id IN (
  'f3000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000002',
  'f3000000-0000-4000-8000-000000000003',
  'f3000000-0000-4000-8000-000000000004',
  'f3000000-0000-4000-8000-000000000005'
);
-- f3...006 (master sem empresa) mantém profiles.empresa_id NULL de propósito.

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES
  ('f5000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', '__trace_categoria_a__'),
  ('f5000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', '__trace_categoria_b__');

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome)
VALUES
  ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'EST-A', 'Estoque Principal A'),
  ('f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'EST-B', 'Estoque Principal B');

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, ativo, created_by, updated_by)
VALUES (
  'f7000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'pessoa_juridica', '__Cliente Rastreabilidade LTDA__', true,
  'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001'
);

-- Materiais empresa A - um por cenário de situação/identificador, mais um
-- pequeno lote para "múltiplos resultados" e outro para paginação.
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade,
  numero_patrimonio, numero_serie, codigo_barras, identificador_unico, conteudo_qr_code
) VALUES
  ('f6000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-DISP-001', '__Trace Disponivel__', 'individual', 1,
   'PAT-DISP-001', NULL, NULL,
   'a6000000-0000-4000-8000-000000000001', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-VAZIO-001', '__Trace Sem Historico__', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000002', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000002'),
  ('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-LOC-001', '__Trace Locado__', 'individual', 1,
   NULL, 'SER-LOC-001', NULL,
   'a6000000-0000-4000-8000-000000000003', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000003'),
  ('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-MULTI-001', '__Trace Multi Locacao__', 'individual', 1,
   NULL, NULL, 'BC-000111222',
   'a6000000-0000-4000-8000-000000000004', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000004'),
  ('f6000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-MANUT-001', '__Trace Manutencao__', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000005', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000005'),
  ('f6000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'TRK-EMP-001', '__Trace Emprestado__', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000006', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000006'),
  ('f6000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'MIC-001', 'Microfone Sem Fio Alfa', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000011', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000011'),
  ('f6000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'MIC-002', 'Microfone Sem Fio Beta', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000012', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000012'),
  ('f6000000-0000-4000-8000-000000000013', 'f2000000-0000-4000-8000-000000000001',
   'f5000000-0000-4000-8000-000000000001', 'MIC-003', 'Microfone Sem Fio Gama', 'individual', 1,
   NULL, NULL, NULL,
   'a6000000-0000-4000-8000-000000000013', 'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000013');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
)
SELECT
  ('f6000000-0000-4000-8000-' || lpad((60 + n)::text, 12, '0'))::uuid,
  'f2000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'PGN-' || lpad(n::text, 2, '0'),
  '__Trace Paginacao Item ' || lpad(n::text, 2, '0') || '__',
  'individual', 1
FROM generate_series(1, 12) AS n;

-- Material empresa B (isolamento) - mesmo termo de busca ("Microfone") que
-- os materiais MIC-00x da empresa A, para provar que a empresa A nunca vê
-- este resultado e vice-versa.
INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, quantidade
) VALUES (
  'f6000000-0000-4000-8000-000000000090', 'f2000000-0000-4000-8000-000000000002',
  'f5000000-0000-4000-8000-000000000002', 'MIC-B-001', 'Microfone Isolamento Empresa B', 'individual', 1
);

-- ----------------------------------------------------------------------------
-- 1. ESTADO OPERACIONAL - produzido só via as RPCs canônicas de cada domínio
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- Saldo inicial (não para TRK-VAZIO-001, de propósito - cobre "histórico vazio").
SELECT public.registrar_movimentacao_estoque(
  _material_id => 'f6000000-0000-4000-8000-000000000001', _tipo => 'entrada', _quantidade => 1,
  _client_uuid => gen_random_uuid(), _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
SELECT public.registrar_movimentacao_estoque(
  _material_id => 'f6000000-0000-4000-8000-000000000003', _tipo => 'entrada', _quantidade => 1,
  _client_uuid => gen_random_uuid(), _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
SELECT public.registrar_movimentacao_estoque(
  _material_id => 'f6000000-0000-4000-8000-000000000004', _tipo => 'entrada', _quantidade => 1,
  _client_uuid => gen_random_uuid(), _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
SELECT public.registrar_movimentacao_estoque(
  _material_id => 'f6000000-0000-4000-8000-000000000006', _tipo => 'entrada', _quantidade => 1,
  _client_uuid => gen_random_uuid(), _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

-- TRK-LOC-001: locação aberta, retirada já feita, previsão VENCIDA (cobre
-- "locado" + destino atual + atrasado=true).
INSERT INTO trace_scratch(key, value)
SELECT 'locacao1_id', (public.criar_locacao_material(
  _cliente_id => 'f7000000-0000-4000-8000-000000000001',
  _retirada_prevista_em => now() - interval '5 days',
  _devolucao_prevista_em => now() - interval '1 day',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;

INSERT INTO trace_scratch(key, value)
SELECT 'locacao1_item_id', (public.salvar_item_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao1_id'),
  _material_id => 'f6000000-0000-4000-8000-000000000003',
  _quantidade => 1, _modalidade_cobranca => 'fixo', _unidades_cobranca => 1,
  _valor_unitario => 100, _desconto => 0, _client_uuid => gen_random_uuid(),
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;

SELECT public.confirmar_reserva_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao1_id'),
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
SELECT public.registrar_retirada_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao1_id'),
  _item_id => (SELECT value FROM trace_scratch WHERE key = 'locacao1_item_id'),
  _quantidade => 1,
  _localizacao_origem_id => 'f4000000-0000-4000-8000-000000000001',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _condicao_saida => 'bom', _client_uuid => gen_random_uuid(),
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

-- TRK-MULTI-001: DUAS locações completas (retirada + devolução cada), em
-- ordem cronológica distinta - cobre "já retornou" + "histórico com várias
-- locações" sem sobrepor custódias abertas (a segunda só abre depois da
-- primeira estar 'concluida', respeitando material_custodias_individual_active_uidx).
INSERT INTO trace_scratch(key, value)
SELECT 'locacao2_id', (public.criar_locacao_material(
  _cliente_id => 'f7000000-0000-4000-8000-000000000001',
  _retirada_prevista_em => now() - interval '12 days',
  _devolucao_prevista_em => now() - interval '8 days',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
INSERT INTO trace_scratch(key, value)
SELECT 'locacao2_item_id', (public.salvar_item_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_id'),
  _material_id => 'f6000000-0000-4000-8000-000000000004',
  _quantidade => 1, _modalidade_cobranca => 'fixo', _unidades_cobranca => 1,
  _valor_unitario => 80, _desconto => 0, _client_uuid => gen_random_uuid(),
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
SELECT public.confirmar_reserva_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_id'),
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
INSERT INTO trace_scratch(key, value)
SELECT 'locacao2_custodia_id', (public.registrar_retirada_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_id'),
  _item_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_item_id'),
  _quantidade => 1,
  _localizacao_origem_id => 'f4000000-0000-4000-8000-000000000001',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _condicao_saida => 'bom', _client_uuid => gen_random_uuid(),
  _data_efetiva => now() - interval '10 days',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
SELECT public.registrar_devolucao_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_id'),
  _custodia_id => (SELECT value FROM trace_scratch WHERE key = 'locacao2_custodia_id'),
  _quantidade => 1,
  _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001', _condicao_retorno => 'bom',
  _client_uuid => gen_random_uuid(), _data_efetiva => now() - interval '9 days',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

INSERT INTO trace_scratch(key, value)
SELECT 'locacao3_id', (public.criar_locacao_material(
  _cliente_id => 'f7000000-0000-4000-8000-000000000001',
  _retirada_prevista_em => now() - interval '6 days',
  _devolucao_prevista_em => now() - interval '3 days',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
INSERT INTO trace_scratch(key, value)
SELECT 'locacao3_item_id', (public.salvar_item_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_id'),
  _material_id => 'f6000000-0000-4000-8000-000000000004',
  _quantidade => 1, _modalidade_cobranca => 'fixo', _unidades_cobranca => 1,
  _valor_unitario => 80, _desconto => 0, _client_uuid => gen_random_uuid(),
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
SELECT public.confirmar_reserva_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_id'),
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);
INSERT INTO trace_scratch(key, value)
SELECT 'locacao3_custodia_id', (public.registrar_retirada_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_id'),
  _item_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_item_id'),
  _quantidade => 1,
  _localizacao_origem_id => 'f4000000-0000-4000-8000-000000000001',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _condicao_saida => 'bom', _client_uuid => gen_random_uuid(),
  _data_efetiva => now() - interval '5 days',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
)).id;
SELECT public.registrar_devolucao_locacao_material(
  _locacao_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_id'),
  _custodia_id => (SELECT value FROM trace_scratch WHERE key = 'locacao3_custodia_id'),
  _quantidade => 1,
  _localizacao_destino_id => 'f4000000-0000-4000-8000-000000000001', _condicao_retorno => 'bom',
  _client_uuid => gen_random_uuid(), _data_efetiva => now() - interval '4 days',
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

-- TRK-EMP-001: custódia aberta SEM locação (finalidade uso_interno) - cobre
-- "emprestado" como situação distinta de "locado".
SELECT public.registrar_checkout_material(
  _material_id => 'f6000000-0000-4000-8000-000000000006', _quantidade => 1,
  _localizacao_origem_id => 'f4000000-0000-4000-8000-000000000001',
  _responsavel_tipo => 'usuario', _responsavel_id => 'f3000000-0000-4000-8000-000000000002',
  _finalidade => 'uso_interno', _condicao_saida => 'bom', _client_uuid => gen_random_uuid(),
  _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

-- TRK-MANUT-001: ordem de manutenção aberta (sem custódia, sem estoque -
-- manutenção não movimenta saldo neste domínio).
SELECT public.criar_ordem_manutencao(
  _material_id => 'f6000000-0000-4000-8000-000000000005', _tipo => 'corretiva',
  _prioridade => 'normal', _origem => 'manual', _defeito_relatado => 'Conector danificado',
  _client_uuid => gen_random_uuid(), _empresa_id => 'f2000000-0000-4000-8000-000000000001'
);

-- TRK-DISP-001 também recebe uma tag RFID ativa - cobre busca por EPC e o
-- item "rfid_tag_vinculada" na timeline quando o módulo está ativo.
SELECT public.rfid_link_or_replace_tag('f6000000-0000-4000-8000-000000000001', 'AABBCCDD11223344');

-- Usuario A "com permissão" recebe grant explícito de visualizar Gestão de
-- Materiais (gestao_materiais é anterior ao backfill de 20260810090000, mas
-- este é um fixture isolado, não o backfill histórico real - sem o grant
-- explícito, um "usuario" novo começa em zero, exatamente como
-- 20260810090000 documenta para módulos ativados depois do backfill).
SELECT public.set_user_module_permissions(
  'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002',
  '[{"feature_key":"gestao_materiais","can_view":true,"can_create":false,"can_edit":false,"can_delete":false}]'::jsonb
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 2. SITUAÇÃO ATUAL
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'situacao',
  'disponivel',
  'TRK-DISP-001: situação disponível'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' -> 'localizacoes' -> 0 ->> 'localizacao_codigo',
  'EST-A',
  'TRK-DISP-001: disponível mostra a localização real do saldo (não materiais.localizacao)'
);

SELECT is(
  jsonb_array_length(
    (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001')) -> 'timeline'
  ),
  0,
  'TRK-VAZIO-001: histórico vazio (nenhuma movimentação/custódia/manutenção)'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' -> 'localizacoes',
  '[]'::jsonb,
  'TRK-VAZIO-001: sem saldo em nenhuma localização'
);

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'situacao',
  'locado',
  'TRK-LOC-001: situação locado (custódia aberta ligada a locacao_item)'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' -> 'locacao' ->> 'cliente_nome',
  '__Cliente Rastreabilidade LTDA__',
  'TRK-LOC-001: destino atual mostra o cliente da locação'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'retirado_por',
  'Trace Usuario A Com Permissao',
  'TRK-LOC-001: "retirado por" é o responsável pela custódia (não quem operou)'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'liberado_por',
  'Trace Admin A',
  'TRK-LOC-001: "liberado por" é quem executou o checkout (Admin A)'
);
SELECT ok(
  ((public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'atrasado')::boolean,
  'TRK-LOC-001: previsão de retorno vencida marca atrasado=true'
);

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'situacao',
  'emprestado',
  'TRK-EMP-001: situação emprestado (custódia sem vínculo de locação)'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' -> 'locacao',
  NULL::jsonb,
  'TRK-EMP-001: emprestado não carrega bloco de locação'
);

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'situacao',
  'em_manutencao',
  'TRK-MANUT-001: situação em manutenção'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'manutencao_status',
  'aberta',
  'TRK-MANUT-001: status da ordem de manutenção exposto'
);

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'situacao',
  'disponivel',
  'TRK-MULTI-001: já retornou (volta a disponível após a 2a devolução)'
);
SELECT ok(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001'))
    -> 'resumo' ->> 'ultimo_retorno_recebido_por' IS NOT NULL,
  'TRK-MULTI-001: "quem recebeu" no último retorno vem do evento de checkin, não da custódia'
);

WITH timeline AS (
  SELECT jsonb_array_elements(
    (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001')) -> 'timeline'
  ) AS entry
)
SELECT is(
  (SELECT count(*) FROM timeline WHERE entry ->> 'tipo' IN ('checkout', 'checkin')),
  4::bigint,
  'TRK-MULTI-001: timeline tem exatamente 4 eventos físicos (2 checkout + 2 checkin), nenhum duplicado via material_locacao_eventos'
);
WITH timeline AS (
  SELECT jsonb_array_elements(
    (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001')) -> 'timeline'
  ) AS entry
)
SELECT is(
  (SELECT count(DISTINCT entry -> 'detalhes' ->> 'locacao_numero') FROM timeline WHERE entry -> 'detalhes' ->> 'locacao_numero' IS NOT NULL),
  2::bigint,
  'TRK-MULTI-001: histórico com várias locações - 2 números de locação distintos aparecem na timeline'
);
WITH timeline AS (
  SELECT entry, row_number() OVER () AS position
  FROM jsonb_array_elements(
    (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001')) -> 'timeline'
  ) AS entry
)
SELECT ok(
  (SELECT (entry ->> 'data')::timestamptz FROM timeline WHERE position = 1)
    > (SELECT (entry ->> 'data')::timestamptz FROM timeline WHERE position = 4),
  'TRK-MULTI-001: timeline ordenada do mais recente para o mais antigo'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 3. BUSCA - identificadores, múltiplos resultados, material inexistente
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'Trace Disponivel', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000001'::uuid,
  'busca por nome (substring) encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'TRK-DISP-001', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000001'::uuid,
  'busca por código interno exato encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'PAT-DISP-001', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000001'::uuid,
  'busca por patrimônio exato encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'SER-LOC-001', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000003'::uuid,
  'busca por número de série exato encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'BC-000111222', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000004'::uuid,
  'busca por código de barras exato encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'BACKSTAGE-PRO:MATERIAL:a6000000-0000-4000-8000-000000000005', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000005'::uuid,
  'busca pelo conteúdo do QR Code exato encontra o material'
);
SELECT is(
  (SELECT (item ->> 'id')::uuid FROM public.buscar_rastreabilidade_materiais(
    'aabbccdd11223344', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'f6000000-0000-4000-8000-000000000001'::uuid,
  'busca por EPC RFID (minúsculo) encontra o material vinculado quando o módulo está ativo'
);

SELECT is(
  (SELECT total_count FROM public.buscar_rastreabilidade_materiais(
    'Microfone Sem Fio', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  3::bigint,
  'múltiplos resultados: "Microfone Sem Fio" encontra os 3 microfones da empresa A'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.buscar_rastreabilidade_materiais(
      'Microfone', 20, 0, 'f2000000-0000-4000-8000-000000000001'
    ) WHERE (item ->> 'id')::uuid = 'f6000000-0000-4000-8000-000000000090'
  ),
  'isolamento: busca "Microfone" da empresa A nunca retorna o microfone da empresa B'
);

SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Microfone', 20, 0, 'f2000000-0000-4000-8000-000000000002'
  )),
  1::bigint,
  'isolamento: empresa B busca "Microfone" e só vê o próprio material'
);
SELECT throws_ok(
  $test$ SELECT public.obter_rastreabilidade_material(
    'f6000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002'
  ) $test$,
  'RT002',
  'isolamento: empresa B não consegue abrir o detalhe de um material da empresa A (não encontrado)'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. PAGINAÇÃO / VOLUME
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT total_count FROM public.buscar_rastreabilidade_materiais(
    'Trace Paginacao Item', 5, 0, 'f2000000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  12::bigint,
  'paginação: total_count reflete todos os 12 materiais, não só a página'
);
SELECT is(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Trace Paginacao Item', 5, 0, 'f2000000-0000-4000-8000-000000000001'
  )),
  5::bigint,
  'paginação: primeira página devolve exatamente 5 linhas (limite pedido)'
);
SELECT is(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Trace Paginacao Item', 5, 10, 'f2000000-0000-4000-8000-000000000001'
  )),
  2::bigint,
  'paginação: última página (offset 10) devolve os 2 restantes'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (
      SELECT (item ->> 'id') AS id FROM public.buscar_rastreabilidade_materiais(
        'Trace Paginacao Item', 5, 0, 'f2000000-0000-4000-8000-000000000001'
      )
      INTERSECT
      SELECT (item ->> 'id') FROM public.buscar_rastreabilidade_materiais(
        'Trace Paginacao Item', 5, 5, 'f2000000-0000-4000-8000-000000000001'
      )
    ) AS overlap
  ),
  'paginação: páginas consecutivas não repetem material'
);
SELECT is(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Trace Paginacao Item', 200, 0, 'f2000000-0000-4000-8000-000000000001'
  )),
  12::bigint,
  'paginação: pedir limite 200 não quebra (trava internamente em 50, e só há 12 materiais para esse termo)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. RFID DESATIVADO PARA A EMPRESA (empresa B)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000090', 'f2000000-0000-4000-8000-000000000002'))
    -> 'permissoes' ->> 'rfid',
  'false',
  'empresa sem módulo RFID: bloco de permissões marca rfid=false'
);
SELECT is(
  (public.obter_rastreabilidade_material('f6000000-0000-4000-8000-000000000090', 'f2000000-0000-4000-8000-000000000002')) -> 'rfid_tags',
  NULL::jsonb,
  'empresa sem módulo RFID: rfid_tags não é retornado (nem vazio, ausente)'
);
SELECT is(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'AABBCCDD11223344', 20, 0, 'f2000000-0000-4000-8000-000000000002'
  )),
  0::bigint,
  'empresa sem módulo RFID: buscar por um EPC válido de outra empresa não encontra nada (nem erro, nem vazamento)'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 6. PERMISSÕES - usuário sem/com grant granular, master com/sem empresa
-- ----------------------------------------------------------------------------

-- Usuário "usuario" sem grant explícito de visualizar gestao_materiais.
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$ SELECT public.buscar_rastreabilidade_materiais(
    'Trace', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) $test$,
  '42501',
  'usuário sem permissão granular em gestao_materiais é bloqueado (mesmo com a empresa tendo o módulo ativo)'
);
RESET ROLE;

-- Usuário "usuario" COM grant explícito (concedido na seção 1).
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Trace Disponivel', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  )) = 1,
  'usuário com grant granular explícito consegue buscar normalmente'
);
RESET ROLE;

-- Master admin vinculado à empresa A: opera a própria empresa como admin.
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT count(*) FROM public.buscar_rastreabilidade_materiais(
    'Trace Disponivel', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  )) = 1,
  'master com empresa vinculada consulta a própria empresa normalmente'
);
SELECT throws_ok(
  $test$ SELECT public.buscar_rastreabilidade_materiais(
    'Trace', 20, 0, 'f2000000-0000-4000-8000-000000000002'
  ) $test$,
  '42501',
  'master com empresa vinculada NÃO consegue operar outra empresa por este RPC (isolamento pós-hardening, mesmo para master)'
);
RESET ROLE;

-- Master admin sem empresa vinculada.
SELECT set_config('request.jwt.claim.sub', 'f3000000-0000-4000-8000-000000000006', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$ SELECT public.buscar_rastreabilidade_materiais('Trace', 20, 0, NULL) $test$,
  'RT001',
  'master sem empresa vinculada e sem empresa selecionada é bloqueado explicitamente'
);
SELECT throws_ok(
  $test$ SELECT public.buscar_rastreabilidade_materiais(
    'Trace', 20, 0, 'f2000000-0000-4000-8000-000000000001'
  ) $test$,
  '42501',
  'master sem empresa vinculada não pode simplesmente apontar para a empresa A'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. GRANTS / ESTRUTURAL
-- ----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.buscar_rastreabilidade_materiais(text, integer, integer, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.obter_rastreabilidade_material(uuid, uuid)', 'EXECUTE'),
  'authenticated pode chamar as duas RPCs públicas de rastreabilidade'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.buscar_rastreabilidade_materiais(text, integer, integer, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.obter_rastreabilidade_material(uuid, uuid)', 'EXECUTE'),
  'anon não pode chamar nenhuma das duas RPCs'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resumo_situacao_material(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_material_traceability_company(uuid)', 'EXECUTE'),
  'helpers internos (resumo_situacao_material, resolve_material_traceability_company) não são chamáveis diretamente por authenticated'
);

SELECT * FROM finish();

ROLLBACK;
