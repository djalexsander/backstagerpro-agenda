-- Codex review (cycle 3) flagged that Master > Empresas' plan assignment was
-- incoherent for anything other than the isento -> pago special case it
-- patched in the previous cycle:
--   * a company created by the Master with a paid plano_id kept the
--     default status_pagamento = 'pendente' and got no pagamentos row,
--     leaving it blocked with no way to ever reach 'pago' (no pending
--     charge for the master to confirm via the existing "marcar pago" flow);
--   * editing an auto-cadastro's plan never cleared precisa_escolher_plano;
--   * assigning the trial plan kept plano_id set, contradicting the
--     canonical access-control model where a trial company has plano_id
--     NULL and is keyed off trial_expires_at only;
--   * switching between paid plans never reconciled pending
--     pagamentos/asaas_payments/module_* charges left over from the old
--     plan.
--
-- Fix: one canonical, transactional, Master-only RPC covering all three
-- plan shapes (paid, trial, vitalícia), reused by both the "criar empresa"
-- and "editar empresa" flows in src/pages/master/Empresas.tsx. The lifetime
-- case is delegated wholesale to the already-hardened
-- set_company_lifetime_subscription (its own invariant checks and canonical
-- plan lookup stay the single source of truth for that plan), so this
-- function only has to own the paid/trial branches.
--
-- A master-initiated plan assignment is an administrative concession, not a
-- customer self-checkout: the master already picks the due date directly
-- in the form, so a paid assignment is marked status_pagamento = 'pago'
-- immediately for that date instead of manufacturing a pagamentos/asaas
-- charge nobody would ever be prompted to settle.

CREATE OR REPLACE FUNCTION public.master_set_company_plan(
  _empresa_id uuid,
  _plano_id uuid,
  _status text DEFAULT 'ativo',
  _vencimento timestamptz DEFAULT NULL,
  _renew_trial boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_status text := COALESCE(NULLIF(_status, ''), 'ativo');
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_due_at timestamptz;
  v_trial_end timestamptz;
  v_trial_started_at timestamptz;
  v_trial_consumed_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_status NOT IN ('ativo', 'inativo') THEN
    RAISE EXCEPTION 'Invalid company status: %', v_status;
  END IF;

  IF v_actor_id IS NULL OR NOT public.is_master_admin(v_actor_id) THEN
    RAISE EXCEPTION
      'Only a global master administrator can change a company plan';
  END IF;

  SELECT plan.*
  INTO v_plan
  FROM public.planos AS plan
  WHERE plan.id = _plano_id
    AND plan.ativo = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan was not found or is inactive';
  END IF;

  -- The lifetime plan has its own dedicated, already-hardened transactional
  -- entry point with its own canonical-plan lookup and idempotency
  -- semantics; delegate wholesale so callers only ever need this one RPC
  -- regardless of which plan the master picks.
  IF v_plan.periodicidade = 'vitalicio' THEN
    RETURN public.set_company_lifetime_subscription(_empresa_id, v_status);
  END IF;

  SELECT company.*
  INTO v_company
  FROM public.empresas AS company
  WHERE company.id = _empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company was not found';
  END IF;

  -- A pending/overdue charge that already has a provider-side
  -- asaas_payment_id is live at Asaas: if the master reassigns the plan
  -- while it is still open and the customer later pays that stale invoice,
  -- process_asaas_payment_webhook would activate its (now outdated)
  -- payment_type/related_plano_id and silently overwrite this transition.
  -- Mirror set_company_lifetime_subscription's guard so the operator must
  -- cancel it at the provider first, for both base-plan and module charges
  -- (the latter are tracked here too, via related_batch_request_id).
  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payment
    WHERE payment.empresa_id = _empresa_id
      AND payment.status IN ('pending', 'overdue')
      AND payment.asaas_payment_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Company has an open provider charge that must be cancelled first';
  END IF;

  -- Reconcile any charge left over from whatever plan/state the company is
  -- leaving, so a master-initiated transition never leaves a stale pending
  -- charge that no longer corresponds to the plan just assigned.
  UPDATE public.asaas_payments
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('cancel_reason', 'company_plan_changed_by_master')
  WHERE empresa_id = _empresa_id
    AND status IN ('pending', 'overdue')
    AND asaas_payment_id IS NULL;

  UPDATE public.pagamentos
  SET status = 'cancelado',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pendente';

  UPDATE public.module_requests
  SET status = 'cancelled',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  UPDATE public.module_payments
  SET status = 'cancelled',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  UPDATE public.module_batch_requests
  SET status = 'cancelled'
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  IF v_plan.periodicidade = 'trial' THEN
    IF v_plan.trial_days <= 0 THEN
      RAISE EXCEPTION 'Trial plan is misconfigured (trial_days must be positive)';
    END IF;

    -- Idempotent by default: the master panel re-invokes this same
    -- assignment on every "editar empresa" save so trial edits can keep
    -- trial_expires_at coherent with vencimento (see Empresas.tsx), so
    -- repeating the *same* trial assignment on a company already on it must
    -- not push the expiration further out each time. Only an explicit
    -- _renew_trial grants a fresh trial_days window from now.
    IF NOT _renew_trial
       AND v_company.plano_id IS NULL
       AND v_company.plano = v_plan.nome
       AND v_company.trial_expires_at IS NOT NULL THEN
      v_trial_end := v_company.trial_expires_at;
      v_trial_started_at := COALESCE(v_company.trial_started_at, v_now);
    ELSE
      v_trial_end := v_now + make_interval(days => v_plan.trial_days);
      v_trial_started_at := v_now;
    END IF;

    -- Permanent consumption marker: once an administrative trial grant has
    -- ever set this, it must never be cleared or moved forward again (not
    -- even by a later renewal), so it keeps proving the company already
    -- used its trial after a paid transition wipes trial_expires_at below.
    v_trial_consumed_at := COALESCE(v_company.trial_consumed_at, v_now);

    -- Canonical model: a trial company carries plano_id = NULL (access
    -- control keys trial exclusively off trial_expires_at). vencimento
    -- mirrors trial_expires_at only for the Master panel's own display.
    UPDATE public.empresas
    SET plano = v_plan.nome,
        plano_id = NULL,
        status = v_status,
        status_pagamento = NULL,
        vencimento = v_trial_end,
        trial_expires_at = v_trial_end,
        trial_started_at = v_trial_started_at,
        trial_consumed_at = v_trial_consumed_at,
        precisa_escolher_plano = false,
        plano_bloqueado = false,
        data_contrato = COALESCE(data_contrato, current_date)
    WHERE id = _empresa_id;

    v_result := jsonb_build_object(
      'tipo', 'trial',
      'empresa_id', _empresa_id,
      'empresa_nome', v_company.nome_empresa,
      'plano_id', NULL,
      'plano_nome', v_plan.nome,
      'trial_expires_at', v_trial_end,
      'trial_started_at', v_trial_started_at,
      'trial_consumed_at', v_trial_consumed_at,
      'status', v_status
    );
  ELSE
    IF _vencimento IS NOT NULL THEN
      v_due_at := _vencimento;
    ELSIF v_plan.periodicidade = 'anual' THEN
      v_due_at := v_now + interval '1 year';
    ELSE
      v_due_at := v_now + interval '30 days';
    END IF;

    UPDATE public.empresas
    SET plano = v_plan.nome,
        plano_id = v_plan.id,
        status = v_status,
        status_pagamento = 'pago',
        vencimento = v_due_at,
        trial_expires_at = NULL,
        precisa_escolher_plano = false,
        plano_bloqueado = false,
        data_contrato = COALESCE(data_contrato, current_date)
    WHERE id = _empresa_id;

    -- The company may be leaving a trial (administrative or self-service)
    -- for a paid plan; trial_expires_at is wiped above, so the periodic
    -- expiration job can no longer find this company to deactivate its
    -- trial-granted modules. Do it synchronously here instead, mirroring
    -- choose_company_plan's self-service paid transition. A no-op for
    -- companies that were never granted a trial module.
    PERFORM public.deactivate_trial_modules(_empresa_id);

    v_result := jsonb_build_object(
      'tipo', 'pago',
      'empresa_id', _empresa_id,
      'empresa_nome', v_company.nome_empresa,
      'plano_id', v_plan.id,
      'plano_nome', v_plan.nome,
      'vencimento', v_due_at,
      'status', v_status
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.master_set_company_plan(uuid, uuid, text, timestamptz, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_company_plan(uuid, uuid, text, timestamptz, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.master_set_company_plan(uuid, uuid, text, timestamptz, boolean) IS
  'Canonical, transactional Master entry point for assigning/changing a company plan (paid, trial, or vitalícia). Delegates lifetime assignments to set_company_lifetime_subscription; keeps plano_id/status_pagamento/vencimento/trial_expires_at/precisa_escolher_plano/plano_bloqueado coherent, cancels stale pending charges left by the previous plan, rejects the transition while a live provider charge is still open, and repeats the same trial assignment idempotently unless _renew_trial is set.';

DO $$
DECLARE
  v_fn regprocedure := 'public.master_set_company_plan(uuid, uuid, text, timestamptz, boolean)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN138',
      MESSAGE = 'Hardening falhou: master_set_company_plan executavel por anon.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN139',
      MESSAGE = 'master_set_company_plan nao esta executavel por authenticated.';
  END IF;
END;
$$;
