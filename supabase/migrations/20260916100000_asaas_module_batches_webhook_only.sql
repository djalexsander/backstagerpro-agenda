-- Keep historical/manual batch approval, but never let that path approve an
-- Asaas batch. A linked payment is authoritative even if payment_method was
-- left null or changed on an older record.
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Module batch is not pending approval';
  END IF;

  IF v_batch.payment_method = 'asaas' OR EXISTS (
    SELECT 1 FROM public.asaas_payments
    WHERE related_batch_request_id = v_batch.id
  ) THEN
    RAISE EXCEPTION 'Asaas module batches can only be approved by the confirmed webhook'
      USING ERRCODE = '42501';
  END IF;

  IF v_batch.status NOT IN ('pending', 'paid') THEN
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

REVOKE ALL ON FUNCTION public.master_approve_module_batch_request(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.master_approve_module_batch_request(uuid, text)
  TO authenticated;

-- A Master may update module_batch_requests directly under its broad legacy
-- RLS policy. Reject status changes for Asaas batches at the table boundary.
CREATE FUNCTION public.protect_asaas_batch_manual_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.approved_at IS NOT DISTINCT FROM NEW.approved_at
     AND OLD.rejected_at IS NOT DISTINCT FROM NEW.rejected_at
     AND OLD.payment_method IS NOT DISTINCT FROM NEW.payment_method THEN
    RETURN NEW;
  END IF;

  IF (OLD.payment_method = 'asaas' OR NEW.payment_method = 'asaas' OR EXISTS (
    SELECT 1 FROM public.asaas_payments
    WHERE related_batch_request_id = OLD.id
  ))
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT (auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'Asaas module batches can only be changed by the confirmed webhook'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_asaas_batch_manual_transition()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_asaas_batch_manual_transition_trigger
BEFORE UPDATE OF status, approved_at, rejected_at, payment_method
ON public.module_batch_requests
FOR EACH ROW
EXECUTE FUNCTION public.protect_asaas_batch_manual_transition();

-- A direct empresa_modules write must not activate an entitlement reserved by
-- an in-flight Asaas batch. The webhook runs with the service-role JWT.
CREATE FUNCTION public.protect_asaas_batch_manual_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'active')
     OR current_setting('request.jwt.claim.role', true) = 'service_role'
     OR (auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payment
    JOIN public.module_batch_request_items AS item
      ON item.batch_request_id = payment.related_batch_request_id
     AND item.module_id = NEW.module_id
    WHERE payment.empresa_id = NEW.empresa_id
      AND payment.payment_type = 'modules'
      AND payment.status IN ('pending', 'confirmed', 'received', 'overdue')
      AND payment.activation_status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Asaas module batch entitlements can only be activated by the confirmed webhook'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_asaas_batch_manual_activation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_asaas_batch_manual_activation_trigger
BEFORE INSERT OR UPDATE OF status ON public.empresa_modules
FOR EACH ROW
EXECUTE FUNCTION public.protect_asaas_batch_manual_activation();
