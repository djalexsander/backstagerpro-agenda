-- Corrective migration for canonical module entitlement provisioning.
-- This migration is idempotent and safe for production.

CREATE OR REPLACE FUNCTION public.provision_company_module_entitlements(
  _empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_record public.empresas%ROWTYPE;
  v_lifetime boolean;
  v_module_record public.module_catalog%ROWTYPE;
  v_existing_record public.empresa_modules%ROWTYPE;
  v_module_ids uuid[];
  v_module_id uuid;
BEGIN
  SELECT *
  INTO v_company_record
  FROM public.empresas
  WHERE id = _empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT public.company_has_lifetime_subscription(_empresa_id)
  INTO v_lifetime;

  IF v_lifetime THEN
    RETURN;
  END IF;

  FOR v_module_record IN
    SELECT *
    FROM public.module_catalog
    WHERE ativo = true
    ORDER BY ordem, created_at
  LOOP
    SELECT id, empresa_id, module_id, status, activated_at, expires_at, granted_by_admin, valor_cobrado, origem, trial_granted
    INTO v_existing_record
    FROM public.empresa_modules
    WHERE empresa_id = _empresa_id
      AND module_id = v_module_record.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.empresa_modules (
      empresa_id,
      module_id,
      status,
      activated_at,
      expires_at,
      granted_by_admin,
      valor_cobrado,
      origem,
      trial_granted
    )
    VALUES (
      _empresa_id,
      v_module_record.id,
      'inactive',
      NULL,
      NULL,
      false,
      COALESCE(v_module_record.valor, 0),
      'provisioning',
      false
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.provision_company_module_entitlements(uuid) IS
'Provision canonical module entitlements for a company without granting paid modules automatically. Lifetime companies are bypassed.';

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  FOR v_company_id IN
    SELECT id
    FROM public.empresas
    WHERE id IS NOT NULL
  LOOP
    PERFORM public.provision_company_module_entitlements(v_company_id);
  END LOOP;
END;
$$;
