
-- Update existing roles
UPDATE public.user_roles SET role = 'admin_empresa' WHERE role = 'admin';
UPDATE public.user_roles SET role = 'usuario' WHERE role = 'user';

-- RLS for empresas
CREATE POLICY "Master admin full access empresas" ON public.empresas FOR ALL TO authenticated
USING (public.is_master_admin(auth.uid())) WITH CHECK (public.is_master_admin(auth.uid()));

CREATE POLICY "Company users view own empresa" ON public.empresas FOR SELECT TO authenticated
USING (id = public.get_user_empresa_id(auth.uid()));

-- Drop old event policies
DROP POLICY IF EXISTS "Everyone can view events" ON public.events;
DROP POLICY IF EXISTS "Admins can insert events" ON public.events;
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Admins can delete events" ON public.events;

-- New event policies
CREATE POLICY "View company events" ON public.events FOR SELECT TO authenticated
USING (public.is_master_admin(auth.uid()) OR empresa_id = public.get_user_empresa_id(auth.uid()));

CREATE POLICY "Admin insert events" ON public.events FOR INSERT TO authenticated
WITH CHECK (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin update events" ON public.events FOR UPDATE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin delete events" ON public.events FOR DELETE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

-- Drop old financial policies
DROP POLICY IF EXISTS "Admins can view financials" ON public.financials;
DROP POLICY IF EXISTS "Admins can insert financials" ON public.financials;
DROP POLICY IF EXISTS "Admins can update financials" ON public.financials;
DROP POLICY IF EXISTS "Admins can delete financials" ON public.financials;

-- New financial policies
CREATE POLICY "View company financials" ON public.financials FOR SELECT TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Insert company financials" ON public.financials FOR INSERT TO authenticated
WITH CHECK (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Update company financials" ON public.financials FOR UPDATE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Delete company financials" ON public.financials FOR DELETE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

-- Drop old profile policies
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- New profile policies
CREATE POLICY "View company profiles" ON public.profiles FOR SELECT TO authenticated
USING (public.is_master_admin(auth.uid()) OR auth.uid() = user_id OR empresa_id = public.get_user_empresa_id(auth.uid()));

CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admin update company profiles" ON public.profiles FOR UPDATE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

-- Drop old event_files policies
DROP POLICY IF EXISTS "Everyone can view event files" ON public.event_files;
DROP POLICY IF EXISTS "Admins can insert event files" ON public.event_files;
DROP POLICY IF EXISTS "Admins can update event files" ON public.event_files;
DROP POLICY IF EXISTS "Admins can delete event files" ON public.event_files;

-- New event_files policies
CREATE POLICY "View company event files" ON public.event_files FOR SELECT TO authenticated
USING (public.is_master_admin(auth.uid()) OR empresa_id = public.get_user_empresa_id(auth.uid()));

CREATE POLICY "Admin insert event files" ON public.event_files FOR INSERT TO authenticated
WITH CHECK (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin update event files" ON public.event_files FOR UPDATE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin delete event files" ON public.event_files FOR DELETE TO authenticated
USING (public.is_master_admin(auth.uid()) OR (public.has_role(auth.uid(), 'admin_empresa') AND empresa_id = public.get_user_empresa_id(auth.uid())));

-- Drop old user_roles policies
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;

-- New user_roles policies
CREATE POLICY "View own role" ON public.user_roles FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_master_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin_empresa'));

CREATE POLICY "Admin manage roles" ON public.user_roles FOR ALL TO authenticated
USING (public.is_master_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin_empresa'));
