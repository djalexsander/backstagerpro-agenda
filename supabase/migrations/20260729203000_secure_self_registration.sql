-- Persistent throttling for the public self-registration endpoint. Only HMAC
-- identifiers are stored; raw email addresses and IP addresses are not kept.

CREATE TABLE IF NOT EXISTS public.self_registration_rate_limits (
  identifier_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_registration_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS self_registration_rate_limits_updated_at_idx
  ON public.self_registration_rate_limits (updated_at);

REVOKE ALL ON TABLE public.self_registration_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.self_registration_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_self_registration_rate_limit(
  _identifier_hash text,
  _max_requests integer,
  _window_seconds integer,
  _block_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit public.self_registration_rate_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF length(_identifier_hash) <> 64
     OR _max_requests < 1
     OR _window_seconds < 1
     OR _block_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid self-registration rate-limit parameters';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_identifier_hash, 0));

  -- Bound the storage used by the protection itself. The partial probability
  -- avoids a cleanup scan on every public request.
  IF random() < 0.01 THEN
    DELETE FROM public.self_registration_rate_limits
    WHERE updated_at < v_now - interval '7 days';
  END IF;

  SELECT *
  INTO v_limit
  FROM public.self_registration_rate_limits
  WHERE identifier_hash = _identifier_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.self_registration_rate_limits (identifier_hash)
    VALUES (_identifier_hash);
    RETURN true;
  END IF;

  IF v_limit.blocked_until IS NOT NULL AND v_limit.blocked_until > v_now THEN
    RETURN false;
  END IF;

  IF v_limit.window_started_at <=
     v_now - make_interval(secs => _window_seconds) THEN
    UPDATE public.self_registration_rate_limits
    SET window_started_at = v_now,
        request_count = 1,
        blocked_until = NULL,
        updated_at = v_now
    WHERE identifier_hash = _identifier_hash;
    RETURN true;
  END IF;

  IF v_limit.request_count >= _max_requests THEN
    UPDATE public.self_registration_rate_limits
    SET blocked_until = v_now + make_interval(secs => _block_seconds),
        updated_at = v_now
    WHERE identifier_hash = _identifier_hash;
    RETURN false;
  END IF;

  UPDATE public.self_registration_rate_limits
  SET request_count = request_count + 1,
      updated_at = v_now
  WHERE identifier_hash = _identifier_hash;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_self_registration_rate_limit(
  text, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_self_registration_rate_limit(
  text, integer, integer, integer
) TO service_role;

COMMENT ON TABLE public.self_registration_rate_limits IS
  'Service-only HMAC counters protecting the public self-registration endpoint.';

COMMENT ON FUNCTION public.consume_self_registration_rate_limit(
  text, integer, integer, integer
) IS
  'Atomically consumes a self-registration attempt within a fixed window.';

CREATE OR REPLACE FUNCTION public.get_self_registration_auth_state(_email text)
RETURNS TABLE (
  user_id uuid,
  email_confirmed_at timestamptz,
  registration_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    users.id,
    users.email_confirmed_at,
    users.raw_app_meta_data->>'registration_source'
  FROM auth.users
  WHERE lower(users.email) = lower(_email)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_self_registration_auth_state(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_self_registration_auth_state(text)
  TO service_role;

COMMENT ON FUNCTION public.get_self_registration_auth_state(text) IS
  'Returns only the confirmation state required by self-register; service role only.';

-- Authorization data from public user_metadata must never choose a tenant or
-- role. Only the service-role marker in raw_app_meta_data can authorize the
-- initial admin assignment used by self-register. Administrative invite
-- functions assign their target company and role explicitly after creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_trusted_self_registration boolean :=
    NEW.raw_app_meta_data->>'registration_source' = 'self_register';
  v_company_id uuid;
  v_role public.app_role;
BEGIN
  IF v_is_trusted_self_registration THEN
    v_company_id := NULLIF(NEW.raw_app_meta_data->>'empresa_id', '')::uuid;
    v_role := 'admin_empresa'::public.app_role;
  ELSE
    v_company_id := NULL;
    v_role := 'usuario'::public.app_role;
  END IF;

  INSERT INTO public.profiles (user_id, full_name, email, empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    v_company_id
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a safe default user; tenant/admin assignment requires service-managed app_metadata.';
