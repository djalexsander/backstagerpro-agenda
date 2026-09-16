-- 20260916100000_asaas_module_batches_webhook_only.sql checked
-- current_setting('request.jwt.claim.role', true) directly. That flat GUC is
-- not reliably populated for every PostgREST-authenticated request in this
-- project — auth.role() already falls back to parsing request.jwt.claims for
-- exactly this reason. Without this fix, the asaas-webhook Edge Function's
-- own service-role activation was being rejected by these triggers, leaving
-- paid module batches stuck on "pending" indefinitely (e.g. batch
-- 69230a82-03cc-4ada-9fac-ade909a17aad / payment pay_2jsfp6iirhv6th4c).

CREATE OR REPLACE FUNCTION public.protect_asaas_batch_manual_transition()
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
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'Asaas module batches can only be changed by the confirmed webhook'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_asaas_batch_manual_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'active')
     OR auth.role() = 'service_role'
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
