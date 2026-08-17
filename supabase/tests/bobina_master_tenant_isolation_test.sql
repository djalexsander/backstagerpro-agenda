-- Regression test for P0-2: the bobina/profile migration must not restore
-- master_admin's former ability to trust an arbitrary caller-supplied tenant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(17);

INSERT INTO public.planos (
  id, nome, valor, max_usuarios, max_eventos, ativo, periodicidade, categoria
) VALUES (
  'd1000000-0000-4000-8000-000000000001', '__bobina_p0_2_plan__',
  100, 20, 100, true, 'mensal', 'plano_base'
);

INSERT INTO public.empresas (
  id, nome_empresa, status, plano_id, plano_bloqueado,
  precisa_escolher_plano, status_pagamento, vencimento
) VALUES
  ('d2000000-0000-4000-8000-000000000001', '__bobina_p0_2_company_a__',
   'ativo', 'd1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days'),
  ('d2000000-0000-4000-8000-000000000002', '__bobina_p0_2_company_b__',
   'ativo', 'd1000000-0000-4000-8000-000000000001', false, false, 'pago',
   now() + interval '30 days');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd3000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'bobina-p0-2-master-a@example.test', '',
  now(), '{}', '{"full_name":"Bobina P0-2 Master A"}', now(), now()
);

UPDATE public.user_roles
SET role = 'master_admin'
WHERE user_id = 'd3000000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET empresa_id = 'd2000000-0000-4000-8000-000000000001'
WHERE user_id = 'd3000000-0000-4000-8000-000000000001';

INSERT INTO public.empresa_bobina_perfis (
  id, empresa_id, nome, largura_etiqueta_mm, altura_etiqueta_mm,
  colunas, padrao, ativo
) VALUES
  ('d4000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'Perfil A', 50, 30, 1, true, true),
  ('d4000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000002', 'Perfil B', 60, 40, 1, true, true);

SELECT set_config(
  'request.jwt.claim.sub',
  'd3000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.listar_perfis_bobina()),
  1::bigint,
  'linked master lists only profiles from its own company'
);

SELECT is(
  (SELECT count(*) FROM public.listar_perfis_bobina(
    'd2000000-0000-4000-8000-000000000001'
  )),
  1::bigint,
  'linked master may explicitly name its own company'
);

SELECT throws_ok(
  $test$SELECT * FROM public.listar_perfis_bobina(
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot list another company bobina profiles'
);

SELECT throws_ok(
  $test$SELECT public.salvar_perfil_bobina(
    'Cross tenant', 50, 30, 1, 0, 0, 0, 0, 0, 0, 'retrato', NULL,
    0, 0, 'automatico', NULL, false, NULL, NULL,
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot save a profile in another company'
);

SELECT throws_ok(
  $test$SELECT public.duplicar_perfil_bobina(
    'd4000000-0000-4000-8000-000000000002', NULL,
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot duplicate another company profile'
);

SELECT throws_ok(
  $test$SELECT public.excluir_perfil_bobina(
    'd4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot delete another company profile'
);

SELECT throws_ok(
  $test$SELECT public.definir_perfil_bobina_padrao(
    'd4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot set another company default profile'
);

SELECT throws_ok(
  $test$SELECT public.salvar_configuracao_impressora(
    'etiqueta', 'Cross tenant printer', NULL, NULL, NULL, 'retrato', true,
    '{}'::jsonb, 'd4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002'
  )$test$,
  '42501', 'Empresa inválida.',
  'linked master cannot save another company printer configuration'
);

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.empresa_bobina_perfis
   WHERE empresa_id = 'd2000000-0000-4000-8000-000000000002'
     AND nome = 'Perfil B' AND ativo AND padrao),
  1::bigint,
  'failed cross-tenant profile calls leave company B unchanged'
);

SELECT is(
  (SELECT count(*) FROM public.empresa_impressora_config
   WHERE empresa_id = 'd2000000-0000-4000-8000-000000000002'),
  0::bigint,
  'failed cross-tenant printer call creates no company B configuration'
);

SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $test$SELECT public.salvar_perfil_bobina('Perfil A novo', 40, 20)$test$,
  'linked master retains legitimate profile creation in its own company'
);

SELECT lives_ok(
  $test$SELECT public.duplicar_perfil_bobina(
    'd4000000-0000-4000-8000-000000000001', 'Perfil A cópia'
  )$test$,
  'linked master retains legitimate profile duplication in its own company'
);

SELECT lives_ok(
  $test$SELECT public.definir_perfil_bobina_padrao(
    (SELECT id FROM public.empresa_bobina_perfis WHERE nome = 'Perfil A novo')
  )$test$,
  'linked master retains legitimate default selection in its own company'
);

SELECT lives_ok(
  $test$SELECT public.salvar_configuracao_impressora(
    'etiqueta', 'Printer A', NULL, NULL, NULL, 'retrato', true, '{}'::jsonb,
    (SELECT id FROM public.empresa_bobina_perfis WHERE nome = 'Perfil A novo')
  )$test$,
  'linked master retains legitimate printer configuration in its own company'
);

SELECT lives_ok(
  $test$SELECT public.excluir_perfil_bobina(
    (SELECT id FROM public.empresa_bobina_perfis WHERE nome = 'Perfil A cópia')
  )$test$,
  'linked master retains legitimate profile deletion in its own company'
);

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.empresa_bobina_perfis
   WHERE empresa_id = 'd2000000-0000-4000-8000-000000000001' AND ativo),
  2::bigint,
  'legitimate own-company bobina changes were persisted'
);

SELECT is(
  (SELECT count(*) FROM public.empresa_impressora_config
   WHERE empresa_id = 'd2000000-0000-4000-8000-000000000001'
     AND perfil_bobina_padrao_id = (
       SELECT id FROM public.empresa_bobina_perfis WHERE nome = 'Perfil A novo'
     )),
  1::bigint,
  'legitimate own-company printer link was persisted'
);

SELECT * FROM finish();
ROLLBACK;
