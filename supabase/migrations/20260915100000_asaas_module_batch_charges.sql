-- Multi-module Asaas PIX charges.
--
-- The public Edge Function accepts either the legacy modulo_id or a new
-- modulo_ids array. Both are prepared here as one immutable server-priced
-- module_batch_request and one asaas_payment.

ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS module_set_key text,
  ADD COLUMN IF NOT EXISTS module_item_count integer,
  ADD COLUMN IF NOT EXISTS module_batch_contract_version smallint;

ALTER TABLE public.asaas_payments
  ADD CONSTRAINT asaas_payments_module_batch_contract_check
  CHECK (
    (
      module_batch_contract_version IS NULL
      AND module_set_key IS NULL
      AND module_item_count IS NULL
    ) OR (
      module_batch_contract_version = 1
      AND payment_type = 'modules'
      AND related_batch_request_id IS NOT NULL
      AND module_set_key IS NOT NULL
      AND btrim(module_set_key) <> ''
      AND module_item_count > 0
    )
  );

CREATE UNIQUE INDEX asaas_payments_active_module_set_uidx
  ON public.asaas_payments (empresa_id, module_set_key)
  WHERE payment_type = 'modules'
    AND module_batch_contract_version = 1
    AND status NOT IN ('cancelled', 'refunded');

CREATE UNIQUE INDEX asaas_payments_versioned_module_batch_uidx
  ON public.asaas_payments (related_batch_request_id)
  WHERE payment_type = 'modules'
    AND module_batch_contract_version = 1;

-- Keep the tenant on the payment and the tenant on its batch identical at the
-- constraint level. The historical one-column FK remains in place.
ALTER TABLE public.module_batch_requests
  ADD CONSTRAINT module_batch_requests_id_empresa_key
  UNIQUE (id, empresa_id);

ALTER TABLE public.asaas_payments
  ADD CONSTRAINT asaas_payments_batch_company_fkey
  FOREIGN KEY (related_batch_request_id, empresa_id)
  REFERENCES public.module_batch_requests (id, empresa_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.validate_asaas_module_batch_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.module_batch_requests%ROWTYPE;
  v_item_count integer;
  v_distinct_item_count integer;
  v_items_total numeric;
  v_module_set_key text;
  v_has_contract_fields boolean;
BEGIN
  IF NEW.payment_type <> 'modules' THEN
    IF NEW.module_batch_contract_version IS NOT NULL
       OR NEW.module_set_key IS NOT NULL
       OR NEW.module_item_count IS NOT NULL THEN
      RAISE EXCEPTION 'Module batch contract fields require a module payment';
    END IF;
    RETURN NEW;
  END IF;

  v_has_contract_fields :=
    NEW.module_batch_contract_version IS NOT NULL
    OR NEW.module_set_key IS NOT NULL
    OR NEW.module_item_count IS NOT NULL;

  IF NEW.related_batch_request_id IS NULL THEN
    IF NOT v_has_contract_fields THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Asaas module payment requires a batch request';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.module_batch_requests AS batches
  WHERE batches.id = NEW.related_batch_request_id
  FOR SHARE;

  -- Historical/manual module payment rows are not retrofitted. Every new
  -- Asaas batch (including the legacy modulo_id Edge payload) is versioned.
  IF (NOT FOUND OR v_batch.payment_method IS DISTINCT FROM 'asaas')
     AND NOT v_has_contract_fields THEN
    RETURN NEW;
  END IF;

  IF NOT FOUND
     OR v_batch.empresa_id IS DISTINCT FROM NEW.empresa_id
     OR v_batch.payment_method IS DISTINCT FROM 'asaas'
     OR v_batch.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Asaas module payment batch is invalid for this company';
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT items.module_id)::integer,
    round(COALESCE(sum(items.valor), 0), 2),
    string_agg(items.module_id::text, ',' ORDER BY items.module_id)
  INTO
    v_item_count,
    v_distinct_item_count,
    v_items_total,
    v_module_set_key
  FROM public.module_batch_request_items AS items
  WHERE items.batch_request_id = v_batch.id;

  IF v_item_count = 0
     OR v_item_count <> v_distinct_item_count
     OR v_items_total <= 0
     OR v_items_total <> round(v_batch.valor_total, 2)
     OR v_items_total <> round(NEW.amount, 2) THEN
    RAISE EXCEPTION 'Asaas module batch items do not match the payment';
  END IF;

  IF NEW.related_module_id IS NOT NULL AND (
    v_item_count <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.module_batch_request_items AS items
      WHERE items.batch_request_id = v_batch.id
        AND items.module_id = NEW.related_module_id
    )
  ) THEN
    RAISE EXCEPTION 'Single-module reference does not match its batch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS existing_payment
    JOIN public.module_batch_request_items AS existing_item
      ON existing_item.batch_request_id = existing_payment.related_batch_request_id
    JOIN public.module_batch_request_items AS requested_item
      ON requested_item.batch_request_id = v_batch.id
     AND requested_item.module_id = existing_item.module_id
    WHERE existing_payment.empresa_id = NEW.empresa_id
      AND existing_payment.payment_type = 'modules'
      AND existing_payment.status IN ('pending', 'confirmed', 'received', 'overdue')
      AND existing_payment.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'An active Asaas charge already contains a requested module';
  END IF;

  NEW.module_item_count := v_item_count;
  NEW.module_set_key := v_module_set_key;
  NEW.module_batch_contract_version := 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_asaas_module_batch_payment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_asaas_module_batch_payment_trigger
BEFORE INSERT OR UPDATE OF
  payment_type,
  related_batch_request_id,
  related_module_id,
  empresa_id,
  amount
ON public.asaas_payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_asaas_module_batch_payment();

CREATE OR REPLACE FUNCTION public.protect_asaas_module_payment_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.module_batch_contract_version IS NULL AND (
    NEW.module_batch_contract_version IS NOT NULL
    OR NEW.module_set_key IS NOT NULL
    OR NEW.module_item_count IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Asaas module payment batch contract is server-managed';
  ELSIF OLD.module_batch_contract_version IS NOT NULL AND (
    NEW.module_batch_contract_version IS DISTINCT FROM OLD.module_batch_contract_version
    OR NEW.module_set_key IS DISTINCT FROM OLD.module_set_key
    OR NEW.module_item_count IS DISTINCT FROM OLD.module_item_count
  ) THEN
    RAISE EXCEPTION 'Asaas module payment batch contract is immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_asaas_module_payment_contract()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_asaas_module_payment_contract_trigger
BEFORE UPDATE OF
  module_batch_contract_version,
  module_set_key,
  module_item_count
ON public.asaas_payments
FOR EACH ROW
EXECUTE FUNCTION public.protect_asaas_module_payment_contract();

-- Once a versioned Asaas payment reserves a batch, the tenant-facing legacy
-- RLS policies must not allow its item set or financial identity to change.
CREATE OR REPLACE FUNCTION public.protect_asaas_module_batch_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_batch_id uuid;
  v_new_batch_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_batch_id := NEW.batch_request_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_batch_id := OLD.batch_request_id;
  ELSE
    v_old_batch_id := OLD.batch_request_id;
    v_new_batch_id := NEW.batch_request_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payments
    WHERE payments.related_batch_request_id IN (
      v_old_batch_id,
      v_new_batch_id
    )
      AND payments.payment_type = 'modules'
      AND payments.module_batch_contract_version = 1
      AND payments.status IN ('pending', 'confirmed', 'received', 'overdue')
      AND EXISTS (
        SELECT 1
        FROM public.empresas AS companies
        WHERE companies.id = payments.empresa_id
      )
  ) THEN
    RAISE EXCEPTION 'Asaas module batch items are immutable while payment is active';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_asaas_module_batch_items()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_asaas_module_batch_items_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.module_batch_request_items
FOR EACH ROW
EXECUTE FUNCTION public.protect_asaas_module_batch_items();

CREATE OR REPLACE FUNCTION public.protect_asaas_module_batch_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payments
    WHERE payments.related_batch_request_id = OLD.id
      AND payments.payment_type = 'modules'
      AND payments.module_batch_contract_version = 1
      AND payments.status IN ('pending', 'confirmed', 'received', 'overdue')
      AND EXISTS (
        SELECT 1
        FROM public.empresas AS companies
        WHERE companies.id = payments.empresa_id
      )
  ) THEN
    RAISE EXCEPTION 'Asaas module batch financial identity is immutable while payment is active';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_asaas_module_batch_contract()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_asaas_module_batch_contract_trigger
BEFORE UPDATE OF empresa_id, valor_total, payment_method
OR DELETE ON public.module_batch_requests
FOR EACH ROW
EXECUTE FUNCTION public.protect_asaas_module_batch_contract();

-- The transactional webhook writes empresa_modules one item at a time. This
-- guard validates the complete frozen batch before the first entitlement can
-- become active; any failure aborts the same webhook transaction.
CREATE OR REPLACE FUNCTION public.validate_asaas_module_batch_before_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.asaas_payments%ROWTYPE;
  v_batch public.module_batch_requests%ROWTYPE;
  v_item_count integer;
  v_distinct_item_count integer;
  v_items_total numeric;
  v_module_set_key text;
BEGIN
  IF NEW.status <> 'active'
     OR NEW.origem <> 'asaas_pagamento' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT payments.*
  INTO v_payment
  FROM public.asaas_payments AS payments
  JOIN public.module_batch_request_items AS triggering_item
    ON triggering_item.batch_request_id = payments.related_batch_request_id
   AND triggering_item.module_id = NEW.module_id
  WHERE payments.empresa_id = NEW.empresa_id
    AND payments.payment_type = 'modules'
    AND payments.module_batch_contract_version = 1
    AND payments.activation_status <> 'completed'
    AND payments.status IN ('pending', 'confirmed', 'received', 'overdue')
  ORDER BY payments.created_at DESC
  LIMIT 1
  FOR UPDATE OF payments;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.module_batch_requests AS batches
  WHERE batches.id = v_payment.related_batch_request_id
    AND batches.empresa_id = v_payment.empresa_id
    AND batches.payment_method = 'asaas'
    AND batches.status = 'pending'
  FOR SHARE;

  SELECT
    count(*)::integer,
    count(DISTINCT items.module_id)::integer,
    round(COALESCE(sum(items.valor), 0), 2),
    string_agg(items.module_id::text, ',' ORDER BY items.module_id)
  INTO
    v_item_count,
    v_distinct_item_count,
    v_items_total,
    v_module_set_key
  FROM public.module_batch_request_items AS items
  WHERE items.batch_request_id = v_payment.related_batch_request_id;

  IF v_batch.id IS NULL
     OR v_item_count <> v_payment.module_item_count
     OR v_item_count <> v_distinct_item_count
     OR v_items_total <> round(v_payment.amount, 2)
     OR v_items_total <> round(v_batch.valor_total, 2)
     OR v_module_set_key IS DISTINCT FROM v_payment.module_set_key
     OR EXISTS (
       SELECT 1
       FROM public.module_batch_request_items AS items
       LEFT JOIN public.module_catalog AS catalog
         ON catalog.id = items.module_id
       WHERE items.batch_request_id = v_batch.id
         AND COALESCE(catalog.ativo, false) = false
     ) THEN
    RAISE EXCEPTION 'Asaas module batch activation is incomplete or inconsistent';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_asaas_module_batch_before_activation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_asaas_module_batch_before_activation_trigger
BEFORE INSERT OR UPDATE OF status, origem
ON public.empresa_modules
FOR EACH ROW
EXECUTE FUNCTION public.validate_asaas_module_batch_before_activation();

-- Final guard for the existing transactional webhook: quantity/value are
-- checked by process_asaas_payment_webhook before activation; this trigger
-- only allows activation_status=completed when every frozen item is active
-- for the same company with the company's current expiration.
CREATE OR REPLACE FUNCTION public.validate_asaas_module_batch_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.module_batch_requests%ROWTYPE;
  v_company public.empresas%ROWTYPE;
  v_item_count integer;
  v_distinct_item_count integer;
  v_items_total numeric;
  v_module_set_key text;
BEGIN
  IF OLD.activation_status = 'completed'
     OR NEW.activation_status <> 'completed'
     OR NEW.payment_type <> 'modules'
     OR NEW.module_batch_contract_version IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.module_batch_requests AS batches
  WHERE batches.id = NEW.related_batch_request_id
    AND batches.empresa_id = NEW.empresa_id;

  SELECT companies.*
  INTO v_company
  FROM public.empresas AS companies
  WHERE companies.id = NEW.empresa_id;

  IF v_batch.id IS NULL
     OR v_company.id IS NULL
     OR v_batch.status <> 'approved'
     OR v_batch.payment_method <> 'asaas' THEN
    RAISE EXCEPTION 'Asaas module batch was not atomically approved';
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT items.module_id)::integer,
    round(COALESCE(sum(items.valor), 0), 2),
    string_agg(items.module_id::text, ',' ORDER BY items.module_id)
  INTO
    v_item_count,
    v_distinct_item_count,
    v_items_total,
    v_module_set_key
  FROM public.module_batch_request_items AS items
  WHERE items.batch_request_id = v_batch.id;

  IF v_item_count <> NEW.module_item_count
     OR v_item_count <> v_distinct_item_count
     OR v_items_total <> round(NEW.amount, 2)
     OR v_items_total <> round(v_batch.valor_total, 2)
     OR v_module_set_key IS DISTINCT FROM NEW.module_set_key
     OR EXISTS (
       SELECT 1
       FROM public.module_batch_request_items AS items
       JOIN public.module_catalog AS catalog
         ON catalog.id = items.module_id
       WHERE items.batch_request_id = v_batch.id
         AND (
           catalog.ativo = false
           OR NOT EXISTS (
             SELECT 1
             FROM public.empresa_modules AS company_modules
             WHERE company_modules.empresa_id = NEW.empresa_id
               AND company_modules.module_id = items.module_id
               AND company_modules.status = 'active'
               AND company_modules.origem = 'asaas_pagamento'
               AND company_modules.granted_by_admin = false
               AND company_modules.trial_granted = false
               AND round(company_modules.valor_cobrado, 2) = round(items.valor, 2)
               AND company_modules.expires_at IS NOT DISTINCT FROM v_company.vencimento
           )
         )
     ) THEN
    RAISE EXCEPTION 'Asaas module batch activation is incomplete or inconsistent';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_asaas_module_batch_completion()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_asaas_module_batch_completion_trigger
BEFORE UPDATE OF activation_status ON public.asaas_payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_asaas_module_batch_completion();

CREATE OR REPLACE FUNCTION public.prepare_asaas_module_batch_charge(
  _actor_id uuid,
  _module_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.empresas%ROWTYPE;
  v_payment public.asaas_payments%ROWTYPE;
  v_batch_id uuid;
  v_module_ids uuid[];
  v_module_id uuid;
  v_module_count integer;
  v_catalog_count integer;
  v_total numeric(14, 2);
  v_due_date date := (clock_timestamp() + interval '3 days')::date;
  v_now timestamptz := clock_timestamp();
  v_module_set_key text;
  v_missing_dependencies text;
  v_resource_name text;
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

  v_module_count := COALESCE(cardinality(_module_ids), 0);
  IF v_module_count = 0 OR v_module_count > 50 THEN
    RAISE EXCEPTION 'Select between 1 and 50 modules for billing';
  END IF;

  IF array_position(_module_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Module identifiers cannot be null';
  END IF;

  SELECT
    array_agg(requested.module_id ORDER BY requested.module_id),
    count(DISTINCT requested.module_id)::integer,
    string_agg(requested.module_id::text, ',' ORDER BY requested.module_id)
  INTO v_module_ids, v_catalog_count, v_module_set_key
  FROM unnest(_module_ids) AS requested(module_id);

  IF v_catalog_count <> v_module_count THEN
    RAISE EXCEPTION 'Module identifiers cannot be duplicated';
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
     OR (
       v_company.vencimento IS NOT NULL
       AND v_company.vencimento < statement_timestamp()
     ) THEN
    RAISE EXCEPTION 'An active paid plan is required to purchase modules';
  END IF;

  FOREACH v_module_id IN ARRAY v_module_ids LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_company.id::text || ':module:' || v_module_id::text,
        0
      )
    );
  END LOOP;

  SELECT
    count(*)::integer,
    round(COALESCE(sum(round(catalog.valor, 2)), 0), 2)
  INTO v_catalog_count, v_total
  FROM public.module_catalog AS catalog
  WHERE catalog.id = ANY(v_module_ids)
    AND catalog.ativo = true
    AND catalog.valor > 0;

  IF v_catalog_count <> v_module_count OR v_total <= 0 THEN
    RAISE EXCEPTION 'A requested module is not available for billing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.empresa_modules AS company_modules
    WHERE company_modules.empresa_id = v_company.id
      AND company_modules.module_id = ANY(v_module_ids)
      AND company_modules.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'A requested module is already active or pending for this company';
  END IF;

  WITH RECURSIVE required(module_id) AS (
    SELECT dependencies.required_module_id
    FROM public.module_dependencies AS dependencies
    WHERE dependencies.module_id = ANY(v_module_ids)

    UNION

    SELECT dependencies.required_module_id
    FROM public.module_dependencies AS dependencies
    JOIN required ON required.module_id = dependencies.module_id
  )
  SELECT string_agg(DISTINCT catalog.nome, ', ' ORDER BY catalog.nome)
  INTO v_missing_dependencies
  FROM required
  JOIN public.module_catalog AS catalog ON catalog.id = required.module_id
  WHERE NOT (required.module_id = ANY(v_module_ids))
    AND (
      catalog.ativo = false
      OR NOT EXISTS (
        SELECT 1
        FROM public.empresa_modules AS company_modules
        WHERE company_modules.empresa_id = v_company.id
          AND company_modules.module_id = required.module_id
          AND company_modules.status = 'active'
          AND (
            company_modules.expires_at IS NULL
            OR company_modules.expires_at >= statement_timestamp()
          )
      )
    );

  IF v_missing_dependencies IS NOT NULL THEN
    RAISE EXCEPTION 'Missing active or selected module dependencies: %',
      v_missing_dependencies;
  END IF;

  UPDATE public.module_batch_requests
  SET status = 'cancelled'
  WHERE id IN (
    SELECT DISTINCT stale_payment.related_batch_request_id
    FROM public.asaas_payments AS stale_payment
    JOIN public.module_batch_request_items AS stale_item
      ON stale_item.batch_request_id = stale_payment.related_batch_request_id
    WHERE stale_payment.empresa_id = v_company.id
      AND stale_payment.payment_type = 'modules'
      AND stale_payment.status = 'pending'
      AND stale_payment.asaas_payment_id IS NULL
      AND stale_payment.created_at < v_now - interval '15 minutes'
      AND stale_item.module_id = ANY(v_module_ids)
      AND stale_payment.related_batch_request_id IS NOT NULL
  );

  UPDATE public.asaas_payments AS stale_payment
  SET status = 'cancelled',
      metadata = COALESCE(stale_payment.metadata, '{}'::jsonb)
        || jsonb_build_object('cancel_reason', 'preparation_timeout')
  WHERE stale_payment.empresa_id = v_company.id
    AND stale_payment.payment_type = 'modules'
    AND stale_payment.status = 'pending'
    AND stale_payment.asaas_payment_id IS NULL
    AND stale_payment.created_at < v_now - interval '15 minutes'
    AND EXISTS (
      SELECT 1
      FROM public.module_batch_request_items AS stale_item
      WHERE stale_item.batch_request_id = stale_payment.related_batch_request_id
        AND stale_item.module_id = ANY(v_module_ids)
    );

  IF EXISTS (
    SELECT 1
    FROM unnest(v_module_ids) AS requested(module_id)
    WHERE EXISTS (
      SELECT 1
      FROM public.empresa_modules AS company_modules
      WHERE company_modules.empresa_id = v_company.id
        AND company_modules.module_id = requested.module_id
        AND company_modules.status = 'pending'
    ) OR EXISTS (
      SELECT 1
      FROM public.module_requests AS requests
      WHERE requests.empresa_id = v_company.id
        AND requests.module_id = requested.module_id
        AND requests.status = 'pending'
    ) OR EXISTS (
      SELECT 1
      FROM public.module_payments AS payments
      WHERE payments.empresa_id = v_company.id
        AND payments.module_id = requested.module_id
        AND payments.status IN ('pending', 'paid')
    ) OR EXISTS (
      SELECT 1
      FROM public.module_batch_requests AS batches
      JOIN public.module_batch_request_items AS items
        ON items.batch_request_id = batches.id
      WHERE batches.empresa_id = v_company.id
        AND batches.status IN ('pending', 'paid')
        AND items.module_id = requested.module_id
    )
  ) THEN
    RAISE EXCEPTION 'A requested module already has an operation in progress';
  END IF;

  INSERT INTO public.module_batch_requests (
    empresa_id,
    valor_total,
    status,
    payment_method,
    observacao
  )
  VALUES (
    v_company.id,
    v_total,
    'pending',
    'asaas',
    'Server-created Asaas module batch charge'
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.module_batch_request_items (
    batch_request_id,
    module_id,
    valor
  )
  SELECT
    v_batch_id,
    catalog.id,
    round(catalog.valor, 2)
  FROM public.module_catalog AS catalog
  WHERE catalog.id = ANY(v_module_ids)
  ORDER BY catalog.ordem, catalog.id;

  v_resource_name := CASE
    WHEN v_module_count = 1 THEN (
      SELECT catalog.nome
      FROM public.module_catalog AS catalog
      WHERE catalog.id = v_module_ids[1]
    )
    ELSE v_module_count::text || ' modulos adicionais'
  END;

  INSERT INTO public.asaas_payments (
    source_app,
    payment_type,
    empresa_id,
    amount,
    status,
    payment_method,
    due_date,
    related_batch_request_id,
    related_module_id,
    metadata
  )
  VALUES (
    'backstage_pro',
    'modules',
    v_company.id,
    v_total,
    'pending',
    'pix',
    v_due_date,
    v_batch_id,
    CASE WHEN v_module_count = 1 THEN v_module_ids[1] ELSE NULL END,
    jsonb_build_object(
      'phase', 'preparing',
      'resource_name', v_resource_name,
      'prepared_by', _actor_id,
      'module_ids', to_jsonb(v_module_ids),
      'module_count', v_module_count,
      'module_set_key', v_module_set_key
    )
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'payment_type', 'modules',
    'amount', v_payment.amount,
    'due_date', v_due_date,
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'empresa_email', v_company.email,
    'empresa_documento', v_company.cpf_cnpj,
    'resource_id', CASE
      WHEN v_module_count = 1 THEN v_module_ids[1]
      ELSE v_batch_id
    END,
    'resource_name', v_resource_name,
    'related_batch_request_id', v_batch_id,
    'related_plano_id', NULL,
    'related_module_id', CASE
      WHEN v_module_count = 1 THEN v_module_ids[1]
      ELSE NULL
    END,
    'module_ids', to_jsonb(v_module_ids),
    'module_count', v_module_count,
    'module_set_key', v_payment.module_set_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_asaas_module_batch_charge(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asaas_module_batch_charge(uuid, uuid[])
  TO service_role;

COMMENT ON FUNCTION public.prepare_asaas_module_batch_charge(uuid, uuid[]) IS
  'Validates, prices, dependency-checks and atomically reserves one Asaas PIX payment for one canonical set of modules belonging to the caller company.';
