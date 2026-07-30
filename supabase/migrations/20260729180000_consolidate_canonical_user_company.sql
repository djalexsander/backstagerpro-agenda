-- Canonical multi-tenant model:
--   profiles.empresa_id is the active company used for tenant isolation.
--   empresa_usuarios is the authoritative membership set used for listings
--   and plan limits. Every active company must have a matching membership.
--
-- Reconcile the active profile assignment without erasing any additional
-- company membership. Plan limits must not prevent repair of existing users.
ALTER TABLE public.empresa_usuarios
  DISABLE TRIGGER check_user_limit_trigger;

INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
SELECT
  p.empresa_id,
  p.user_id,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p.user_id
        AND ur.role::text IN ('master_admin', 'admin_empresa', 'admin')
    ) THEN 'admin_empresa'
    ELSE 'usuario'
  END
FROM public.profiles p
WHERE p.empresa_id IS NOT NULL
ON CONFLICT (empresa_id, user_id) DO UPDATE
SET perfil = EXCLUDED.perfil;

UPDATE public.empresa_usuarios eu
SET perfil = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = eu.user_id
      AND ur.role::text IN ('master_admin', 'admin_empresa', 'admin')
  ) THEN 'admin_empresa'
  ELSE 'usuario'
END;

ALTER TABLE public.empresa_usuarios
  ENABLE TRIGGER check_user_limit_trigger;

ALTER TABLE public.empresa_usuarios
  DROP CONSTRAINT IF EXISTS empresa_usuarios_user_id_fkey;

ALTER TABLE public.empresa_usuarios
  ADD CONSTRAINT empresa_usuarios_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles(user_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.empresa_usuarios
  VALIDATE CONSTRAINT empresa_usuarios_user_id_fkey;

CREATE OR REPLACE FUNCTION public.get_canonical_empresa_perfil(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.role::text IN ('master_admin', 'admin_empresa', 'admin')
    ) THEN 'admin_empresa'
    ELSE 'usuario'
  END
$$;

CREATE OR REPLACE FUNCTION public.guard_empresa_usuario_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE user_id = OLD.user_id
        AND empresa_id = OLD.empresa_id
    ) THEN
      RAISE EXCEPTION
        'The active company membership must be switched before it is removed';
    END IF;

    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'A company membership requires an existing profile';
  END IF;

  NEW.perfil := public.get_canonical_empresa_perfil(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_empresa_usuario_projection_trigger
  ON public.empresa_usuarios;
DROP TRIGGER IF EXISTS a_guard_empresa_usuario_projection_trigger
  ON public.empresa_usuarios;

CREATE TRIGGER a_guard_empresa_usuario_projection_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.empresa_usuarios
FOR EACH ROW
EXECUTE FUNCTION public.guard_empresa_usuario_projection();

CREATE OR REPLACE FUNCTION public.protect_profile_empresa_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_master_admin(auth.uid()) THEN
    RAISE EXCEPTION
      'Only a master administrator or trusted server flow can change profiles.empresa_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_empresa_assignment_trigger
  ON public.profiles;

CREATE TRIGGER protect_profile_empresa_assignment_trigger
BEFORE UPDATE OF empresa_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_empresa_assignment();

CREATE OR REPLACE FUNCTION public.sync_empresa_usuario_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.empresa_usuarios
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  -- Changing the active tenant must not erase other memberships.
  IF NEW.empresa_id IS NOT NULL THEN
    INSERT INTO public.empresa_usuarios (empresa_id, user_id, perfil)
    VALUES (
      NEW.empresa_id,
      NEW.user_id,
      public.get_canonical_empresa_perfil(NEW.user_id)
    )
    ON CONFLICT (empresa_id, user_id) DO UPDATE
    SET perfil = EXCLUDED.perfil;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_empresa_usuario_from_profile_trigger
  ON public.profiles;
DROP TRIGGER IF EXISTS sync_empresa_usuario_from_profile_write_trigger
  ON public.profiles;
DROP TRIGGER IF EXISTS sync_empresa_usuario_from_profile_delete_trigger
  ON public.profiles;

CREATE TRIGGER sync_empresa_usuario_from_profile_write_trigger
AFTER INSERT OR UPDATE OF empresa_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_empresa_usuario_from_profile();

CREATE TRIGGER sync_empresa_usuario_from_profile_delete_trigger
AFTER DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_empresa_usuario_from_profile();

CREATE OR REPLACE FUNCTION public.sync_empresa_usuario_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

  UPDATE public.empresa_usuarios
  SET perfil = public.get_canonical_empresa_perfil(v_user_id)
  WHERE user_id = v_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_empresa_usuario_role_trigger
  ON public.user_roles;
DROP TRIGGER IF EXISTS sync_empresa_usuario_role_write_trigger
  ON public.user_roles;
DROP TRIGGER IF EXISTS sync_empresa_usuario_role_delete_trigger
  ON public.user_roles;

CREATE TRIGGER sync_empresa_usuario_role_write_trigger
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_empresa_usuario_role();

CREATE TRIGGER sync_empresa_usuario_role_delete_trigger
AFTER DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_empresa_usuario_role();

-- Tenant policies continue to call this helper. Requiring the synchronized
-- projection makes any accidental inconsistency fail closed.
CREATE OR REPLACE FUNCTION public.get_user_empresa_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.empresa_id
  FROM public.profiles p
  JOIN public.empresa_usuarios eu
    ON eu.user_id = p.user_id
   AND eu.empresa_id = p.empresa_id
  WHERE p.user_id = _user_id
  LIMIT 1
$$;

COMMENT ON COLUMN public.profiles.empresa_id IS
  'Active company selected for tenant isolation. Only trusted server flows or master admins may change it.';

COMMENT ON TABLE public.empresa_usuarios IS
  'Authoritative company membership set used for listings and plan limits.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.empresa_usuarios eu
      ON eu.user_id = p.user_id
     AND eu.empresa_id = p.empresa_id
    WHERE p.empresa_id IS NOT NULL
      AND eu.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.empresa_usuarios eu
    LEFT JOIN public.profiles p
      ON p.user_id = eu.user_id
    WHERE p.user_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Company reconciliation failed: active companies or membership profiles are missing';
  END IF;
END;
$$;
