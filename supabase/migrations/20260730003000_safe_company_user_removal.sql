-- A profile selects the active tenant. empresa_usuarios stores the membership
-- set and may contain more than one company for defensive unlinking.
DROP INDEX IF EXISTS public.empresa_usuarios_user_id_key;

CREATE OR REPLACE FUNCTION public.guard_empresa_usuario_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Serialize membership writes with detach_company_user. This closes the
  -- window between the zero-link check and the external Auth deletion.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END::text,
      0
    )
  );

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
    RAISE EXCEPTION 'A company membership requires an existing profile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_company_removal_audit
    WHERE target_user_id = NEW.user_id
      AND auth_deletion_status IN ('pending', 'failed')
  ) THEN
    RAISE EXCEPTION
      'The Auth identity has a pending deletion and cannot receive new memberships';
  END IF;

  NEW.perfil := public.get_canonical_empresa_perfil(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_empresa_usuario_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.empresa_usuarios
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  -- Switching the active tenant must never erase other memberships.
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

COMMENT ON COLUMN public.profiles.empresa_id IS
  'Active company selected for tenant isolation; it must reference one company membership.';

COMMENT ON TABLE public.empresa_usuarios IS
  'Authoritative company membership set. Removing one row must not delete the global Auth identity.';

CREATE TABLE IF NOT EXISTS public.user_company_removal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_email text,
  target_user_id uuid NOT NULL,
  target_email text,
  target_name text,
  empresa_id uuid,
  empresa_nome text,
  removed_perfil text,
  action text NOT NULL CHECK (
    action IN ('company_unlinked', 'last_company_unlinked', 'orphan_auth_cleanup')
  ),
  remaining_links integer NOT NULL CHECK (remaining_links >= 0),
  auth_deletion_required boolean NOT NULL,
  auth_deletion_status text NOT NULL CHECK (
    auth_deletion_status IN ('not_required', 'pending', 'completed', 'failed')
  ),
  auth_deletion_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_company_removal_audit_target
  ON public.user_company_removal_audit (target_user_id, created_at DESC);

ALTER TABLE public.user_company_removal_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Master admin view user removal audit"
  ON public.user_company_removal_audit;
CREATE POLICY "Master admin view user removal audit"
ON public.user_company_removal_audit
FOR SELECT TO authenticated
USING (public.is_master_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.user_company_removal_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.user_company_removal_audit
  TO service_role;

-- Preserve events when the final company link causes Auth deletion.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.events
  VALIDATE CONSTRAINT events_created_by_fkey;

CREATE OR REPLACE FUNCTION public.detach_company_user(
  _actor_id uuid,
  _target_user_id uuid,
  _empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actor_company_id uuid;
  v_actor_email text;
  v_is_master boolean;
  v_is_admin boolean;
  v_target_profile public.profiles%ROWTYPE;
  v_target_email text;
  v_target_name text;
  v_company_name text;
  v_removed_perfil text;
  v_next_company_id uuid;
  v_remaining_links integer;
  v_action text;
  v_audit public.user_company_removal_audit%ROWTYPE;
BEGIN
  IF _actor_id IS NULL OR _target_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Actor and target user are required';
  END IF;

  IF _actor_id = _target_user_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'You cannot remove your own account';
  END IF;

  -- The membership trigger takes the same lock, so a new company cannot be
  -- linked after this transaction has decided that Auth deletion is safe.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_target_user_id::text, 0)
  );

  SELECT
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _actor_id
        AND role = 'master_admin'::public.app_role
    ),
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _actor_id
        AND role = 'admin_empresa'::public.app_role
    )
  INTO v_is_master, v_is_admin;

  SELECT empresa_id
  INTO v_actor_company_id
  FROM public.profiles
  WHERE user_id = _actor_id;

  SELECT email
  INTO v_actor_email
  FROM auth.users
  WHERE id = _actor_id;

  IF NOT v_is_master AND NOT v_is_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Only administrators can remove company users';
  END IF;

  IF NOT v_is_master AND (
    _empresa_id IS NULL
    OR v_actor_company_id IS NULL
    OR _empresa_id <> v_actor_company_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Company administrators can only remove their own membership';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _target_user_id
      AND role = 'master_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Master administrator identities require a dedicated recovery flow';
  END IF;

  -- Retry a pending Auth deletion without creating another unlink audit.
  SELECT audits.*
  INTO v_audit
  FROM public.user_company_removal_audit AS audits
  WHERE audits.target_user_id = _target_user_id
    AND audits.empresa_id IS NOT DISTINCT FROM _empresa_id
    AND audits.auth_deletion_status IN ('pending', 'failed')
  ORDER BY audits.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    SELECT count(*)::integer
    INTO v_remaining_links
    FROM public.empresa_usuarios
    WHERE user_id = _target_user_id;

    IF v_remaining_links > 0 THEN
      UPDATE public.user_company_removal_audit
      SET auth_deletion_status = 'not_required',
          auth_deletion_required = false,
          remaining_links = v_remaining_links,
          auth_deletion_error =
            'Auth deletion cancelled because the user was linked again',
          updated_at = clock_timestamp()
      WHERE id = v_audit.id;

      RETURN jsonb_build_object(
        'audit_id', v_audit.id,
        'action', 'company_unlinked',
        'remaining_links', v_remaining_links,
        'should_delete_auth', false
      );
    END IF;

    RETURN jsonb_build_object(
      'audit_id', v_audit.id,
      'action', v_audit.action,
      'remaining_links', 0,
      'should_delete_auth', true
    );
  END IF;

  SELECT profiles.*
  INTO v_target_profile
  FROM public.profiles AS profiles
  WHERE profiles.user_id = _target_user_id
  FOR UPDATE;

  v_target_name := NULLIF(v_target_profile.full_name, '');
  v_target_email := v_target_profile.email;
  IF v_target_email IS NULL THEN
    SELECT email
    INTO v_target_email
    FROM auth.users
    WHERE id = _target_user_id;
  END IF;

  IF _empresa_id IS NULL THEN
    IF NOT v_is_master THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Only master administrators can clean up orphan identities';
    END IF;

    SELECT count(*)::integer
    INTO v_remaining_links
    FROM public.empresa_usuarios
    WHERE user_id = _target_user_id;

    IF v_remaining_links <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'empresa_id is required while company links still exist';
    END IF;

    v_action := 'orphan_auth_cleanup';
    v_removed_perfil := NULL;
  ELSE
    SELECT nome_empresa
    INTO v_company_name
    FROM public.empresas
    WHERE id = _empresa_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'Company was not found';
    END IF;

    SELECT perfil
    INTO v_removed_perfil
    FROM public.empresa_usuarios
    WHERE user_id = _target_user_id
      AND empresa_id = _empresa_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'User is not linked to the requested company';
    END IF;

    IF v_target_profile.empresa_id = _empresa_id THEN
      SELECT empresa_id
      INTO v_next_company_id
      FROM public.empresa_usuarios
      WHERE user_id = _target_user_id
        AND empresa_id <> _empresa_id
      ORDER BY created_at, id
      LIMIT 1;

      UPDATE public.profiles
      SET empresa_id = v_next_company_id
      WHERE user_id = _target_user_id;
    END IF;

    DELETE FROM public.empresa_usuarios
    WHERE user_id = _target_user_id
      AND empresa_id = _empresa_id;

    SELECT count(*)::integer
    INTO v_remaining_links
    FROM public.empresa_usuarios
    WHERE user_id = _target_user_id;

    v_action := CASE
      WHEN v_remaining_links = 0 THEN 'last_company_unlinked'
      ELSE 'company_unlinked'
    END;
  END IF;

  INSERT INTO public.user_company_removal_audit (
    actor_user_id,
    actor_email,
    target_user_id,
    target_email,
    target_name,
    empresa_id,
    empresa_nome,
    removed_perfil,
    action,
    remaining_links,
    auth_deletion_required,
    auth_deletion_status
  )
  VALUES (
    _actor_id,
    v_actor_email,
    _target_user_id,
    v_target_email,
    v_target_name,
    _empresa_id,
    v_company_name,
    v_removed_perfil,
    v_action,
    v_remaining_links,
    v_remaining_links = 0,
    CASE WHEN v_remaining_links = 0 THEN 'pending' ELSE 'not_required' END
  )
  RETURNING * INTO v_audit;

  INSERT INTO public.system_logs (
    tipo,
    acao,
    descricao,
    user_id,
    user_name,
    empresa_id,
    empresa_nome,
    dados
  )
  VALUES (
    'usuario',
    v_action,
    CASE
      WHEN v_remaining_links = 0
        THEN 'Último vínculo empresarial removido; exclusão Auth pendente'
      ELSE 'Vínculo do usuário removido sem excluir a identidade Auth'
    END,
    _actor_id,
    v_actor_email,
    _empresa_id,
    v_company_name,
    jsonb_build_object(
      'audit_id', v_audit.id,
      'target_user_id', _target_user_id,
      'target_email', v_target_email,
      'remaining_links', v_remaining_links
    )
  );

  RETURN jsonb_build_object(
    'audit_id', v_audit.id,
    'action', v_action,
    'remaining_links', v_remaining_links,
    'should_delete_auth', v_remaining_links = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_user_auth_deletion(
  _audit_id uuid,
  _success boolean,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.user_company_removal_audit
  SET auth_deletion_status = CASE WHEN _success THEN 'completed' ELSE 'failed' END,
      auth_deletion_error = CASE
        WHEN _success THEN NULL
        ELSE left(COALESCE(_error, 'Unknown Auth deletion error'), 500)
      END,
      updated_at = clock_timestamp()
  WHERE id = _audit_id
    AND auth_deletion_required = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending Auth deletion audit was not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.detach_company_user(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detach_company_user(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_user_auth_deletion(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_user_auth_deletion(uuid, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public.detach_company_user(uuid, uuid, uuid) IS
  'Atomically removes one company membership and records whether Auth deletion is safe.';

COMMENT ON FUNCTION public.finalize_user_auth_deletion(uuid, boolean, text) IS
  'Persists the external Supabase Auth deletion outcome without losing the unlink audit.';
