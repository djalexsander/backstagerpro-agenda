BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(16);

-- 1..3 canonical tables and idempotency constraint
SELECT has_table('public', 'financeiro_lancamentos', 'canonical rental financial ledger exists');
SELECT has_table('public', 'financeiro_recebimentos', 'canonical receipt history table exists');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financeiro_lancamentos'::regclass
      AND conname = 'financeiro_lancamentos_origem_unica'
      AND contype = 'u'
  ),
  'one origin (empresa+tipo+id) can only ever have one lancamento - structural idempotency'
);

-- 4..5 receipt history is append-only, same pattern as material_locacao_eventos
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.financeiro_recebimentos'::regclass
      AND tgname = 'protect_financeiro_recebimentos'
      AND NOT tgisinternal
  ),
  'receipt history is protected from UPDATE/DELETE'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financeiro_recebimentos'::regclass
      AND conname = 'financeiro_recebimentos_client_uuid_unico'
      AND contype = 'u'
  ),
  'receipts are idempotent per client_uuid, same pattern as the rest of the rental module'
);

-- 6..9 RLS only reads directly; writes exclusively through RPCs (public.clientes pattern)
SELECT is(
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='financeiro_lancamentos'),
  1::bigint,
  'financeiro_lancamentos has exactly one policy (SELECT) - writes only through RPCs'
);
SELECT is(
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='financeiro_lancamentos' AND cmd='SELECT'),
  1::bigint,
  'that one policy is SELECT'
);
SELECT is(
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='financeiro_recebimentos'),
  1::bigint,
  'financeiro_recebimentos has exactly one policy (SELECT) too'
);
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='financeiro_lancamentos' AND cmd='SELECT')
    ILIKE '%can_read_company_module%',
  'read policy uses the canonical wrapper, not a private helper directly'
);

-- 10..12 physical vs financial state machines stay independent
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'confirmar_reserva_locacao_material' AND pronamespace = 'public'::regnamespace)
  ILIKE '%financeiro%',
  'reserva confirmada is the point where the financial entry is generated'
);
SELECT ok(
  (SELECT NOT (prosrc ILIKE '%financeiro%' OR prosrc ILIKE '%sync_material_rental_financial%')
   FROM pg_proc WHERE proname = 'concluir_locacao_material' AND pronamespace = 'public'::regnamespace),
  'concluding a rental never touches the financial ledger - physical completion does not imply payment'
);
SELECT ok(
  (SELECT NOT (prosrc ILIKE '%financeiro%' OR prosrc ILIKE '%sync_material_rental_financial%')
   FROM pg_proc WHERE proname = 'registrar_checkin_material' AND pronamespace = 'public'::regnamespace),
  'checkin never touches the financial ledger directly - only rental status sync (backend already validated separately)'
);

-- 13..14 the internal sync helper stays private; the public RPCs stay public
-- Signatures grew when payment condition / installments / reversal were
-- added on top of this same migration: sync gained forma_cobranca,
-- vencimento, parcelas; registrar_recebimento_locacao gained _parcela_id.
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_material_rental_financial_entry(uuid, uuid, text, date, jsonb)',
    'EXECUTE'
  ),
  'sync_material_rental_financial_entry keeps no EXECUTE grant for authenticated - internal only, same as sync_material_rental_status'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.registrar_recebimento_locacao(uuid, numeric, text, uuid, timestamptz, text, uuid, uuid)',
    'EXECUTE'
  ),
  'registrar_recebimento_locacao is callable by authenticated (the actual UI action)'
);

-- 15..16 cancellation preserves receipt history, never a hard delete
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'sync_material_rental_financial_entry' AND pronamespace = 'public'::regnamespace)
  NOT ILIKE '%DELETE FROM public.financeiro%',
  'sync never deletes a lancamento or receipt - cancellation only flips status'
);
-- The guard isn't a literal "valor_recebido = 0" comparison - it's delegated
-- to financeiro_status_from_valores(true, ...), whose own CASE only returns
-- 'cancelado' when valor_recebido <= 0 (see 20260806090000:242-249). This
-- checks the delegation itself, not a substring that was never in the source.
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'sync_material_rental_financial_entry' AND pronamespace = 'public'::regnamespace)
  ILIKE '%financeiro_status_from_valores(true,%',
  'auto-cancel on rental cancellation computes status via financeiro_status_from_valores instead of a blind literal - it only becomes cancelado when nothing was received yet'
);

SELECT * FROM finish();

ROLLBACK;
