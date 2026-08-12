-- Codex review (cycle 3) flagged that Master > Usuários Globais' role edit
-- was not atomic: src/pages/master/UsuariosGlobais.tsx ran the profile
-- update, the new-role upsert and the old-roles cleanup as three
-- independent HTTP requests. A failure between the upsert and the cleanup
-- could leave a demoted master_admin still holding the master role, and two
-- concurrent edits with different target roles could race the upsert/delete
-- pair and leave the user with zero user_roles rows. There was also no
-- protection against removing the platform's last master_admin.
--
-- Fix: a single Master-only, SECURITY DEFINER, transactional RPC that
-- updates profiles (full_name/empresa_id) and reconciles user_roles to
-- exactly one canonical row in one transaction, guarded by a transaction
-- scoped advisory lock so concurrent role edits touching master_admin
-- always observe a consistent master_admin count.
--
-- empresa_usuarios stays in sync via the existing triggers
-- (sync_empresa_usuario_from_profile_write_trigger,
-- sync_empresa_usuario_role_write_trigger) introduced by
-- 20260729180000_consolidate_canonical_user_company.sql - this RPC only
-- ever writes to profiles/user_roles, exactly like the client code it
-- replaces, so that projection keeps working unmodified.

CREATE OR REPLACE FUNCTION public.master_set_user_role(
  _target_user_id uuid,
  _role text,
  _full_name text,
  _empresa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_was_master boolean;
  v_master_count integer;
BEGIN
  IF v_actor_id IS NULL OR NOT public.is_master_admin(v_actor_id) THEN
    RAISE EXCEPTION
      'Only a global master administrator can change a user role';
  END IF;

  IF _role NOT IN ('master_admin', 'admin_empresa', 'usuario') THEN
    RAISE EXCEPTION 'Invalid role: %', _role;
  END IF;

  -- Serializes every role change that could affect the master_admin count,
  -- so two concurrent demotions of two different master admins can never
  -- both observe "there is another master left" and jointly zero it out.
  PERFORM pg_advisory_xact_lock(hashtext('master_set_user_role_master_admin_guard'));

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.user_id = _target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user was not found';
  END IF;

  IF _empresa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.empresas WHERE id = _empresa_id
  ) THEN
    RAISE EXCEPTION 'Company was not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _target_user_id
      AND role = 'master_admin'::public.app_role
  )
  INTO v_was_master;

  IF v_was_master AND _role <> 'master_admin' THEN
    SELECT count(*)
    INTO v_master_count
    FROM public.user_roles
    WHERE role = 'master_admin'::public.app_role;

    IF v_master_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last master administrator';
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name = _full_name,
      empresa_id = _empresa_id
  WHERE user_id = _target_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role <> _role::public.app_role;

  INSERT INTO public.system_logs (
    tipo, acao, descricao, user_id, empresa_id, empresa_nome, dados
  )
  VALUES (
    'usuario',
    'papel_alterado_pelo_master',
    'Papel de usuário alterado pelo Master para ' || _role,
    v_actor_id,
    _empresa_id,
    (SELECT nome_empresa FROM public.empresas WHERE id = _empresa_id),
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'papel_anterior_era_master', v_was_master,
      'papel_novo', _role
    )
  );

  RETURN jsonb_build_object(
    'user_id', _target_user_id,
    'role', _role,
    'empresa_id', _empresa_id,
    'full_name', _full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.master_set_user_role(uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_user_role(uuid, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.master_set_user_role(uuid, text, text, uuid) IS
  'Master-only, transactional role/profile update. Atomically upserts the target role, deletes every other user_roles row for the user (single canonical role), and blocks demoting the last master_admin.';

DO $$
DECLARE
  v_fn regprocedure := 'public.master_set_user_role(uuid, text, text, uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN136',
      MESSAGE = 'Hardening falhou: master_set_user_role executavel por anon.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN137',
      MESSAGE = 'master_set_user_role nao esta executavel por authenticated.';
  END IF;
END;
$$;
