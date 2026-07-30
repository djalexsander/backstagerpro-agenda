-- Account activation is authorized by an expiring, single-use Supabase Auth
-- invite/recovery token. This database claim adds atomic one-time consumption
-- after the OTP has been exchanged for a validated session.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

UPDATE public.profiles
SET activated_at = COALESCE(activated_at, updated_at, created_at, now())
WHERE ativado = true
  AND activated_at IS NULL;

CREATE OR REPLACE FUNCTION public.consume_account_activation(_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consumed_at timestamptz := clock_timestamp();
BEGIN
  UPDATE public.profiles
  SET ativado = true,
      activated_at = v_consumed_at
  WHERE user_id = _user_id
    AND ativado = false
  RETURNING activated_at INTO v_consumed_at;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_consumed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_account_activation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_activation(uuid)
  TO service_role;

COMMENT ON COLUMN public.profiles.activated_at IS
  'Timestamp of the atomic, one-time account activation claim.';

COMMENT ON FUNCTION public.consume_account_activation(uuid) IS
  'Atomically consumes first account activation; callable only by service_role after OTP validation.';
