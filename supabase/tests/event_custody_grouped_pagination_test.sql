-- ============================================================================
-- CONFERENCIA POR EVENTO - RESUMO AGRUPADO POR MATERIAL, PAGINADO NO SERVIDOR
-- ============================================================================
--
-- Cobre 20260911160000_event_custody_grouped_pagination.sql:
-- listar_custodias_evento_por_material (GROUP BY material_id com LIMIT/OFFSET
-- aplicado ao resultado ja agregado) e obter_totais_custodia_evento (somas do
-- evento inteiro, independentes de paginacao). Nao reexercita a validacao de
-- referencia_tipo/finalidade='evento' em registrar_checkout_material - ja
-- coberta por checkout_event_reference_test.sql - nem permissao granular de
-- checkin_checkout - ja coberta por
-- checkin_checkout_granular_write_permissions_test.sql. Fixture minima e
-- propria (prefixo 992), ator unico admin_empresa por empresa.

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
  '99100000-0000-4000-8000-000000000001', '__ecgp_plan__', 100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('99200000-0000-4000-8000-000000000001', '__ecgp_company_a__', 'ativo',
   '99100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days'),
  ('99200000-0000-4000-8000-000000000002', '__ecgp_company_b__', 'ativo',
   '99100000-0000-4000-8000-000000000001', false, false, 'pago', now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '99300000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'ecgp-admin-a@example.test', '', now(),
   '{}', '{"full_name":"ECGP Admin A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99300000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'ecgp-admin-b@example.test', '', now(),
   '{}', '{"full_name":"ECGP Admin B"}', now(), now());

UPDATE public.user_roles SET role = 'admin_empresa'
WHERE user_id IN ('99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000002');

UPDATE public.profiles SET empresa_id = '99200000-0000-4000-8000-000000000001', ativado = true, activated_at = now()
WHERE user_id = '99300000-0000-4000-8000-000000000001';
UPDATE public.profiles SET empresa_id = '99200000-0000-4000-8000-000000000002', ativado = true, activated_at = now()
WHERE user_id = '99300000-0000-4000-8000-000000000002';

-- Dependencias primeiro (trigger de enforce_module_dependencies_all_flows.sql
-- valida que checkin_checkout so ativa se gestao_materiais/controle_estoque
-- ja estiverem ativos na mesma transacao). UPDATE, nao INSERT: o trigger
-- AFTER INSERT ON empresas (provision_company_module_entitlements,
-- 20260804190000) ja seeda toda empresa nova com uma linha 'inactive' por
-- modulo do catalogo - inserir de novo colide com
-- prevent_duplicate_company_module (mesmo ajuste ja documentado em
-- materials_granular_write_permissions_test.sql/
-- clear_material_barcode_test.sql; checkout_event_reference_test.sql ainda
-- usa INSERT aqui e por isso nao roda mais neste replay - bit-rot
-- pre-existente, fora do escopo desta ETAPA).
UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '99200000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key IN ('gestao_materiais', 'controle_estoque'));
UPDATE public.empresa_modules
SET status = 'active', activated_at = now(), granted_by_admin = true, origem = 'manual_admin'
WHERE empresa_id = '99200000-0000-4000-8000-000000000001'
  AND module_id IN (SELECT id FROM public.module_catalog WHERE feature_key = 'checkin_checkout');

INSERT INTO public.categorias_materiais (id, empresa_id, nome)
VALUES ('99400000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '__ecgp_category__');

-- Ordem alfabetica deliberada (Alfa/Beta/Gama) para asserções de ordenação
-- previsíveis (listar_custodias_evento_por_material ordena por material_nome).
INSERT INTO public.materiais (id, empresa_id, categoria_id, codigo_interno, nome, tipo_controle, status_operacional, ativo)
VALUES
  ('99500000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', 'ECGP-M1', 'Item Alfa', 'quantidade', 'disponivel', true),
  ('99500000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', 'ECGP-M2', 'Item Beta', 'quantidade', 'disponivel', true),
  ('99500000-0000-4000-8000-000000000003', '99200000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', 'ECGP-M3', 'Item Gama', 'quantidade', 'disponivel', true);

INSERT INTO public.estoque_localizacoes (id, empresa_id, codigo, nome, ativa)
VALUES
  ('99600000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', 'ECGP-ORIG1', 'Origem 1', true),
  ('99600000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000001', 'ECGP-ORIG2', 'Origem 2', true);

INSERT INTO public.estoque_saldos (empresa_id, material_id, localizacao_id, quantidade)
VALUES
  ('99200000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001', 20),
  ('99200000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000002', '99600000-0000-4000-8000-000000000001', 20),
  ('99200000-0000-4000-8000-000000000001', '99500000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000002', 20);

INSERT INTO public.funcionarios (id, empresa_id, nome, funcao)
VALUES ('99700000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '__ecgp_responsible__', 'Tecnico');

-- Evento A (alvo dos testes) e Evento B (mesma empresa - prova que o filtro
-- de evento isola por referencia_id, nao so por empresa).
INSERT INTO public.events (id, empresa_id, name, artist, city, venue, date)
VALUES
  ('99800000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', '__ecgp_event_a__', 'Artista A', 'Cidade A', 'Local A', current_date),
  ('99800000-0000-4000-8000-000000000002', '99200000-0000-4000-8000-000000000001', '__ecgp_event_b__', 'Artista B', 'Cidade B', 'Local B', current_date);

SELECT set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;

-- Item Alfa (M1): DUAS custodias abertas para o Evento A, nunca devolvidas -
-- retirada_em explicito para ordenacao deterministica (mais antiga primeiro
-- em custodias_abertas). Total: retirada=5, devolvida=0, pendente=5.
SELECT public.registrar_checkout_material(
  '99500000-0000-4000-8000-000000000001', 2, '99600000-0000-4000-8000-000000000001',
  'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
  gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
  '2026-09-01T10:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
);
SELECT public.registrar_checkout_material(
  '99500000-0000-4000-8000-000000000001', 3, '99600000-0000-4000-8000-000000000001',
  'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
  gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
  '2026-09-01T14:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
);

-- Item Beta (M2): DOIS checkouts para o Evento A - o primeiro totalmente
-- devolvido, o segundo parcial. custodias_abertas so deve carregar o
-- segundo. Total: retirada=2+3=5, devolvida=2+1=3, pendente=0+2=2.
SELECT public.registrar_checkin_material(
  (public.registrar_checkout_material(
    '99500000-0000-4000-8000-000000000002', 2, '99600000-0000-4000-8000-000000000001',
    'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
    '2026-09-01T09:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
  )).id,
  2, '99600000-0000-4000-8000-000000000001', 'bom', gen_random_uuid(), NULL, NULL,
  '2026-09-02T09:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
);
SELECT public.registrar_checkin_material(
  (public.registrar_checkout_material(
    '99500000-0000-4000-8000-000000000002', 3, '99600000-0000-4000-8000-000000000001',
    'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
    '2026-09-01T11:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
  )).id,
  1, '99600000-0000-4000-8000-000000000001', 'bom', gen_random_uuid(), NULL, NULL,
  '2026-09-02T09:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
);

-- Item Gama (M3): um checkout da Origem 2, totalmente devolvido - prova o
-- filtro _localizacao_id e o bucket "totalmente devolvidos". Total:
-- retirada=2, devolvida=2, pendente=0.
SELECT public.registrar_checkin_material(
  (public.registrar_checkout_material(
    '99500000-0000-4000-8000-000000000003', 2, '99600000-0000-4000-8000-000000000002',
    'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
    '2026-09-01T12:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
  )).id,
  2, '99600000-0000-4000-8000-000000000002', 'bom', gen_random_uuid(), NULL, NULL,
  '2026-09-02T09:00:00Z'::timestamptz, '99200000-0000-4000-8000-000000000001'
);

-- Ruido a ignorar: um checkout CANCELADO do Item Alfa para o Evento A (nao
-- pode contaminar nenhuma soma nem aparecer em nenhuma lista) e um checkout
-- do Item Alfa para o Evento B (nao pode vazar para as consultas do Evento A).
SELECT public.cancelar_checkout_material(
  (public.registrar_checkout_material(
    '99500000-0000-4000-8000-000000000001', 9, '99600000-0000-4000-8000-000000000001',
    'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
    gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000001',
    NULL, '99200000-0000-4000-8000-000000000001'
  )).id,
  'Erro de lancamento - fixture de teste', gen_random_uuid(), NULL, '99200000-0000-4000-8000-000000000001'
);
SELECT public.registrar_checkout_material(
  '99500000-0000-4000-8000-000000000001', 7, '99600000-0000-4000-8000-000000000001',
  'funcionario', '99700000-0000-4000-8000-000000000001', 'evento', 'bom',
  gen_random_uuid(), NULL, NULL, 'evento', '99800000-0000-4000-8000-000000000002',
  NULL, '99200000-0000-4000-8000-000000000001'
);

-- ----------------------------------------------------------------------------
-- 1. EVENTO OBRIGATORIO
-- ----------------------------------------------------------------------------

SELECT throws_ok(
  $test$SELECT * FROM public.listar_custodias_evento_por_material(
    _evento_id => NULL, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )$test$,
  'CI004', NULL,
  'listar_custodias_evento_por_material exige _evento_id'
);
SELECT throws_ok(
  $test$SELECT public.obter_totais_custodia_evento(
    _evento_id => NULL, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )$test$,
  'CI004', NULL,
  'obter_totais_custodia_evento exige _evento_id'
);

-- ----------------------------------------------------------------------------
-- 2. TOTAIS DO EVENTO (independentes de paginacao)
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT (public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) ->> 'total_retirado')::bigint),
  12::bigint,
  'total retirado soma as 4 custodias validas do evento A (2+3+2+3+2), ignora a cancelada e a do evento B'
);
SELECT is(
  (SELECT (public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) ->> 'total_devolvido')::bigint),
  5::bigint,
  'total devolvido soma 2 (M2) + 1 (M2) + 2 (M3) = 5'
);
SELECT is(
  (SELECT (public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) ->> 'total_pendente')::bigint),
  7::bigint,
  'total pendente soma 5 (M1) + 2 (M2) + 0 (M3) = 7'
);

SELECT is(
  (SELECT (public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _busca => 'Item Alfa',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) ->> 'total_retirado')::bigint),
  5::bigint,
  '_busca filtra os totais para um so material (Item Alfa: retirada=5)'
);
SELECT is(
  (SELECT (public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _localizacao_id => '99600000-0000-4000-8000-000000000002',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) ->> 'total_retirado')::bigint),
  2::bigint,
  '_localizacao_id filtra os totais para quem saiu daquela origem (so Item Gama, Origem 2)'
);

-- ----------------------------------------------------------------------------
-- 3. LISTAGEM AGRUPADA - split pendente/devolvido e total_count
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  2::bigint,
  '_pendente=true traz os 2 materiais com saldo pendente (Item Alfa e Item Beta)'
);
SELECT is(
  (SELECT total_count FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  2::bigint,
  'total_count de _pendente=true e 2, mesmo com tamanho_pagina maior'
);
SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => false,
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  '_pendente=false traz o unico material totalmente devolvido (Item Gama)'
);
SELECT is(
  (SELECT item ->> 'material_nome' FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => false,
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  'Item Gama',
  'o material totalmente devolvido e o Item Gama'
);
SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  3::bigint,
  '_pendente omitido (NULL) traz todos os 3 materiais do evento'
);

-- ----------------------------------------------------------------------------
-- 4. PAGINACAO REAL sobre o resultado JA AGRUPADO (nao sobre linhas cruas)
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
    _pagina => 1, _tamanho_pagina => 1, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'pagina 1 de tamanho 1 traz exatamente 1 material'
);
SELECT is(
  (SELECT total_count FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
    _pagina => 1, _tamanho_pagina => 1, _empresa_id => '99200000-0000-4000-8000-000000000001'
  ) LIMIT 1),
  2::bigint,
  'total_count continua 2 mesmo com a pagina cortada em 1 material - paginacao real, nao um limite disfarcado de total'
);
SELECT is(
  (
    SELECT array_agg(item ->> 'material_nome')
    FROM (
      SELECT item FROM public.listar_custodias_evento_por_material(
        _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
        _pagina => 1, _tamanho_pagina => 1, _empresa_id => '99200000-0000-4000-8000-000000000001'
      )
      UNION ALL
      SELECT item FROM public.listar_custodias_evento_por_material(
        _evento_id => '99800000-0000-4000-8000-000000000001', _pendente => true,
        _pagina => 2, _tamanho_pagina => 1, _empresa_id => '99200000-0000-4000-8000-000000000001'
      )
    ) AS combined
  ),
  ARRAY['Item Alfa', 'Item Beta'],
  'as paginas 1+2 (tamanho 1) cobrem os 2 materiais pendentes sem repetir nem pular nenhum'
);

-- ----------------------------------------------------------------------------
-- 5. CUSTODIAS_ABERTAS - so as linhas com saldo pendente, mais antiga primeiro
-- ----------------------------------------------------------------------------

SELECT is(
  (
    SELECT jsonb_array_length(item -> 'custodias_abertas')
    FROM public.listar_custodias_evento_por_material(
      _evento_id => '99800000-0000-4000-8000-000000000001', _busca => 'Item Alfa',
      _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
    )
  ),
  2,
  'Item Alfa tem 2 custodias abertas (as 2 retiradas nunca devolvidas) - a cancelada nao entra'
);
SELECT is(
  (
    SELECT jsonb_path_query_array(item -> 'custodias_abertas', '$[*].quantidade_retirada')
    FROM public.listar_custodias_evento_por_material(
      _evento_id => '99800000-0000-4000-8000-000000000001', _busca => 'Item Alfa',
      _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
    )
  ),
  '[2, 3]'::jsonb,
  'custodias_abertas do Item Alfa vem ordenada da mais antiga (retirada 2, 10h) para a mais nova (retirada 3, 14h)'
);
SELECT is(
  (
    SELECT jsonb_array_length(item -> 'custodias_abertas')
    FROM public.listar_custodias_evento_por_material(
      _evento_id => '99800000-0000-4000-8000-000000000001', _busca => 'Item Beta',
      _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'Item Beta tem so 1 custodia aberta (a parcial) - a totalmente devolvida nao entra mesmo estando pendente=0 nela'
);
SELECT is(
  (
    SELECT jsonb_array_length(item -> 'custodias_abertas')
    FROM public.listar_custodias_evento_por_material(
      _evento_id => '99800000-0000-4000-8000-000000000001', _busca => 'Item Gama',
      _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'Item Gama (totalmente devolvido) nao tem nenhuma custodia aberta'
);

-- ----------------------------------------------------------------------------
-- 6. FILTROS OPERACIONAIS - busca e localizacao
-- ----------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _busca => 'ECGP-M3',
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  '_busca casa pelo codigo interno do material tambem'
);
SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _localizacao_id => '99600000-0000-4000-8000-000000000002',
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  '_localizacao_id filtra so quem retirou daquela origem (Item Gama, Origem 2)'
);
SELECT is(
  (SELECT count(*) FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001', _busca => '__nao_existe__',
    _pagina => 1, _tamanho_pagina => 10, _empresa_id => '99200000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  '_busca sem correspondencia retorna lista vazia, nao erro'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. CROSS-TENANT: admin de outra empresa nao le o evento da empresa A
-- ----------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $test$SELECT * FROM public.listar_custodias_evento_por_material(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'admin_empresa de outra empresa nao consegue forcar _empresa_id da empresa A'
);
SELECT throws_ok(
  $test$SELECT public.obter_totais_custodia_evento(
    _evento_id => '99800000-0000-4000-8000-000000000001',
    _empresa_id => '99200000-0000-4000-8000-000000000001'
  )$test$,
  '42501', NULL,
  'obter_totais_custodia_evento tambem rejeita _empresa_id de outra empresa'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
