-- P0-7: make company-admin role changes canonical and transactional.
--
-- user_roles is unique on (user_id, role), not user_id. The former normal
-- frontend flow updated one row or upserted the new pair, so an old role could
-- survive and keep granting privileges through has_role(). This RPC is scoped
-- to admin_empresa; the separate master_set_user_role flow remains unchanged.

CREATE OR REPLACE FUNCTION public.company_set_user_role(
  _target_user_id uuid,
  _role text,
  _full_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid;
  v_target_profile public.profiles%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Autenticação obrigatória.';
  END IF;

  -- Master role management remains exclusively in master_set_user_role.
  IF public.is_master_admin(v_actor_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Master admin deve usar o fluxo administrativo global.';
  END IF;

  IF NOT public.has_role(v_actor_id, 'admin_empresa'::public.app_role) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Somente administradores da empresa podem alterar papéis.';
  END IF;

  IF _role NOT IN ('admin_empresa', 'usuario') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Papel inválido para administração da empresa.';
  END IF;

  -- Locking the actor profile also serializes a concurrent role change that
  -- targets this administrator through either company or Master RPC.
  SELECT profile.empresa_id
  INTO v_company_id
  FROM public.profiles AS profile
  JOIN public.empresa_usuarios AS membership
    ON membership.user_id = profile.user_id
   AND membership.empresa_id = profile.empresa_id
  WHERE profile.user_id = v_actor_id
  FOR UPDATE OF profile;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Administrador sem empresa vinculada.';
  END IF;

  -- Requiring both the active profile company and its canonical membership
  -- preserves the existing company-admin boundary and fails closed on a stale
  -- or cross-tenant target. The row lock serializes role changes for the same
  -- target with master_set_user_role as well.
  SELECT profile.*
  INTO v_target_profile
  FROM public.profiles AS profile
  JOIN public.empresa_usuarios AS membership
    ON membership.user_id = profile.user_id
   AND membership.empresa_id = profile.empresa_id
  WHERE profile.user_id = _target_user_id
    AND profile.empresa_id = v_company_id
  FOR UPDATE OF profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Usuário não pertence à empresa do administrador.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _target_user_id
      AND role = 'master_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Contas master_admin não podem ser alteradas por este fluxo.';
  END IF;

  UPDATE public.profiles
  SET full_name = _full_name
  WHERE user_id = _target_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role <> _role::public.app_role;

  RETURN jsonb_build_object(
    'user_id', _target_user_id,
    'role', _role,
    'empresa_id', v_company_id,
    'full_name', _full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.company_set_user_role(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_set_user_role(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.company_set_user_role(uuid, text, text) IS
  'Company-admin-only transactional role/profile update. Restricts the target to the actor active company, rejects master accounts, and leaves exactly one canonical user_roles row.';
