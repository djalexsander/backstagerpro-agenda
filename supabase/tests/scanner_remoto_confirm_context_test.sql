-- ============================================================================
-- SCANNER REMOTO - E5: CONFIRMAÇÃO FINAL EXECUTA A MOVIMENTAÇÃO
-- ============================================================================
--
-- Cobre 20260902110000_scanner_remoto_confirm_context.sql:
-- registrar_leitura_scanner_remoto ganha _contexto jsonb. Sem _contexto o
-- corpo é o de 20260824090000 (a sessão decide). Com _contexto (confirmação
-- da sessão automática neutra) o contexto por leitura decide e delega:
--   - check-in normal            -> registrar_checkin_material
--   - check-in de locacao_item   -> registrar_devolucao_locacao_material
--   - check-out normal / evento  -> registrar_checkout_material
--   - check-out finalidade cliente -> registrar_retirada_locacao_material
--
-- Não reexercita as regras de negócio das RPCs delegadas (já cobertas por
-- material_checkin_checkout_stage_three_test.sql / material_rentals_stage_
-- four_test.sql / checkout_event_reference_test.sql) - só o roteamento, a
-- compatibilidade do caminho sem _contexto, a idempotência e a barreira de
-- permissão de Locação (usuário comum -> leitura 'erro', não exceção).
--
-- Fixtures rodam como dono do banco (bypassa RLS). As asserções trocam de
-- papel via set_config('request.jwt.claim.sub', ...) + SET LOCAL ROLE
-- authenticated. Prefixo 8b. Dois atores: um admin_empresa (acesso a
-- Locação) e um 'usuario' com grant granular checkin_checkout create+edit
-- (SEM admin, SEM Locação) para a seção de permissão.

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
  '8b100000-0000-4000-8000-000000000001', '__src5_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES (
  '8b200000-0000-4000-8000-000000000001', '__src5_company__', 'ativo',
  '8b100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '8b300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'src5-admin@example.test', '', now(),
   '{}', '{"full_name":"SRC5 Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8b300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'src5-user@example.test', '', now(),
   '{}', '{"full_name":"SRC5 User"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id = '8b300000-0000-4000-8000-000000000001';
UPDATE public.user_roles SET role = 'usuario'
WHERE user_id = '8b300000-0000-4000-8000-000000000002';

UPDATE public.profiles
SET empresa_id = '8b200000-0000-4000-8000-000000000001',
    ativado = true, activated_at = now()
WHERE user_id IN (
  '8b300000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000002'
);

-- Dependências em ordem canônica; locacao_materiais por último.
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '8b200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key IN ('gestao_materiais', 'controle_estoque');
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '8b200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'checkin_checkout';
INSERT INTO public.empresa_modules (empresa_id, module_id, status, activated_at, granted_by_admin, origem)
SELECT '8b200000-0000-4000-8000-000000000001', catalog.id, 'active', now(), true, 'manual_admin'
FROM public.module_catalog AS catalog
WHERE catalog.feature_key = 'locacao_materiais';

-- Usuário comum: grant granular checkin_checkout create+edit (consegue
-- check-out/check-in normal pelo Scanner Remoto), mas NADA de Locação.
INSERT INTO public.user_module_permissions (empresa_id, user_id, feature_key, can_view, can_create, can_edit, can_delete)
VALUES ('8b200000-0000-4000-8000-000000000001', '8b300000-0000-4000-8000-000000000002',
        'checkin_checkout', true, true, true, false);

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('8b400000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001', '__src5_cat__');

INSERT INTO public.materiais (
  id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo
) VALUES
  ('8b500000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
   '8b400000-0000-4000-8000-000000000001', 'SRC5-QTY', 'Material Quantidade', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('8b600000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001', 'SRC5-O', 'Origem', true),
  ('8b600000-0000-4000-8000-000000000002', '8b200000-0000-4000-8000-000000000001', 'SRC5-D', 'Destino', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES ('8b200000-0000-4000-8000-000000000001', '8b500000-0000-4000-8000-000000000001',
        '8b600000-0000-4000-8000-000000000001', 50);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('8b700000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001', '__src5_resp__', 'Tecnico');

INSERT INTO public.events (id, empresa_id, name, artist, city, venue, date)
VALUES ('8bb00000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
        '__src5_event__', 'Artista', 'Cidade', 'Local', current_date);

INSERT INTO public.clientes (id, empresa_id, tipo_pessoa, nome, ativo, created_by, updated_by)
VALUES ('8b800000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
        'pessoa_juridica', '__src5_cliente__', true,
        '8b300000-0000-4000-8000-000000000001', '8b300000-0000-4000-8000-000000000001');

INSERT INTO public.material_locacoes (
  id, empresa_id, cliente_id, numero, status, retirada_prevista_em, devolucao_prevista_em,
  responsavel_tipo, responsavel_funcionario_id, responsavel_nome,
  client_uuid, payload_hash, created_by, updated_by
) VALUES (
  '8b900000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
  '8b800000-0000-4000-8000-000000000001', '__SRC5-LOC-0001__', 'reservada',
  now(), now() + interval '3 days',
  'funcionario', '8b700000-0000-4000-8000-000000000001', '__src5_resp__',
  gen_random_uuid(), 'src5-loc-hash', '8b300000-0000-4000-8000-000000000001', '8b300000-0000-4000-8000-000000000001'
);

INSERT INTO public.material_locacao_itens (
  id, empresa_id, locacao_id, material_id, quantidade_contratada
) VALUES (
  '8ba00000-0000-4000-8000-000000000001', '8b200000-0000-4000-8000-000000000001',
  '8b900000-0000-4000-8000-000000000001', '8b500000-0000-4000-8000-000000000001', 10
);

-- ----------------------------------------------------------------------------
-- 1. CAMINHO SEM _contexto - byte a byte o fluxo antigo (sessão decide)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8b300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- Sessão configurada 'misto' (origem + responsável + finalidade + destino).
SELECT public.iniciar_sessao_scanner_remoto(
  'misto', 'bom', '8bc00000-0000-4000-8000-000000000001',
  'funcionario', '8b700000-0000-4000-8000-000000000001', 'uso_interno',
  '8b600000-0000-4000-8000-000000000001', '8b600000-0000-4000-8000-000000000002',
  NULL, NULL, NULL, 'Config', '8b200000-0000-4000-8000-000000000001'
);

-- 1ª leitura, sem contexto: sem custódia aberta -> checkout (a sessão decide).
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000001'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001'
  )),
  'checkout',
  'sem _contexto: sessão misto sem custódia aberta -> check-out (fluxo antigo)'
);

-- 2ª leitura, sem contexto: agora existe custódia aberta -> checkin.
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000001'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000002',
    '8b200000-0000-4000-8000-000000000001'
  )),
  'checkin',
  'sem _contexto: sessão misto com custódia aberta -> check-in (fluxo antigo)'
);

-- ----------------------------------------------------------------------------
-- 2. _contexto CHECK-OUT normal (uso_interno) numa sessão automática neutra
-- ----------------------------------------------------------------------------
SELECT public.iniciar_sessao_scanner_remoto(
  'misto', 'bom', '8bc00000-0000-4000-8000-000000000002',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '8b200000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000003',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'uso_interno',
      'condicao', 'bom'
    )
  )),
  'checkout',
  '_contexto check-out normal -> acao checkout'
);
SELECT is(
  (SELECT finalidade::text FROM public.material_custodias
   WHERE material_id = '8b500000-0000-4000-8000-000000000001'
     AND localizacao_origem_id = '8b600000-0000-4000-8000-000000000001'
     AND finalidade = 'uso_interno'
   ORDER BY retirada_em DESC LIMIT 1),
  'uso_interno',
  '_contexto check-out normal gravou a custódia com a finalidade do contexto'
);

-- ----------------------------------------------------------------------------
-- 3. _contexto CHECK-OUT evento -> custódia carrega referencia_tipo='evento'
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000004',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'evento',
      'condicao', 'bom',
      'referencia_tipo', 'evento',
      'referencia_id', '8bb00000-0000-4000-8000-000000000001'
    )
  )),
  'checkout',
  '_contexto check-out evento -> acao checkout'
);
SELECT is(
  (SELECT referencia_tipo FROM public.material_custodias
   WHERE material_id = '8b500000-0000-4000-8000-000000000001' AND finalidade = 'evento'
   ORDER BY retirada_em DESC LIMIT 1),
  'evento',
  '_contexto check-out evento gravou referencia_tipo=evento'
);

-- ----------------------------------------------------------------------------
-- 4. _contexto CHECK-IN normal fecha a custódia uso_interno da seção 2
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000005',
    '8b200000-0000-4000-8000-000000000001', 1,
    (SELECT id FROM public.material_custodias
     WHERE material_id = '8b500000-0000-4000-8000-000000000001' AND finalidade = 'uso_interno'
     ORDER BY retirada_em DESC LIMIT 1),
    jsonb_build_object(
      'operation', 'checkin',
      'localizacao_destino_id', '8b600000-0000-4000-8000-000000000002',
      'condicao', 'bom'
    )
  )),
  'checkin',
  '_contexto check-in normal -> acao checkin'
);

-- ----------------------------------------------------------------------------
-- 5. _contexto CHECK-OUT cliente -> registrar_retirada_locacao_material (admin)
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000006',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'cliente',
      'condicao', 'bom',
      'locacao_id', '8b900000-0000-4000-8000-000000000001',
      'locacao_item_id', '8ba00000-0000-4000-8000-000000000001'
    )
  )),
  'checkout',
  '_contexto check-out cliente -> acao checkout'
);
SELECT is(
  (SELECT finalidade::text FROM public.material_custodias
   WHERE referencia_tipo = 'locacao_item'
     AND referencia_id = '8ba00000-0000-4000-8000-000000000001'
   ORDER BY retirada_em DESC LIMIT 1),
  'locacao',
  'check-out cliente cria custódia finalidade=locacao (nunca "cliente" genérico)'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.material_locacao_eventos
    WHERE locacao_id = '8b900000-0000-4000-8000-000000000001' AND tipo = 'retirada'
  ),
  'check-out cliente grava o evento "retirada" na locação'
);
SELECT is(
  (SELECT status::text FROM public.material_locacoes WHERE id = '8b900000-0000-4000-8000-000000000001'),
  'em_andamento',
  'check-out cliente move a locação para em_andamento'
);

-- ----------------------------------------------------------------------------
-- 6. _contexto CHECK-IN da custódia locacao_item -> devolução oficial (admin)
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000007',
    '8b200000-0000-4000-8000-000000000001', 1,
    (SELECT id FROM public.material_custodias
     WHERE referencia_tipo = 'locacao_item'
       AND referencia_id = '8ba00000-0000-4000-8000-000000000001'
       AND status IN ('aberta', 'parcial')
     ORDER BY retirada_em DESC LIMIT 1),
    jsonb_build_object(
      'operation', 'checkin',
      'localizacao_destino_id', '8b600000-0000-4000-8000-000000000002',
      'condicao', 'bom'
    )
  )),
  'checkin',
  '_contexto check-in de custódia locacao_item -> acao checkin'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.material_locacao_eventos
    WHERE locacao_id = '8b900000-0000-4000-8000-000000000001' AND tipo = 'devolucao'
  ),
  'check-in de custódia de locação grava o evento "devolucao" (foi por registrar_devolucao_locacao_material)'
);

-- ----------------------------------------------------------------------------
-- 7. PERMISSÃO DE LOCAÇÃO: usuário comum + _contexto cliente -> leitura 'erro'
--    (não exceção); nenhuma custódia nova é criada
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8b300000-0000-4000-8000-000000000002', true);

SELECT public.iniciar_sessao_scanner_remoto(
  'misto', 'bom', '8bc00000-0000-4000-8000-000000000003',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '8b200000-0000-4000-8000-000000000001'
);

SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000003'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000008',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'cliente',
      'condicao', 'bom',
      'locacao_id', '8b900000-0000-4000-8000-000000000001',
      'locacao_item_id', '8ba00000-0000-4000-8000-000000000001'
    )
  )),
  'erro',
  'usuário comum sem admin_empresa: rota Cliente->Locação vira leitura acao=erro, não exceção'
);
SELECT like(
  (SELECT resultado->>'mensagem' FROM public.scanner_remoto_leituras
   WHERE client_uuid = '8bd00000-0000-4000-8000-000000000008'),
  '%permiss%',
  'a leitura de erro carrega a mensagem de permissão da RPC de locação'
);

-- Check-out/check-in NORMAL continua funcionando para o usuário comum
-- (grant granular checkin_checkout) - só a rota de Locação é barrada.
SELECT is(
  (SELECT acao_executada::text FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000003'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000009',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'uso_interno',
      'condicao', 'bom'
    )
  )),
  'checkout',
  'usuário comum (grant granular) faz check-out normal pelo contexto normalmente'
);

-- ----------------------------------------------------------------------------
-- 8. IDEMPOTÊNCIA do _contexto
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '8b300000-0000-4000-8000-000000000001', true);

-- mesmo client_uuid + mesmo _contexto -> devolve a MESMA linha (id igual)
SELECT is(
  (SELECT id FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000006',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object(
      'operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'cliente', 'condicao', 'bom',
      'locacao_id', '8b900000-0000-4000-8000-000000000001',
      'locacao_item_id', '8ba00000-0000-4000-8000-000000000001'
    )
  )),
  (SELECT id FROM public.scanner_remoto_leituras
   WHERE client_uuid = '8bd00000-0000-4000-8000-000000000006'),
  'retry com mesmo client_uuid + mesmo _contexto devolve a mesma leitura (idempotente)'
);

-- mesmo client_uuid + _contexto diferente -> CI013
SELECT throws_ok(
  $test$SELECT public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000002'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000006',
    '8b200000-0000-4000-8000-000000000001', 1, NULL,
    jsonb_build_object('operation', 'checkout',
      'localizacao_origem_id', '8b600000-0000-4000-8000-000000000001',
      'responsavel_tipo', 'funcionario',
      'responsavel_id', '8b700000-0000-4000-8000-000000000001',
      'finalidade', 'uso_interno', 'condicao', 'bom')
  )$test$,
  'CI013', NULL,
  'client_uuid reaproveitado com _contexto diferente -> CI013'
);

-- leitura sem _contexto tem o mesmo hash de sempre: retry sem contexto é
-- idempotente contra a linha gravada na seção 1
SELECT is(
  (SELECT id FROM public.registrar_leitura_scanner_remoto(
    (SELECT id FROM public.scanner_remoto_sessoes WHERE client_uuid = '8bc00000-0000-4000-8000-000000000001'),
    'SRC5-QTY', '8bd00000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001'
  )),
  (SELECT id FROM public.scanner_remoto_leituras
   WHERE client_uuid = '8bd00000-0000-4000-8000-000000000001'),
  'retry sem _contexto continua idempotente (hash legado inalterado)'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
