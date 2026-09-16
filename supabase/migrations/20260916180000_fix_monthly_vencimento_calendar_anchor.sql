-- Monthly vencimento was computed as "+ interval '30 days'" everywhere it's
-- set. Not every month has 30 days, so chaining that across renewals drifts
-- the due date backward (e.g. day 16 -> day 15 -> day 14 ...). Fix: anchor
-- to the subscription's original day-of-month (empresas.data_contrato,
-- confirmed stable across every renewal — see process_asaas_payment_webhook's
-- renewal branch, which never touches it) and advance by one calendar month,
-- clamping to the target month's last day without losing the original anchor
-- day for months after the clamp (e.g. base day 31: 31/01 -> 28/02 -> 31/03,
-- not 31/01 -> 28/02 -> 28/03).

CREATE OR REPLACE FUNCTION public.next_monthly_due_date(
  _from timestamptz,
  _anchor_day integer
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  -- date_trunc('month', timestamptz) and interval arithmetic on timestamptz
  -- both go through the session's TimeZone GUC. Do all calendar math on the
  -- UTC wall-clock reading (a naive timestamp, immune to session timezone)
  -- and only convert at the two boundaries, so this is correct regardless of
  -- what TimeZone the calling session happens to have.
  SELECT (
    LEAST(
      date_trunc('month', _from AT TIME ZONE 'UTC') + interval '1 month'
        + make_interval(days => _anchor_day - 1),
      date_trunc('month', _from AT TIME ZONE 'UTC') + interval '2 month' - interval '1 day'
    )
    + ((_from AT TIME ZONE 'UTC') - date_trunc('day', _from AT TIME ZONE 'UTC'))
  ) AT TIME ZONE 'UTC'
$$;

REVOKE ALL ON FUNCTION public.next_monthly_due_date(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_monthly_due_date(timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.next_monthly_due_date(timestamptz, integer) IS
  'Next occurrence of _anchor_day in the calendar month after _from''s month, clamped to that month''s last day; preserves time-of-day from _from.';

-- choose_company_plan: self-service first paid-plan purchase.
CREATE OR REPLACE FUNCTION public.choose_company_plan(
  _actor_id uuid,
  _selection_type text,
  _plan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_due_at timestamptz;
  v_trial_end timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'master_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Master admin must use the administrative plan flow';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'admin_empresa'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Only a company administrator can choose a plan';
  END IF;

  SELECT empresas.*
  INTO v_company
  FROM public.empresas AS empresas
  JOIN public.profiles AS profiles
    ON profiles.empresa_id = empresas.id
  WHERE profiles.user_id = _actor_id
  FOR UPDATE OF empresas;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated administrator has no company';
  END IF;

  IF _selection_type = 'free' THEN
    IF _plan_id IS NOT NULL
       OR v_company.plano_id IS NOT NULL
       OR v_company.trial_consumed_at IS NOT NULL
       OR v_company.trial_expires_at IS NOT NULL
       OR NOT v_company.precisa_escolher_plano
       OR EXISTS (
         SELECT 1
         FROM public.pagamentos
         WHERE empresa_id = v_company.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.system_logs
         WHERE empresa_id = v_company.id
           AND acao = 'plano_solicitado'
       )
       OR COALESCE(v_company.status_pagamento, '') IN (
         'aguardando_pagamento',
         'pagamento_em_analise',
         'pago'
       ) THEN
      RAISE EXCEPTION 'Trial already used or transition is not allowed';
    END IF;

    v_trial_end := v_now + interval '7 days';

    UPDATE public.empresas
    SET plano = 'Teste Free 7 dias',
        plano_id = NULL,
        trial_started_at = v_now,
        trial_consumed_at = v_now,
        trial_expires_at = v_trial_end,
        vencimento = v_trial_end,
        precisa_escolher_plano = false,
        plano_bloqueado = false,
        status = 'ativo',
        status_pagamento = NULL
    WHERE id = v_company.id;

    RETURN jsonb_build_object(
      'tipo', 'free',
      'empresa_id', v_company.id,
      'empresa_nome', v_company.nome_empresa,
      'trial_expires_at', v_trial_end
    );
  END IF;

  IF _selection_type <> 'paid' OR _plan_id IS NULL THEN
    RAISE EXCEPTION 'Invalid plan selection';
  END IF;

  SELECT planos.*
  INTO v_plan
  FROM public.planos AS planos
  WHERE planos.id = _plan_id
    AND planos.ativo = true
    AND planos.disponivel_novo_cadastro = true
    AND planos.valor > 0
    AND planos.periodicidade IN ('mensal', 'anual', 'vitalicio')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan is not available for signup';
  END IF;

  IF v_company.plano_id IS NOT NULL
     OR COALESCE(v_company.status_pagamento, '') IN (
       'aguardando_pagamento',
       'pagamento_em_analise',
       'pago'
     )
     OR NOT (
       v_company.precisa_escolher_plano
       OR v_company.trial_consumed_at IS NOT NULL
       OR v_company.trial_expires_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Paid plan transition is not allowed';
  END IF;

  CASE v_plan.periodicidade
    WHEN 'mensal' THEN v_due_at := public.next_monthly_due_date(v_now, EXTRACT(DAY FROM v_now)::integer);
    WHEN 'anual' THEN v_due_at := v_now + interval '1 year';
    WHEN 'vitalicio' THEN v_due_at := NULL;
  END CASE;

  UPDATE public.empresas
  SET precisa_escolher_plano = false,
      plano_bloqueado = true,
      status_pagamento = 'aguardando_pagamento',
      plano = v_plan.nome,
      plano_id = v_plan.id,
      trial_expires_at = NULL,
      data_contrato = v_now::date,
      vencimento = v_due_at,
      status = 'ativo'
  WHERE id = v_company.id;

  PERFORM public.deactivate_trial_modules(v_company.id);

  RETURN jsonb_build_object(
    'tipo', 'paid',
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'plano_id', v_plan.id,
    'plano_nome', v_plan.nome,
    'vencimento', v_due_at
  );
END;
$$;

-- master_set_company_plan: administrative paid-plan assignment fallback
-- (only reached when the Master panel doesn't send an explicit _vencimento).
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
      v_due_at := public.next_monthly_due_date(
        v_now,
        EXTRACT(DAY FROM COALESCE(v_company.data_contrato, v_now))::integer
      );
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

-- process_asaas_payment_webhook: base_plan branch anchors to its own
-- activation day (data_contrato is set to the same v_activation_time in the
-- same statement); renewal branch anchors to data_contrato specifically
-- (never v_company.vencimento / v_cycle_start), so any date already drifted
-- by the old +30-days math self-corrects on the next renewal instead of
-- compounding it, and the original subscription day is never lost.
CREATE OR REPLACE FUNCTION public.process_asaas_payment_webhook(
  _event_id text,
  _event_type text,
  _asaas_payment_id text,
  _provider_amount numeric,
  _external_reference text DEFAULT NULL,
  _event_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.asaas_payments%ROWTYPE;
  v_existing_event public.asaas_webhook_events%ROWTYPE;
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_batch public.module_batch_requests%ROWTYPE;
  v_item record;
  v_existing_module_id uuid;
  v_activation_time timestamptz;
  v_expiration timestamptz;
  v_cycle_start timestamptz;
  v_new_status text;
  v_action text := 'status_updated';
  v_item_count integer := 0;
  v_distinct_item_count integer := 0;
  v_items_total numeric := 0;
  v_base_item_count integer := 0;
  v_renewed_module_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  IF _event_id IS NULL
     OR length(_event_id) < 5
     OR length(_event_id) > 255
     OR _asaas_payment_id IS NULL
     OR length(_asaas_payment_id) < 5
     OR length(_asaas_payment_id) > 255 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid Asaas event or payment identifier';
  END IF;

  IF _event_type NOT IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported Asaas confirmation event';
  END IF;

  IF _provider_amount IS NULL OR _provider_amount <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid Asaas payment amount';
  END IF;

  SELECT payments.*
  INTO v_payment
  FROM public.asaas_payments AS payments
  WHERE payments.asaas_payment_id = _asaas_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF COALESCE(_external_reference, '') LIKE 'backstage_pro:%' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BACKSTAGE_PAYMENT_MAPPING_PENDING';
    END IF;

    RETURN jsonb_build_object(
      'action', 'not_backstage_pro',
      'event_id', _event_id,
      'asaas_payment_id', _asaas_payment_id
    );
  END IF;

  IF v_payment.source_app <> 'backstage_pro' THEN
    RETURN jsonb_build_object(
      'action', 'wrong_app',
      'event_id', _event_id,
      'asaas_payment_id', _asaas_payment_id
    );
  END IF;

  SELECT events.*
  INTO v_existing_event
  FROM public.asaas_webhook_events AS events
  WHERE events.id = _event_id;

  IF FOUND THEN
    IF v_existing_event.asaas_payment_id <> _asaas_payment_id
       OR v_existing_event.event_type <> _event_type THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'Asaas event identifier was reused with different data';
    END IF;

    RETURN jsonb_build_object(
      'action', 'already_processed',
      'event_id', _event_id,
      'payment_id', v_payment.id,
      'activation_status', v_payment.activation_status
    );
  END IF;

  IF round(v_payment.amount, 2) <> round(_provider_amount, 2) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ASAAS_PAYMENT_AMOUNT_MISMATCH';
  END IF;

  IF v_payment.status IN ('cancelled', 'refunded') THEN
    INSERT INTO public.asaas_webhook_events (
      id,
      internal_payment_id,
      asaas_payment_id,
      event_type,
      provider_amount,
      result
    )
    VALUES (
      _event_id,
      v_payment.id,
      _asaas_payment_id,
      _event_type,
      round(_provider_amount, 2),
      'inactive_payment'
    );

    UPDATE public.asaas_payments
    SET last_webhook_event_id = _event_id
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'action', 'inactive_payment',
      'event_id', _event_id,
      'payment_id', v_payment.id
    );
  END IF;

  v_new_status := CASE
    WHEN v_payment.status = 'received' OR _event_type = 'PAYMENT_RECEIVED'
      THEN 'received'
    ELSE 'confirmed'
  END;

  v_activation_time := COALESCE(
    v_payment.payment_confirmed_at,
    LEAST(COALESCE(_event_created_at, clock_timestamp()), clock_timestamp())
  );

  IF v_payment.activation_status <> 'completed' THEN
    SELECT companies.*
    INTO v_company
    FROM public.empresas AS companies
    WHERE companies.id = v_payment.empresa_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Company for Asaas payment no longer exists';
    END IF;

    IF v_payment.payment_type = 'base_plan' THEN
      IF v_payment.related_plano_id IS NULL THEN
        RAISE EXCEPTION 'Asaas base-plan payment has no related plan';
      END IF;

      SELECT plans.*
      INTO v_plan
      FROM public.planos AS plans
      WHERE plans.id = v_payment.related_plano_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Plan related to Asaas payment no longer exists';
      END IF;

      v_expiration := CASE v_plan.periodicidade
        WHEN 'mensal' THEN public.next_monthly_due_date(v_activation_time, EXTRACT(DAY FROM v_activation_time)::integer)
        WHEN 'anual' THEN v_activation_time + interval '1 year'
        WHEN 'vitalicio' THEN NULL
        ELSE NULL
      END;

      IF v_plan.periodicidade NOT IN ('mensal', 'anual', 'vitalicio') THEN
        RAISE EXCEPTION 'Unsupported plan periodicity';
      END IF;

      UPDATE public.empresas
      SET plano_bloqueado = false,
          status_pagamento = 'pago',
          status = 'ativo',
          plano = v_plan.nome,
          plano_id = v_plan.id,
          vencimento = v_expiration,
          data_contrato = v_activation_time,
          precisa_escolher_plano = false
      WHERE id = v_company.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_plano_ativado',
        'Plano ' || v_plan.nome || ' ativado via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'plano_id', v_plan.id
        )
      );
    ELSIF v_payment.payment_type = 'renewal' THEN
      IF v_payment.related_plano_id IS NULL
         OR v_payment.renewal_competence IS NULL THEN
        RAISE EXCEPTION 'Asaas renewal payment has no plan or competence';
      END IF;

      IF v_company.plano_id IS DISTINCT FROM v_payment.related_plano_id THEN
        RAISE EXCEPTION 'Company plan changed after the renewal charge was created';
      END IF;

      SELECT plans.*
      INTO v_plan
      FROM public.planos AS plans
      WHERE plans.id = v_payment.related_plano_id;

      IF NOT FOUND OR v_plan.periodicidade <> 'mensal' THEN
        RAISE EXCEPTION 'Plan related to Asaas renewal is not monthly';
      END IF;

      SELECT
        count(*) FILTER (
          WHERE items.item_type = 'base_plan'
            AND items.related_plano_id = v_payment.related_plano_id
        )::integer,
        count(*)::integer,
        round(COALESCE(sum(items.amount), 0), 2)
      INTO v_base_item_count, v_item_count, v_items_total
      FROM public.asaas_renewal_items AS items
      WHERE items.payment_id = v_payment.id;

      IF v_base_item_count <> 1
         OR v_item_count = 0
         OR v_items_total <> round(v_payment.amount, 2) THEN
        RAISE EXCEPTION 'Asaas renewal items do not match the reserved payment';
      END IF;

      v_cycle_start := CASE
        WHEN v_company.vencimento IS NOT NULL
             AND v_company.vencimento > v_activation_time
          THEN v_company.vencimento
        ELSE v_activation_time
      END;
      v_expiration := public.next_monthly_due_date(
        v_cycle_start,
        EXTRACT(DAY FROM COALESCE(v_company.data_contrato, v_cycle_start))::integer
      );

      UPDATE public.empresas
      SET plano_bloqueado = false,
          status_pagamento = 'pago',
          status = 'ativo',
          vencimento = v_expiration,
          precisa_escolher_plano = false
      WHERE id = v_company.id;

      FOR v_item IN
        SELECT
          items.related_empresa_module_id,
          items.related_module_id
        FROM public.asaas_renewal_items AS items
        WHERE items.payment_id = v_payment.id
          AND items.item_type = 'module'
        ORDER BY items.id
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            v_company.id::text || ':module:' || v_item.related_module_id::text,
            0
          )
        );

        UPDATE public.empresa_modules
        SET expires_at = CASE
              WHEN expires_at IS NULL OR expires_at < v_expiration
                THEN v_expiration
              ELSE expires_at
            END
        WHERE id = v_item.related_empresa_module_id
          AND empresa_id = v_company.id
          AND module_id = v_item.related_module_id
          AND status = 'active';

        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        v_renewed_module_count := v_renewed_module_count + v_updated_count;
      END LOOP;

      UPDATE public.asaas_payments
      SET billing_cycle_started_at = v_cycle_start,
          billing_cycle_ends_at = v_expiration
      WHERE id = v_payment.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_mensalidade_renovada',
        'Mensalidade renovada via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'plano_id', v_plan.id,
          'renewal_competence', v_payment.renewal_competence,
          'billing_cycle_started_at', v_cycle_start,
          'billing_cycle_ends_at', v_expiration,
          'renewed_module_count', v_renewed_module_count
        )
      );
    ELSIF v_payment.payment_type = 'modules' THEN
      IF v_payment.related_batch_request_id IS NULL THEN
        RAISE EXCEPTION 'Asaas module payment has no related batch';
      END IF;

      SELECT batches.*
      INTO v_batch
      FROM public.module_batch_requests AS batches
      WHERE batches.id = v_payment.related_batch_request_id
        AND batches.empresa_id = v_company.id
        AND batches.payment_method = 'asaas'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trusted Asaas module batch was not found';
      END IF;

      IF v_batch.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Asaas module batch is not activatable';
      END IF;

      SELECT
        count(*)::integer,
        count(DISTINCT module_id)::integer,
        round(COALESCE(sum(valor), 0), 2)
      INTO v_item_count, v_distinct_item_count, v_items_total
      FROM public.module_batch_request_items
      WHERE batch_request_id = v_batch.id;

      IF v_item_count = 0
         OR v_item_count <> v_distinct_item_count
         OR v_items_total <> round(v_payment.amount, 2) THEN
        RAISE EXCEPTION 'Asaas module batch does not match the reserved payment';
      END IF;

      IF v_payment.related_module_id IS NOT NULL AND (
        v_item_count <> 1
        OR NOT EXISTS (
          SELECT 1
          FROM public.module_batch_request_items
          WHERE batch_request_id = v_batch.id
            AND module_id = v_payment.related_module_id
        )
      ) THEN
        RAISE EXCEPTION 'Asaas module batch does not match the related module';
      END IF;

      FOR v_item IN
        SELECT module_id, valor
        FROM public.module_batch_request_items
        WHERE batch_request_id = v_batch.id
        ORDER BY id
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            v_company.id::text || ':module:' || v_item.module_id::text,
            0
          )
        );

        v_existing_module_id := NULL;
        SELECT modules.id
        INTO v_existing_module_id
        FROM public.empresa_modules AS modules
        WHERE modules.empresa_id = v_company.id
          AND modules.module_id = v_item.module_id
          AND modules.status = 'active'
        ORDER BY modules.created_at DESC
        LIMIT 1
        FOR UPDATE;

        IF NOT FOUND THEN
          SELECT modules.id
          INTO v_existing_module_id
          FROM public.empresa_modules AS modules
          WHERE modules.empresa_id = v_company.id
            AND modules.module_id = v_item.module_id
            AND modules.status <> 'active'
          ORDER BY modules.created_at DESC
          LIMIT 1
          FOR UPDATE;

          IF FOUND THEN
            UPDATE public.empresa_modules
            SET status = 'active',
                activated_at = v_activation_time,
                valor_cobrado = v_item.valor,
                origem = 'asaas_pagamento',
                granted_by_admin = false,
                trial_granted = false,
                expires_at = v_company.vencimento
            WHERE id = v_existing_module_id;
          ELSE
            INSERT INTO public.empresa_modules (
              empresa_id,
              module_id,
              status,
              activated_at,
              valor_cobrado,
              origem,
              granted_by_admin,
              trial_granted,
              expires_at
            )
            VALUES (
              v_company.id,
              v_item.module_id,
              'active',
              v_activation_time,
              v_item.valor,
              'asaas_pagamento',
              false,
              false,
              v_company.vencimento
            );
          END IF;
        END IF;
      END LOOP;

      UPDATE public.module_batch_requests
      SET status = 'approved',
          approved_at = COALESCE(approved_at, v_activation_time)
      WHERE id = v_batch.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_modulos_ativados',
        v_item_count || ' modulo(s) ativado(s) via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'batch_request_id', v_batch.id,
          'module_count', v_item_count
        )
      );
    ELSE
      RAISE EXCEPTION 'Unsupported Asaas payment type';
    END IF;

    INSERT INTO public.notificacoes_master (
      empresa_id,
      tipo,
      mensagem,
      dados
    )
    VALUES (
      v_company.id,
      'pagamento_confirmado',
      'Pagamento Asaas confirmado: R$ '
        || to_char(v_payment.amount, 'FM999999990D00')
        || ' (' || v_payment.payment_type || ') - '
        || v_company.nome_empresa,
      jsonb_build_object(
        'payment_id', v_payment.id,
        'asaas_payment_id', _asaas_payment_id,
        'event_id', _event_id,
        'payment_type', v_payment.payment_type,
        'amount', v_payment.amount
      )
    );

    v_action := 'activated';
  END IF;

  UPDATE public.asaas_payments
  SET status = v_new_status,
      payment_confirmed_at = COALESCE(payment_confirmed_at, v_activation_time),
      activation_status = 'completed',
      activation_completed_at = COALESCE(
        activation_completed_at,
        clock_timestamp()
      ),
      last_webhook_event_id = _event_id,
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'phase', 'activated',
          'last_webhook_event', _event_type
        )
  WHERE id = v_payment.id;

  INSERT INTO public.asaas_webhook_events (
    id,
    internal_payment_id,
    asaas_payment_id,
    event_type,
    provider_amount,
    result
  )
  VALUES (
    _event_id,
    v_payment.id,
    _asaas_payment_id,
    _event_type,
    round(_provider_amount, 2),
    v_action
  );

  RETURN jsonb_build_object(
    'action', v_action,
    'event_id', _event_id,
    'payment_id', v_payment.id,
    'payment_status', v_new_status,
    'activation_status', 'completed'
  );
END;
$$;
