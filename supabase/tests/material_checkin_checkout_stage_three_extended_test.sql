BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

CREATE OR REPLACE FUNCTION public.stage35_force_custody_failure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.client_uuid IN (
    '79300000-0000-4000-8000-000000000002'::uuid,
    '79300000-0000-4000-8000-000000000003'::uuid,
    '79300000-0000-4000-8000-000000000004'::uuid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'stage35 forced failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stage35_force_custody_insert_failure
BEFORE INSERT ON public.material_custodias
FOR EACH ROW EXECUTE FUNCTION public.stage35_force_custody_failure();

CREATE TRIGGER stage35_force_custody_event_failure
BEFORE INSERT ON public.material_custodia_eventos
FOR EACH ROW EXECUTE FUNCTION public.stage35_force_custody_failure();

CREATE TEMP TABLE stage35_cross_company_custody AS
SELECT id
FROM public.material_custodias
WHERE client_uuid = '78000000-0000-4000-8000-000000000014';
GRANT SELECT ON stage35_cross_company_custody TO authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '73000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- Atomicity A: stock movement rejects the checkout before custody persists.
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000006', 2,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79300000-0000-4000-8000-000000000001', NULL, 'atomicidade A',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'ST001',
  'Saldo insuficiente na localização de origem.',
  'atomicity A forces stock movement failure'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodias
   WHERE client_uuid = '79300000-0000-4000-8000-000000000001'),
  0::bigint,
  'atomicity A leaves no custody'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000006'),
  1,
  'atomicity A preserves stock'
);
SELECT is(
  (SELECT count(*) FROM public.estoque_movimentacoes
   WHERE client_uuid = '79300000-0000-4000-8000-000000000001'),
  0::bigint,
  'atomicity A leaves no movement'
);

-- Atomicity B: movement succeeds internally, then custody INSERT is forced to
-- fail. The RPC statement must roll the movement and balance back together.
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000007', 4,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79300000-0000-4000-8000-000000000002', NULL, 'atomicidade B',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'P0001',
  'stage35 forced failure',
  'atomicity B forces custody creation failure'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000007'),
  10,
  'atomicity B rolls stock back'
);
SELECT is(
  (SELECT count(*) FROM public.estoque_movimentacoes
   WHERE client_uuid = '79300000-0000-4000-8000-000000000002'),
  0::bigint,
  'atomicity B rolls ledger back'
);
SELECT is(
  (SELECT count(*) FROM public.material_custodias
   WHERE client_uuid = '79300000-0000-4000-8000-000000000002'),
  0::bigint,
  'atomicity B leaves no custody'
);

-- Prepare C and D with successful checkouts.
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000008', 10,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79310000-0000-4000-8000-000000000003', NULL, 'setup C',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'atomicity C checkout setup succeeds'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000009', 10,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79310000-0000-4000-8000-000000000004', NULL, 'setup D',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'atomicity D checkout setup succeeds'
);

-- Atomicity C: stock credit and custody projection occur before event INSERT.
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79310000-0000-4000-8000-000000000003'),
    4, '76000000-0000-4000-8000-000000000001', 'bom',
    '79300000-0000-4000-8000-000000000003', NULL,
    'atomicidade C', NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'P0001',
  'stage35 forced failure',
  'atomicity C forces checkin event failure'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000008'),
  0,
  'atomicity C rolls stock credit back'
);
SELECT is(
  (SELECT quantidade_devolvida FROM public.material_custodias
   WHERE client_uuid = '79310000-0000-4000-8000-000000000003'),
  0,
  'atomicity C rolls custody projection back'
);
SELECT is(
  (SELECT count(*) FROM public.estoque_movimentacoes
   WHERE client_uuid = '79300000-0000-4000-8000-000000000003'),
  0::bigint,
  'atomicity C rolls ledger back'
);

-- Atomicity D: reversal and custody update occur before event INSERT.
SELECT throws_ok(
  $test$SELECT public.cancelar_checkout_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79310000-0000-4000-8000-000000000004'),
    'atomicidade D',
    '79300000-0000-4000-8000-000000000004', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'P0001',
  'stage35 forced failure',
  'atomicity D forces cancellation event failure'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000009'),
  0,
  'atomicity D rolls stock reversal back'
);
SELECT is(
  (SELECT status FROM public.material_custodias
   WHERE client_uuid = '79310000-0000-4000-8000-000000000004'),
  'aberta'::public.material_custody_status,
  'atomicity D rolls custody cancellation back'
);
SELECT is(
  (SELECT count(*) FROM public.estoque_movimentacoes
   WHERE client_uuid = '79300000-0000-4000-8000-000000000004'),
  0::bigint,
  'atomicity D leaves no half reversal'
);

-- Exact partial-return sequence: 20 -> 8 -> 7 -> 5.
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000010', 20,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79400000-0000-4000-8000-000000000001', NULL, 'partial exact',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'exact partial checkout of 20 succeeds'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
    8, '76000000-0000-4000-8000-000000000001', 'bom',
    '79400000-0000-4000-8000-000000000002', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'first exact return of 8 succeeds'
);
SELECT is(
  (SELECT quantidade_retirada - quantidade_devolvida
   FROM public.material_custodias
   WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
  12,
  '12 remain in custody after returning 8'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
    7, '76000000-0000-4000-8000-000000000001', 'bom',
    '79400000-0000-4000-8000-000000000003', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'second exact return of 7 succeeds'
);
SELECT is(
  (SELECT quantidade_retirada - quantidade_devolvida
   FROM public.material_custodias
   WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
  5,
  '5 remain in custody after returning another 7'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
    6, '76000000-0000-4000-8000-000000000001', 'bom',
    '79400000-0000-4000-8000-000000000004', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI001',
  'A quantidade devolvida supera a quantidade ainda em custódia.',
  'return above the remaining 5 is blocked'
);
SELECT lives_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM public.material_custodias
     WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
    5, '76000000-0000-4000-8000-000000000001', 'bom',
    '79400000-0000-4000-8000-000000000005', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'final exact return of 5 succeeds'
);
SELECT is(
  (SELECT status FROM public.material_custodias
   WHERE client_uuid = '79400000-0000-4000-8000-000000000001'),
  'concluida'::public.material_custody_status,
  'exact partial sequence closes the custody'
);
SELECT is(
  (SELECT quantidade FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000010'),
  20,
  'exact partial sequence restores official stock'
);
SELECT is(
  (SELECT quantidade FROM public.materiais
   WHERE id = '79000000-0000-4000-8000-000000000010'),
  20,
  'material quantity remains only the synchronized projection'
);
SELECT is(
  (SELECT count(*) FROM public.estoque_saldos
   WHERE material_id = '79000000-0000-4000-8000-000000000010'),
  1::bigint,
  'Stage 3 creates no second balance'
);

-- Cross-company write isolation for return and cancellation.
SELECT is(
  (SELECT count(*) FROM public.material_custodia_eventos
   WHERE empresa_id = '72000000-0000-4000-8000-000000000002'),
  0::bigint,
  'company A cannot read company B custody event history'
);
SELECT throws_ok(
  $test$SELECT public.registrar_checkin_material(
    (SELECT id FROM pg_temp.stage35_cross_company_custody),
    1, '76000000-0000-4000-8000-000000000001', 'bom',
    '79500000-0000-4000-8000-000000000001', NULL, NULL, NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI005',
  'Operação de custódia não encontrada.',
  'company A cannot return company B custody'
);
SELECT throws_ok(
  $test$SELECT public.cancelar_checkout_material(
    (SELECT id FROM pg_temp.stage35_cross_company_custody),
    'cross-company cancel',
    '79500000-0000-4000-8000-000000000002', NULL,
    '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI005',
  'Operação de custódia não encontrada.',
  'company A cannot cancel company B custody'
);

RESET ROLE;

-- Master keeps explicit cross-company backend authority.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '73000000-0000-4000-8000-000000000007',
  'authenticated', 'authenticated', 'custody-master@example.test', '', now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Custody Master"}', now(), now()
);
UPDATE public.user_roles
SET role = 'master_admin'
WHERE user_id = '73000000-0000-4000-8000-000000000007';

SELECT set_config(
  'request.jwt.claim.sub',
  '73000000-0000-4000-8000-000000000007',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000006', 1,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79500000-0000-4000-8000-000000000003', NULL, 'master explicit tenant',
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'master can operate an explicitly selected company'
);
SELECT ok(
  (SELECT count(*) FROM public.material_custodias
   WHERE empresa_id = '72000000-0000-4000-8000-000000000002') > 0,
  'master can read cross-company custody history'
);
RESET ROLE;

-- Remove one entitlement temporarily and verify fail-closed behavior.
DELETE FROM public.empresa_modules
WHERE empresa_id = '72000000-0000-4000-8000-000000000002'
  AND module_id = (
    SELECT id FROM public.module_catalog
    WHERE feature_key = 'checkin_checkout'
  );
SELECT set_config(
  'request.jwt.claim.sub',
  '73000000-0000-4000-8000-000000000003',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '75000000-0000-4000-8000-000000000004', 1,
    '76000000-0000-4000-8000-000000000004', 'funcionario',
    '77000000-0000-4000-8000-000000000002', 'uso_interno', 'bom',
    '79500000-0000-4000-8000-000000000004', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000002'
  )$test$,
  'CI009',
  'O módulo Check-in e Check-out não está ativo para esta empresa.',
  'company without entitlement cannot checkout'
);
RESET ROLE;

-- An inactive company remains fail-closed even with module rows present.
UPDATE public.empresas
SET status = 'inativo'
WHERE id = '72000000-0000-4000-8000-000000000001';
SELECT set_config(
  'request.jwt.claim.sub',
  '73000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $test$SELECT public.registrar_checkout_material(
    '79000000-0000-4000-8000-000000000007', 1,
    '76000000-0000-4000-8000-000000000001', 'funcionario',
    '77000000-0000-4000-8000-000000000001', 'uso_interno', 'bom',
    '79500000-0000-4000-8000-000000000005', NULL, NULL,
    NULL, NULL, NULL, '72000000-0000-4000-8000-000000000001'
  )$test$,
  'CI010',
  'A empresa está em modo somente leitura.',
  'inactive company cannot checkout'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT * FROM finish();

ROLLBACK;
