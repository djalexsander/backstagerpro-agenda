ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS related_module_id uuid
  REFERENCES public.module_catalog(id);

CREATE INDEX IF NOT EXISTS idx_asaas_payments_related_module
  ON public.asaas_payments (related_module_id);

-- Browser clients may read their own charges, but only trusted server flows
-- may create or mutate the financial record consumed by the webhook.
DROP POLICY IF EXISTS "Admin empresa manage own asaas payments"
  ON public.asaas_payments;

CREATE OR REPLACE FUNCTION public.prepare_asaas_charge(
  _actor_id uuid,
  _plan_id uuid DEFAULT NULL,
  _module_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_module public.module_catalog%ROWTYPE;
  v_payment public.asaas_payments%ROWTYPE;
  v_batch_id uuid;
  v_now timestamptz := clock_timestamp();
  v_due_date date := (clock_timestamp() + interval '3 days')::date;
  v_price numeric;
  v_name text;
  v_type text;
BEGIN
  IF (_plan_id IS NULL) = (_module_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one plan or module identifier is required';
  END IF;

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

  IF _plan_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_company.id::text || ':plan:' || _plan_id::text, 0)
    );

    SELECT planos.*
    INTO v_plan
    FROM public.planos AS planos
    WHERE planos.id = _plan_id
      AND planos.ativo = true
      AND planos.valor > 0;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plan is not available for billing';
    END IF;

    IF v_company.plano_id IS DISTINCT FROM v_plan.id
       OR v_company.status_pagamento IS DISTINCT FROM 'aguardando_pagamento' THEN
      RAISE EXCEPTION 'Plan was not selected by the company billing flow';
    END IF;

    UPDATE public.asaas_payments
    SET status = 'cancelled',
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('cancel_reason', 'preparation_timeout')
    WHERE empresa_id = v_company.id
      AND related_plano_id = v_plan.id
      AND status = 'pending'
      AND asaas_payment_id IS NULL
      AND created_at < v_now - interval '15 minutes';

    IF EXISTS (
      SELECT 1
      FROM public.asaas_payments
      WHERE empresa_id = v_company.id
        AND related_plano_id = v_plan.id
        AND status IN ('pending', 'confirmed', 'received')
    ) THEN
      RAISE EXCEPTION 'An active charge already exists for this plan';
    END IF;

    v_price := v_plan.valor;
    v_name := v_plan.nome;
    v_type := 'base_plan';
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_company.id::text || ':module:' || _module_id::text, 0)
    );

    IF v_company.plano_id IS NULL
       OR v_company.status_pagamento IS DISTINCT FROM 'pago'
       OR COALESCE(v_company.plano_bloqueado, true) THEN
      RAISE EXCEPTION 'An active paid plan is required to purchase modules';
    END IF;

    SELECT modules.*
    INTO v_module
    FROM public.module_catalog AS modules
    WHERE modules.id = _module_id
      AND modules.ativo = true
      AND modules.valor > 0;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Module is not available for billing';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.empresa_modules
      WHERE empresa_id = v_company.id
        AND module_id = v_module.id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Module is already active for this company';
    END IF;

    UPDATE public.module_batch_requests
    SET status = 'cancelled'
    WHERE id IN (
      SELECT related_batch_request_id
      FROM public.asaas_payments
      WHERE empresa_id = v_company.id
        AND related_module_id = v_module.id
        AND status = 'pending'
        AND asaas_payment_id IS NULL
        AND created_at < v_now - interval '15 minutes'
        AND related_batch_request_id IS NOT NULL
    );

    UPDATE public.asaas_payments
    SET status = 'cancelled',
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('cancel_reason', 'preparation_timeout')
    WHERE empresa_id = v_company.id
      AND related_module_id = v_module.id
      AND status = 'pending'
      AND asaas_payment_id IS NULL
      AND created_at < v_now - interval '15 minutes';

    IF EXISTS (
      SELECT 1
      FROM public.asaas_payments
      WHERE empresa_id = v_company.id
        AND related_module_id = v_module.id
        AND status IN ('pending', 'confirmed', 'received')
    ) THEN
      RAISE EXCEPTION 'An active charge already exists for this module';
    END IF;

    v_price := v_module.valor;
    v_name := v_module.nome;
    v_type := 'modules';

    INSERT INTO public.module_batch_requests (
      empresa_id,
      valor_total,
      status,
      payment_method,
      observacao
    )
    VALUES (
      v_company.id,
      v_price,
      'pending',
      'asaas',
      'Cobrança Asaas criada pelo servidor'
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO public.module_batch_request_items (
      batch_request_id,
      module_id,
      valor
    )
    VALUES (v_batch_id, v_module.id, v_price);
  END IF;

  IF v_price IS NULL OR v_price <= 0 THEN
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
    related_batch_request_id,
    related_plano_id,
    related_module_id,
    metadata
  )
  VALUES (
    'backstage_pro',
    v_type,
    v_company.id,
    round(v_price, 2),
    'pending',
    'pix',
    v_due_date,
    v_batch_id,
    _plan_id,
    _module_id,
    jsonb_build_object(
      'phase', 'preparing',
      'resource_name', v_name,
      'prepared_by', _actor_id
    )
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'payment_type', v_type,
    'amount', v_payment.amount,
    'due_date', v_due_date,
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'empresa_email', v_company.email,
    'resource_id', COALESCE(_plan_id, _module_id),
    'resource_name', v_name,
    'related_batch_request_id', v_batch_id,
    'related_plano_id', _plan_id,
    'related_module_id', _module_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_asaas_charge(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asaas_charge(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.prepare_asaas_charge(uuid, uuid, uuid) IS
  'Authorizes and reserves an Asaas charge using only server-side catalog prices.';

CREATE OR REPLACE FUNCTION public.protect_asaas_module_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_trusted boolean :=
    current_user IN ('postgres', 'supabase_admin', 'service_role')
    OR current_setting('request.jwt.claim.role', true) = 'service_role';
  v_is_master boolean :=
    auth.uid() IS NOT NULL AND public.is_master_admin(auth.uid());
  v_is_asaas boolean := false;
BEGIN
  IF v_is_trusted OR v_is_master THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'module_batch_requests' THEN
    IF TG_OP = 'INSERT' THEN
      v_is_asaas := NEW.payment_method = 'asaas';
    ELSIF TG_OP = 'DELETE' THEN
      v_is_asaas := OLD.payment_method = 'asaas';
    ELSE
      v_is_asaas :=
        OLD.payment_method = 'asaas' OR NEW.payment_method = 'asaas';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.module_batch_requests
        WHERE id = NEW.batch_request_id
          AND payment_method = 'asaas'
      )
      INTO v_is_asaas;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.module_batch_requests
        WHERE id = OLD.batch_request_id
          AND payment_method = 'asaas'
      )
      INTO v_is_asaas;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.module_batch_requests
        WHERE id IN (OLD.batch_request_id, NEW.batch_request_id)
          AND payment_method = 'asaas'
      )
      INTO v_is_asaas;
    END IF;
  END IF;

  IF v_is_asaas THEN
    RAISE EXCEPTION 'Asaas module batches can only be changed by a trusted server flow';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_asaas_module_batch_request
  ON public.module_batch_requests;
CREATE TRIGGER protect_asaas_module_batch_request
BEFORE INSERT OR UPDATE OR DELETE ON public.module_batch_requests
FOR EACH ROW EXECUTE FUNCTION public.protect_asaas_module_batch();

DROP TRIGGER IF EXISTS protect_asaas_module_batch_item
  ON public.module_batch_request_items;
CREATE TRIGGER protect_asaas_module_batch_item
BEFORE INSERT OR UPDATE OR DELETE ON public.module_batch_request_items
FOR EACH ROW EXECUTE FUNCTION public.protect_asaas_module_batch();
