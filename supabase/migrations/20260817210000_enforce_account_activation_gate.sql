-- P1-14: make account activation a central authorization invariant.
-- Recovery sessions must remain usable by Primeiro Acesso, but an account is
-- not a tenant actor until profiles.ativado has been consumed server-side.

CREATE OR REPLACE FUNCTION public.get_user_empresa_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.empresa_id
  FROM public.profiles AS p
  JOIN public.empresa_usuarios AS eu
    ON eu.user_id = p.user_id
   AND eu.empresa_id = p.empresa_id
  WHERE p.user_id = _user_id
    AND p.ativado = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    JOIN public.profiles AS p ON p.user_id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND p.ativado = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.has_role(_user_id, 'master_admin'::public.app_role)
$$;

-- Only the trusted activation backend may change the activation claim. This
-- prevents an authenticated recovery session from setting ativado through the
-- profiles REST endpoint and defeating the helper gate above.
CREATE OR REPLACE FUNCTION public.protect_profile_activation_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
    NEW.ativado IS DISTINCT FROM OLD.ativado
    OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
  ) AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Account activation state is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_activation_state_trigger
  ON public.profiles;
CREATE TRIGGER protect_profile_activation_state_trigger
BEFORE UPDATE OF ativado, activated_at ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_activation_state();

REVOKE ALL ON FUNCTION public.get_user_empresa_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_master_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_profile_activation_state()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_user_empresa_id(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_user_empresa_id(uuid) IS
  'Returns the canonical tenant only for an activated account with synchronized membership.';
COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'Checks a role only when the corresponding account is activated.';
COMMENT ON FUNCTION public.is_master_admin(uuid) IS
  'Checks master_admin through the activation-aware canonical role helper.';
COMMENT ON FUNCTION public.protect_profile_activation_state() IS
  'Prevents client sessions from mutating the server-controlled account activation claim.';
