ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS activation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS activation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'asaas_payments_activation_status_check'
      AND conrelid = 'public.asaas_payments'::regclass
  ) THEN
    ALTER TABLE public.asaas_payments
      ADD CONSTRAINT asaas_payments_activation_status_check
      CHECK (activation_status IN ('pending', 'completed'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (
  id text PRIMARY KEY,
  internal_payment_id uuid NOT NULL
    REFERENCES public.asaas_payments(id) ON DELETE CASCADE,
  asaas_payment_id text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')),
  provider_amount numeric(14, 2) NOT NULL,
  result text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_payment
  ON public.asaas_webhook_events (internal_payment_id);

ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asaas_webhook_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.asaas_webhook_events TO service_role;

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
  v_new_status text;
  v_action text := 'status_updated';
  v_item_count integer := 0;
  v_distinct_item_count integer := 0;
  v_items_total numeric := 0;
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
        v_item_count || ' módulo(s) ativado(s) via pagamento Asaas para '
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
  'Atomically records an Asaas confirmation and activates its purchased benefit.';
