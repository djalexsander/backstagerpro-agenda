-- P1-2: canonical module dependencies must hold across self-service, Master
-- approvals, batch approvals and direct entitlement writes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.module_batch_request_items
    GROUP BY batch_request_id, module_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce unique module batch items: duplicate (batch_request_id, module_id) rows exist'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX module_batch_request_items_batch_module_uidx
  ON public.module_batch_request_items (batch_request_id, module_id);

CREATE OR REPLACE FUNCTION public.validate_inserted_module_batch_dependencies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_missing text;
BEGIN
  WITH RECURSIVE touched_batches AS (
    SELECT DISTINCT batch.id, batch.empresa_id
    FROM inserted_module_batch_items AS inserted
    JOIN public.module_batch_requests AS batch
      ON batch.id = inserted.batch_request_id
  ), required(batch_id, empresa_id, module_id) AS (
    SELECT touched.id, touched.empresa_id, dependency.required_module_id
    FROM touched_batches AS touched
    JOIN public.module_batch_request_items AS item
      ON item.batch_request_id = touched.id
    JOIN public.module_dependencies AS dependency
      ON dependency.module_id = item.module_id
    UNION
    SELECT required.batch_id, required.empresa_id, dependency.required_module_id
    FROM required
    JOIN public.module_dependencies AS dependency
      ON dependency.module_id = required.module_id
  ), missing AS (
    SELECT required.batch_id, required.module_id
    FROM required
    WHERE NOT public.company_has_lifetime_subscription(required.empresa_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.empresa_modules AS entitlement
        WHERE entitlement.empresa_id = required.empresa_id
          AND entitlement.module_id = required.module_id
          AND entitlement.status = 'active'
          AND (entitlement.expires_at IS NULL OR entitlement.expires_at >= statement_timestamp())
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.module_batch_request_items AS included
        WHERE included.batch_request_id = required.batch_id
          AND included.module_id = required.module_id
      )
  )
  SELECT string_agg(DISTINCT catalog.nome, ', ' ORDER BY catalog.nome)
  INTO v_missing
  FROM missing
  JOIN public.module_catalog AS catalog ON catalog.id = missing.module_id;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Module batch is missing required dependencies: %', v_missing;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS validate_inserted_module_batch_dependencies_trigger
  ON public.module_batch_request_items;
CREATE TRIGGER validate_inserted_module_batch_dependencies_trigger
AFTER INSERT ON public.module_batch_request_items
REFERENCING NEW TABLE AS inserted_module_batch_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.validate_inserted_module_batch_dependencies();

CREATE OR REPLACE FUNCTION public.prevent_duplicate_company_module()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.empresa_id::text || ':module:' || NEW.module_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.empresa_modules AS existing
    WHERE existing.empresa_id = NEW.empresa_id
      AND existing.module_id = NEW.module_id
  ) THEN
    RAISE EXCEPTION 'Company module entitlement already exists'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_company_module_trigger
  ON public.empresa_modules;
CREATE TRIGGER prevent_duplicate_company_module_trigger
BEFORE INSERT ON public.empresa_modules
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_company_module();

-- A deferred constraint validates the committed state, allowing a single
-- transaction (including the Asaas webhook) to activate a dependency set in
-- any item order while still rolling back a direct/incomplete bypass.
DROP TRIGGER IF EXISTS enforce_company_module_dependencies
  ON public.empresa_modules;
CREATE CONSTRAINT TRIGGER enforce_company_module_dependencies
AFTER INSERT OR UPDATE OR DELETE ON public.empresa_modules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_company_module_dependencies();

CREATE OR REPLACE FUNCTION public.activate_company_modules_checked(
  _empresa_id uuid,
  _module_ids uuid[],
  _prices jsonb,
  _origem text,
  _expires_at timestamptz,
  _granted_by_admin boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_remaining uuid[];
  v_snapshot uuid[];
  v_module_id uuid;
  v_catalog public.module_catalog%ROWTYPE;
  v_existing_ids uuid[];
  v_existing_id uuid;
  v_progress boolean;
  v_activated integer := 0;
  v_missing text;
BEGIN
  IF _empresa_id IS NULL OR COALESCE(cardinality(_module_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Company and at least one module are required';
  END IF;

  SELECT array_agg(DISTINCT requested.module_id)
  INTO v_remaining
  FROM unnest(_module_ids) AS requested(module_id)
  WHERE requested.module_id IS NOT NULL;

  FOREACH v_module_id IN ARRAY v_remaining LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.module_catalog
      WHERE id = v_module_id AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Module % is unavailable', v_module_id;
    END IF;
  END LOOP;

  WHILE cardinality(v_remaining) > 0 LOOP
    v_progress := false;
    v_snapshot := v_remaining;

    FOREACH v_module_id IN ARRAY v_snapshot LOOP
      IF public.company_module_dependencies_satisfied(_empresa_id, v_module_id) THEN
        SELECT catalog.* INTO v_catalog
        FROM public.module_catalog AS catalog
        WHERE catalog.id = v_module_id;

        PERFORM 1
        FROM public.empresa_modules
        WHERE empresa_id = _empresa_id AND module_id = v_module_id
        FOR UPDATE;

        SELECT array_agg(entitlement.id ORDER BY entitlement.created_at, entitlement.id)
        INTO v_existing_ids
        FROM public.empresa_modules AS entitlement
        WHERE entitlement.empresa_id = _empresa_id
          AND entitlement.module_id = v_module_id;

        IF COALESCE(cardinality(v_existing_ids), 0) > 1 THEN
          RAISE EXCEPTION
            'Duplicate empresa_modules rows exist for company % and module %',
            _empresa_id, v_module_id;
        END IF;

        v_existing_id := v_existing_ids[1];
        IF v_existing_id IS NULL THEN
          INSERT INTO public.empresa_modules (
            empresa_id, module_id, status, activated_at, expires_at,
            granted_by_admin, valor_cobrado, origem, trial_granted
          ) VALUES (
            _empresa_id, v_module_id, 'active', clock_timestamp(), _expires_at,
            _granted_by_admin,
            COALESCE(NULLIF(_prices ->> v_module_id::text, '')::numeric, v_catalog.valor, 0),
            _origem, false
          );
          v_activated := v_activated + 1;
        ELSIF NOT EXISTS (
          SELECT 1 FROM public.empresa_modules
          WHERE id = v_existing_id
            AND status = 'active'
            AND (expires_at IS NULL OR expires_at >= statement_timestamp())
        ) THEN
          UPDATE public.empresa_modules
          SET status = 'active',
              activated_at = clock_timestamp(),
              expires_at = _expires_at,
              granted_by_admin = _granted_by_admin,
              valor_cobrado = COALESCE(
                NULLIF(_prices ->> v_module_id::text, '')::numeric,
                v_catalog.valor,
                0
              ),
              origem = _origem,
              trial_granted = false
          WHERE id = v_existing_id;
          v_activated := v_activated + 1;
        END IF;

        v_remaining := array_remove(v_remaining, v_module_id);
        v_progress := true;
      END IF;
    END LOOP;

    IF NOT v_progress THEN
      WITH RECURSIVE required(module_id) AS (
        SELECT dependency.required_module_id
        FROM unnest(v_remaining) AS pending(module_id)
        JOIN public.module_dependencies AS dependency
          ON dependency.module_id = pending.module_id
        UNION
        SELECT dependency.required_module_id
        FROM public.module_dependencies AS dependency
        JOIN required ON required.module_id = dependency.module_id
      )
      SELECT string_agg(DISTINCT catalog.nome, ', ' ORDER BY catalog.nome)
      INTO v_missing
      FROM required
      JOIN public.module_catalog AS catalog ON catalog.id = required.module_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.empresa_modules AS entitlement
        WHERE entitlement.empresa_id = _empresa_id
          AND entitlement.module_id = required.module_id
          AND entitlement.status = 'active'
          AND (entitlement.expires_at IS NULL OR entitlement.expires_at >= statement_timestamp())
      );

      RAISE EXCEPTION 'Missing active module dependencies: %', COALESCE(v_missing, 'dependency cycle');
    END IF;
  END LOOP;

  RETURN v_activated;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_company_module_batch(
  _module_ids uuid[],
  _observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_empresa_id uuid := public.get_user_empresa_id(auth.uid());
  v_batch_id uuid;
  v_module_ids uuid[];
  v_total numeric;
BEGIN
  IF v_actor_id IS NULL
     OR NOT public.has_role(v_actor_id, 'admin_empresa'::public.app_role)
     OR v_empresa_id IS NULL
     OR NOT public.can_write_company_data(v_empresa_id) THEN
    RAISE EXCEPTION 'Only an active company administrator can request modules'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(_module_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one module';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(_module_ids) AS requested(module_id)
    LEFT JOIN public.module_catalog AS catalog
      ON catalog.id = requested.module_id AND catalog.ativo = true
    WHERE requested.module_id IS NULL OR catalog.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A requested module is unavailable';
  END IF;

  WITH RECURSIVE requested(module_id) AS (
    SELECT DISTINCT module_id FROM unnest(_module_ids) AS input(module_id)
    WHERE module_id IS NOT NULL
    UNION
    SELECT dependency.required_module_id
    FROM public.module_dependencies AS dependency
    JOIN requested ON requested.module_id = dependency.module_id
  ), missing AS (
    SELECT requested.module_id
    FROM requested
    JOIN public.module_catalog AS catalog
      ON catalog.id = requested.module_id AND catalog.ativo = true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.empresa_modules AS entitlement
      WHERE entitlement.empresa_id = v_empresa_id
        AND entitlement.module_id = requested.module_id
        AND entitlement.status = 'active'
        AND (entitlement.expires_at IS NULL OR entitlement.expires_at >= statement_timestamp())
    )
  )
  SELECT array_agg(module_id) INTO v_module_ids FROM missing;

  IF COALESCE(cardinality(v_module_ids), 0) = 0 THEN
    RAISE EXCEPTION 'All requested modules are already active';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_module_ids) AS requested(module_id)
    WHERE EXISTS (
      SELECT 1 FROM public.empresa_modules AS entitlement
      WHERE entitlement.empresa_id = v_empresa_id
        AND entitlement.module_id = requested.module_id
        AND entitlement.status = 'pending'
    ) OR EXISTS (
      SELECT 1 FROM public.module_batch_request_items AS item
      JOIN public.module_batch_requests AS batch ON batch.id = item.batch_request_id
      WHERE batch.empresa_id = v_empresa_id
        AND batch.status IN ('pending', 'paid')
        AND item.module_id = requested.module_id
    ) OR EXISTS (
      SELECT 1 FROM public.module_requests AS request
      WHERE request.empresa_id = v_empresa_id
        AND request.module_id = requested.module_id
        AND request.status = 'pending'
    ) OR EXISTS (
      SELECT 1 FROM public.module_payments AS payment
      WHERE payment.empresa_id = v_empresa_id
        AND payment.module_id = requested.module_id
        AND payment.status IN ('pending', 'paid')
    )
  ) THEN
    RAISE EXCEPTION 'A requested module or dependency already has an operation in progress';
  END IF;

  SELECT round(sum(catalog.valor), 2)
  INTO v_total
  FROM public.module_catalog AS catalog
  WHERE catalog.id = ANY(v_module_ids);

  INSERT INTO public.module_batch_requests (
    empresa_id, valor_total, status, observacao
  ) VALUES (
    v_empresa_id, COALESCE(v_total, 0), 'pending', NULLIF(btrim(_observacao), '')
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.module_batch_request_items (
    batch_request_id, module_id, valor
  )
  SELECT v_batch_id, catalog.id, catalog.valor
  FROM public.module_catalog AS catalog
  WHERE catalog.id = ANY(v_module_ids)
  ORDER BY catalog.ordem, catalog.id;

  RETURN jsonb_build_object(
    'id', v_batch_id,
    'empresa_id', v_empresa_id,
    'module_ids', to_jsonb(v_module_ids),
    'valor_total', COALESCE(v_total, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.master_approve_module_request(
  _request_id uuid,
  _observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.module_requests%ROWTYPE;
  v_price jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a master administrator can approve module requests'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.module_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Module request is not pending';
  END IF;
  SELECT jsonb_build_object(catalog.id::text, catalog.valor) INTO v_price
  FROM public.module_catalog AS catalog WHERE catalog.id = v_request.module_id;
  PERFORM public.activate_company_modules_checked(
    v_request.empresa_id, ARRAY[v_request.module_id], v_price,
    'solicitacao_aprovada', NULL, true
  );
  UPDATE public.module_requests
  SET status = 'approved', approved_at = clock_timestamp(),
      observacao = COALESCE(NULLIF(btrim(_observacao), ''), observacao)
  WHERE id = v_request.id;
  RETURN jsonb_build_object('id', v_request.id, 'empresa_id', v_request.empresa_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.master_approve_module_batch_request(
  _batch_request_id uuid,
  _observacao_admin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.module_batch_requests%ROWTYPE;
  v_module_ids uuid[];
  v_prices jsonb;
  v_expires_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a master administrator can approve module batches'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_batch FROM public.module_batch_requests
  WHERE id = _batch_request_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'Module batch is not pending approval';
  END IF;
  SELECT array_agg(item.module_id),
         jsonb_object_agg(item.module_id::text, item.valor)
  INTO v_module_ids, v_prices
  FROM public.module_batch_request_items AS item
  WHERE item.batch_request_id = v_batch.id;
  IF COALESCE(cardinality(v_module_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Module batch has no items';
  END IF;
  SELECT vencimento INTO v_expires_at FROM public.empresas WHERE id = v_batch.empresa_id;
  PERFORM public.activate_company_modules_checked(
    v_batch.empresa_id, v_module_ids, v_prices,
    'solicitacao_lote_aprovada', v_expires_at, true
  );
  UPDATE public.module_batch_requests
  SET status = 'approved', approved_at = clock_timestamp(),
      observacao_admin = NULLIF(btrim(_observacao_admin), '')
  WHERE id = v_batch.id;
  RETURN jsonb_build_object('id', v_batch.id, 'empresa_id', v_batch.empresa_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.master_approve_module_payment(
  _payment_id uuid,
  _observacao_admin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.module_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a master administrator can approve module payments'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment FROM public.module_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'Module payment is not pending approval';
  END IF;
  PERFORM public.activate_company_modules_checked(
    v_payment.empresa_id, ARRAY[v_payment.module_id],
    jsonb_build_object(v_payment.module_id::text, v_payment.amount),
    'pagamento_aprovado', NULL, true
  );
  UPDATE public.module_payments
  SET status = 'approved', approved_at = clock_timestamp(),
      observacao_admin = NULLIF(btrim(_observacao_admin), '')
  WHERE id = v_payment.id;
  RETURN jsonb_build_object('id', v_payment.id, 'empresa_id', v_payment.empresa_id);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_company_modules_checked(uuid, uuid[], jsonb, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_company_module_batch(uuid[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.master_approve_module_request(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.master_approve_module_batch_request(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.master_approve_module_payment(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_duplicate_company_module()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_inserted_module_batch_dependencies()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.request_company_module_batch(uuid[], text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_approve_module_request(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_approve_module_batch_request(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_approve_module_payment(uuid, text)
  TO authenticated;
