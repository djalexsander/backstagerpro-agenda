-- One-off Asaas PIX charges for monthly subscription renewals.
--
-- The renewal competence is the company due date being renewed. It remains
-- stable while a payment is pending (including after that date passes), and a
-- new competence only becomes available after the webhook advances vencimento.

ALTER TABLE public.asaas_payments
  DROP CONSTRAINT IF EXISTS asaas_payments_payment_type_check;

ALTER TABLE public.asaas_payments
  ADD CONSTRAINT asaas_payments_payment_type_check
  CHECK (payment_type IN ('base_plan', 'modules', 'renewal'));

ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS renewal_competence date,
  ADD COLUMN IF NOT EXISTS billing_cycle_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_cycle_ends_at timestamptz;

ALTER TABLE public.asaas_payments
  ADD CONSTRAINT asaas_payments_renewal_shape_check
  CHECK (
    (
      payment_type = 'renewal'
      AND renewal_competence IS NOT NULL
      AND related_plano_id IS NOT NULL
      AND related_batch_request_id IS NULL
      AND related_module_id IS NULL
    ) OR (
      payment_type <> 'renewal'
      AND renewal_competence IS NULL
      AND billing_cycle_started_at IS NULL
      AND billing_cycle_ends_at IS NULL
    )
  );

ALTER TABLE public.asaas_payments
  ADD CONSTRAINT asaas_payments_billing_cycle_order_check
  CHECK (
    (billing_cycle_started_at IS NULL AND billing_cycle_ends_at IS NULL)
    OR (
      billing_cycle_started_at IS NOT NULL
      AND billing_cycle_ends_at IS NOT NULL
      AND billing_cycle_ends_at > billing_cycle_started_at
    )
  );

CREATE UNIQUE INDEX asaas_payments_renewal_competence_uidx
  ON public.asaas_payments (empresa_id, renewal_competence)
  WHERE payment_type = 'renewal'
    AND status NOT IN ('cancelled', 'refunded');

-- Immutable price/entitlement snapshot used by the confirmation webhook.
-- empresa_id is intentionally not duplicated: payment_id is the single tenant
-- owner and already references asaas_payments.empresa_id with ON DELETE CASCADE.
CREATE TABLE public.asaas_renewal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL
    REFERENCES public.asaas_payments(id) ON DELETE CASCADE,
  item_type text NOT NULL
    CHECK (item_type IN ('base_plan', 'module')),
  related_plano_id uuid REFERENCES public.planos(id),
  related_empresa_module_id uuid REFERENCES public.empresa_modules(id),
  related_module_id uuid REFERENCES public.module_catalog(id),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asaas_renewal_items_shape_check CHECK (
    (
      item_type = 'base_plan'
      AND related_plano_id IS NOT NULL
      AND related_empresa_module_id IS NULL
      AND related_module_id IS NULL
    ) OR (
      item_type = 'module'
      AND related_plano_id IS NULL
      AND related_empresa_module_id IS NOT NULL
      AND related_module_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX asaas_renewal_items_one_plan_uidx
  ON public.asaas_renewal_items (payment_id)
  WHERE item_type = 'base_plan';

CREATE UNIQUE INDEX asaas_renewal_items_one_module_uidx
  ON public.asaas_renewal_items (payment_id, related_empresa_module_id)
  WHERE item_type = 'module';

ALTER TABLE public.asaas_renewal_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asaas_renewal_items
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.asaas_renewal_items TO service_role;

COMMENT ON TABLE public.asaas_renewal_items IS
  'Server-owned snapshot of the base plan and monthly active modules included in an Asaas renewal charge.';

CREATE OR REPLACE FUNCTION public.validate_asaas_renewal_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.asaas_payments%ROWTYPE;
BEGIN
  SELECT payments.*
  INTO v_payment
  FROM public.asaas_payments AS payments
  WHERE payments.id = NEW.payment_id;

  IF NOT FOUND OR v_payment.payment_type <> 'renewal' THEN
    RAISE EXCEPTION 'Renewal items require a renewal payment';
  END IF;

  IF NEW.item_type = 'base_plan' THEN
    IF NEW.related_plano_id IS DISTINCT FROM v_payment.related_plano_id THEN
      RAISE EXCEPTION 'Renewal plan item does not match its payment';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.empresa_modules AS company_modules
    WHERE company_modules.id = NEW.related_empresa_module_id
      AND company_modules.empresa_id = v_payment.empresa_id
      AND company_modules.module_id = NEW.related_module_id
  ) THEN
    RAISE EXCEPTION 'Renewal module item does not belong to the paying company';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_asaas_renewal_item()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_asaas_renewal_item_trigger
BEFORE INSERT OR UPDATE ON public.asaas_renewal_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_asaas_renewal_item();

CREATE OR REPLACE FUNCTION public.prepare_asaas_renewal_charge(
  _actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_payment public.asaas_payments%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_due_date date := (clock_timestamp() + interval '3 days')::date;
  v_competence date;
  v_plan_amount numeric(14, 2);
  v_modules_amount numeric(14, 2) := 0;
  v_total_amount numeric(14, 2);
  v_module_count integer := 0;
  v_snapshot_module_count integer := 0;
  v_snapshot_total numeric(14, 2) := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'master_admin'::public.app_role
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'admin_empresa'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Only a company administrator can create a charge';
  END IF;

  SELECT companies.*
  INTO v_company
  FROM public.empresas AS companies
  JOIN public.profiles AS profiles
    ON profiles.empresa_id = companies.id
  WHERE profiles.user_id = _actor_id
  FOR UPDATE OF companies;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated administrator has no company';
  END IF;

  IF v_company.plano_id IS NULL
     OR v_company.status IS DISTINCT FROM 'ativo'
     OR v_company.status_pagamento IS DISTINCT FROM 'pago'
     OR COALESCE(v_company.plano_bloqueado, true)
     OR v_company.vencimento IS NULL THEN
    RAISE EXCEPTION 'An active paid monthly plan is required for renewal';
  END IF;

  SELECT plans.*
  INTO v_plan
  FROM public.planos AS plans
  WHERE plans.id = v_company.plano_id
    AND plans.ativo = true
    AND plans.periodicidade = 'mensal'
    AND plans.valor > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The company plan is not available for monthly renewal';
  END IF;

  v_competence :=
    (v_company.vencimento AT TIME ZONE 'America/Sao_Paulo')::date;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_company.id::text || ':renewal:' || v_competence::text,
      0
    )
  );

  UPDATE public.asaas_payments
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('cancel_reason', 'preparation_timeout')
  WHERE empresa_id = v_company.id
    AND payment_type = 'renewal'
    AND renewal_competence = v_competence
    AND status = 'pending'
    AND asaas_payment_id IS NULL
    AND created_at < v_now - interval '15 minutes';

  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments
    WHERE empresa_id = v_company.id
      AND payment_type = 'renewal'
      AND renewal_competence = v_competence
      AND status IN ('pending', 'confirmed', 'received', 'overdue')
  ) THEN
    RAISE EXCEPTION
      'An active renewal charge already exists for this competence';
  END IF;

  v_plan_amount := round(v_plan.valor, 2);

  -- Keep the two composition queries below on the same entitlement set.
  -- Normal module activation paths also lock the company first; these row
  -- locks additionally protect existing entitlements from direct changes.
  PERFORM 1
  FROM public.empresa_modules AS company_modules
  WHERE company_modules.empresa_id = v_company.id
  FOR UPDATE;

  SELECT
    round(COALESCE(sum(round(company_modules.valor_cobrado, 2)), 0), 2),
    count(*)::integer
  INTO v_modules_amount, v_module_count
  FROM public.empresa_modules AS company_modules
  JOIN public.module_catalog AS catalog
    ON catalog.id = company_modules.module_id
  WHERE company_modules.empresa_id = v_company.id
    AND company_modules.status = 'active'
    AND company_modules.trial_granted = false
    AND company_modules.valor_cobrado > 0
    AND catalog.periodicidade = 'mensal';

  v_total_amount := round(v_plan_amount + v_modules_amount, 2);
  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Catalog price is invalid';
  END IF;

  INSERT INTO public.asaas_payments (
    source_app,
    payment_type,
    empresa_id,
    amount,
    status,
    payment_method,
    due_date,
    related_plano_id,
    renewal_competence,
    metadata
  )
  VALUES (
    'backstage_pro',
    'renewal',
    v_company.id,
    v_total_amount,
    'pending',
    'pix',
    v_due_date,
    v_plan.id,
    v_competence,
    jsonb_build_object(
      'phase', 'preparing',
      'resource_name', v_plan.nome,
      'prepared_by', _actor_id,
      'renewal_competence', v_competence,
      'base_plan_amount', v_plan_amount,
      'modules_amount', v_modules_amount,
      'module_count', v_module_count
    )
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.asaas_renewal_items (
    payment_id,
    item_type,
    related_plano_id,
    amount
  )
  VALUES (
    v_payment.id,
    'base_plan',
    v_plan.id,
    v_plan_amount
  );

  INSERT INTO public.asaas_renewal_items (
    payment_id,
    item_type,
    related_empresa_module_id,
    related_module_id,
    amount
  )
  SELECT
    v_payment.id,
    'module',
    company_modules.id,
    company_modules.module_id,
    round(company_modules.valor_cobrado, 2)
  FROM public.empresa_modules AS company_modules
  JOIN public.module_catalog AS catalog
    ON catalog.id = company_modules.module_id
  WHERE company_modules.empresa_id = v_company.id
    AND company_modules.status = 'active'
    AND company_modules.trial_granted = false
    AND company_modules.valor_cobrado > 0
    AND catalog.periodicidade = 'mensal'
  ORDER BY company_modules.id;

  SELECT
    count(*) FILTER (WHERE item_type = 'module')::integer,
    round(COALESCE(sum(amount), 0), 2)
  INTO v_snapshot_module_count, v_snapshot_total
  FROM public.asaas_renewal_items
  WHERE payment_id = v_payment.id;

  IF v_snapshot_module_count <> v_module_count
     OR v_snapshot_total <> v_total_amount THEN
    RAISE EXCEPTION 'Renewal composition changed while the charge was prepared';
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'payment_type', 'renewal',
    'amount', v_payment.amount,
    'due_date', v_due_date,
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'empresa_email', v_company.email,
    'empresa_documento', v_company.cpf_cnpj,
    'resource_id', v_plan.id,
    'resource_name', v_plan.nome,
    'related_batch_request_id', NULL,
    'related_plano_id', v_plan.id,
    'related_module_id', NULL,
    'renewal_competence', v_competence,
    'base_plan_amount', v_plan_amount,
    'modules_amount', v_modules_amount,
    'module_count', v_module_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_asaas_renewal_charge(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asaas_renewal_charge(uuid)
  TO service_role;

COMMENT ON FUNCTION public.prepare_asaas_renewal_charge(uuid) IS
  'Authorizes and reserves one Asaas renewal per company due-date competence using the server-side plan price plus active, non-trial, monthly module contracted amounts.';

-- Extend the existing transactional webhook without changing its signature.
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
        WHEN 'mensal' THEN v_activation_time + interval '30 days'
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
      v_expiration := v_cycle_start + interval '30 days';

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

REVOKE ALL ON FUNCTION public.process_asaas_payment_webhook(
  text,
  text,
  text,
  numeric,
  text,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_asaas_payment_webhook(
  text,
  text,
  text,
  numeric,
  text,
  timestamptz
) TO service_role;

COMMENT ON FUNCTION public.process_asaas_payment_webhook(
  text,
  text,
  text,
  numeric,
  text,
  timestamptz
) IS
  'Atomically records an Asaas confirmation and activates an initial plan, module purchase, or one monthly renewal. Renewal cycles and module expirations are advanced once only.';
