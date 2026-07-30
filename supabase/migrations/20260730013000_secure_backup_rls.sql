-- Backup payloads contain financial records. Remove every existing permissive
-- policy before creating a single administrator-only tenant policy.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'backups'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.backups',
      v_policy.policyname
    );
  END LOOP;
END;
$$;

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators manage company backups"
ON public.backups
FOR ALL
TO authenticated
USING (
  public.is_master_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
)
WITH CHECK (
  public.is_master_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
);

REVOKE ALL ON TABLE public.backups FROM PUBLIC, anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.backups
  FROM authenticated;
GRANT SELECT, INSERT, DELETE
  ON TABLE public.backups
  TO authenticated;

COMMENT ON TABLE public.backups IS
  'Tenant backup payloads containing operational and financial data; accessible only to company or master administrators.';
