
-- =============================================
-- 1. FIX COMPROVANTES BUCKET: make private + scope by empresa
-- =============================================
UPDATE storage.buckets SET public = false WHERE id = 'comprovantes';

-- Drop broad policies
DROP POLICY IF EXISTS "View comprovantes" ON storage.objects;
DROP POLICY IF EXISTS "Empresa upload comprovante" ON storage.objects;

-- Scoped SELECT: users can only read their own empresa's comprovantes
CREATE POLICY "Company scoped read comprovantes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprovantes'
  AND (
    (storage.foldername(name))[1] = get_user_empresa_id(auth.uid())::text
    OR is_master_admin(auth.uid())
  )
);

-- Scoped INSERT: users can only upload to their own empresa folder
CREATE POLICY "Company scoped upload comprovantes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprovantes'
  AND (
    (storage.foldername(name))[1] = get_user_empresa_id(auth.uid())::text
    OR is_master_admin(auth.uid())
  )
);

-- =============================================
-- 2. FIX USER_ROLES PRIVILEGE ESCALATION
-- =============================================
DROP POLICY IF EXISTS "Admin manage roles" ON public.user_roles;

-- Master admin can do everything
CREATE POLICY "Master admin manage all roles"
ON public.user_roles FOR ALL
TO authenticated
USING (is_master_admin(auth.uid()))
WITH CHECK (is_master_admin(auth.uid()));

-- Admin empresa can only manage roles for users in their own empresa
-- and cannot assign master_admin role
CREATE POLICY "Admin empresa manage company roles"
ON public.user_roles FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND user_id IN (
    SELECT p.user_id FROM public.profiles p
    WHERE p.empresa_id = get_user_empresa_id(auth.uid())
  )
  AND role != 'master_admin'::app_role
)
WITH CHECK (
  has_role(auth.uid(), 'admin_empresa'::app_role)
  AND user_id IN (
    SELECT p.user_id FROM public.profiles p
    WHERE p.empresa_id = get_user_empresa_id(auth.uid())
  )
  AND role != 'master_admin'::app_role
);

-- =============================================
-- 3. FIX AUDIT LOG NULL USER_ID POLLUTION
-- =============================================
DROP POLICY IF EXISTS "Authenticated self insert logs" ON public.system_logs;

CREATE POLICY "Authenticated self insert logs"
ON public.system_logs FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());
