-- Ensure newly created companies receive canonical module entitlements.
-- This is idempotent and safe for production, and it respects the lifetime-plan bypass.

CREATE OR REPLACE FUNCTION public.handle_new_company_module_provisioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.provision_company_module_entitlements(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provision_company_module_entitlements_on_company_insert
  ON public.empresas;

CREATE TRIGGER trg_provision_company_module_entitlements_on_company_insert
AFTER INSERT ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_company_module_provisioning();
