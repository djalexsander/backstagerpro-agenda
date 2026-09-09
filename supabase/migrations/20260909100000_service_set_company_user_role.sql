-- P0-7 (residue): the invite Edge Functions (create-user / create-empresa-user)
-- still wrote user_roles with a bare
--   upsert({ user_id, role }, { onConflict: "user_id,role" })
-- which inserts the new (user_id, role) pair but never removes a pre-existing
-- one. Re-inviting an existing member of the same company with a different
-- role left them holding BOTH rows, so has_role() (an EXISTS check) and the
-- empresa_usuarios.perfil projection kept granting the old privilege after a
-- silent "demotion". handle_new_user() already seeds every freshly invited
-- user with a 'usuario' role, so even a brand-new invite as 'admin_empresa'
-- ended up with two rows.
--
-- company_set_user_role / master_set_user_role already reconcile user_roles to
-- exactly one canonical row, but both run as auth.uid() and company_set_user_role
-- rejects a master caller - neither can be invoked from the service-role invite
-- functions (and create-empresa-user is driven by a master). This RPC is the
-- service-role sibling: same "insert the target role, delete every other row"
-- reconciliation, in one transaction, with the actor re-checked server-side
-- exactly like detach_company_user (20260730003000). The pure reference model
-- of the reconciliation lives in
-- supabase/functions/_shared/company-user-role.ts (reconcileCanonicalRole) and
-- is exercised by both the vitest suite and
-- supabase/tests/service_set_company_user_role_test.sql.

CREATE OR REPLACE FUNCTION public.service_set_company_user_role(
  _actor_id uuid,
  _target_user_id uuid,
  _empresa_id uuid,
  _role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_company_id uuid;
  v_is_master boolean;
  v_is_admin boolean;
  v_target_company_id uuid;
  v_target_exists boolean;
BEGIN
  IF _actor_id IS NULL OR _target_user_id IS NULL OR _empresa_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Ator, usuário-alvo e empresa são obrigatórios.';
  END IF;

  -- Only the two company-scoped roles are assignable here. This blocks
  -- master_admin and the legacy 'admin'/'user' values, so the invite flow can
  -- never escalate a user to a platform role.
  IF _role NOT IN ('admin_empresa', 'usuario') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Papel inválido para este fluxo.';
  END IF;

  -- Serialize with the membership triggers and detach_company_user, which take
  -- the same per-user advisory lock, so a concurrent unlink or role change for
  -- the same target cannot interleave with the reconciliation below.
  PERFORM pg_advisory_xact_lock(hashtextextended(_target_user_id::text, 0));

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

  IF NOT v_is_master AND NOT v_is_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Somente administradores podem definir papéis de usuário.';
  END IF;

  -- A company administrator is bound to their own company; a master may target
  -- any company. Mirrors detach_company_user's actor/company binding.
  IF NOT v_is_master THEN
    SELECT empresa_id INTO v_actor_company_id
    FROM public.profiles
    WHERE user_id = _actor_id;

    IF v_actor_company_id IS NULL OR v_actor_company_id <> _empresa_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Administrador de empresa só gerencia usuários da própria empresa.';
    END IF;
  END IF;

  -- Never touch a master account through the company invite flow, same boundary
  -- company_set_user_role and detach_company_user enforce.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id
      AND role = 'master_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Contas master_admin não podem ser alteradas por este fluxo.';
  END IF;

  -- Tenant isolation: a target that already has a profile must belong to the
  -- same company. A freshly invited user whose profile row still has a null
  -- empresa_id (handle_new_user default for invites) is allowed through - the
  -- invite function sets its company right after.
  SELECT profile.empresa_id, true
  INTO v_target_company_id, v_target_exists
  FROM public.profiles AS profile
  WHERE profile.user_id = _target_user_id
  FOR UPDATE;

  IF v_target_exists AND v_target_company_id IS NOT NULL
     AND v_target_company_id <> _empresa_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Usuário pertence a outra empresa.';
  END IF;

  -- Exactly one canonical role. Same reconciliation as company_set_user_role
  -- and master_set_user_role: ensure the target row exists, then drop every
  -- other role the user holds.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role <> _role::public.app_role;

  RETURN jsonb_build_object(
    'user_id', _target_user_id,
    'empresa_id', _empresa_id,
    'role', _role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_set_company_user_role(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_set_company_user_role(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.service_set_company_user_role(uuid, uuid, uuid, text) IS
  'Service-role-only transactional role write for the invite Edge Functions. Re-checks the actor (company admin bound to their own company, or master), rejects master targets and non-company roles, and reconciles user_roles to exactly one canonical row.';

DO $$
DECLARE
  v_fn regprocedure :=
    'public.service_set_company_user_role(uuid, uuid, uuid, text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN190',
      MESSAGE = 'Hardening falhou: service_set_company_user_role executável por anon.';
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN191',
      MESSAGE = 'Hardening falhou: service_set_company_user_role executável por authenticated.';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN192',
      MESSAGE = 'service_set_company_user_role não está executável por service_role.';
  END IF;
END;
$$;
