-- Backend authorization is authoritative. The frontend may still hide or
-- disable features for usability, but direct PostgREST and Storage requests
-- must satisfy the same tenant, subscription and module rules.
--
-- Subscription semantics:
--   * blocked/inactive/expired companies retain read-only access to their data;
--   * operational writes require an active paid plan or an unexpired trial;
--   * billing, plan selection and module purchase tables remain writable so a
--     blocked company can recover access;
--   * master administrators retain their existing operational bypass.

CREATE OR REPLACE FUNCTION public.company_has_operational_access(
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.empresas AS empresa
    LEFT JOIN public.planos AS plano
      ON plano.id = empresa.plano_id
    WHERE empresa.id = _empresa_id
      AND empresa.status = 'ativo'
      AND NOT COALESCE(empresa.plano_bloqueado, true)
      AND NOT COALESCE(empresa.precisa_escolher_plano, true)
      AND (
        (
          empresa.plano_id IS NULL
          AND empresa.trial_expires_at IS NOT NULL
          AND empresa.trial_expires_at >= statement_timestamp()
        )
        OR
        (
          empresa.plano_id IS NOT NULL
          AND plano.ativo = true
          AND empresa.status_pagamento = 'pago'
          AND (
            plano.periodicidade = 'vitalicio'
            OR (
              empresa.vencimento IS NOT NULL
              AND empresa.vencimento >= statement_timestamp()
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.company_has_active_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    _feature_key IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.empresa_modules AS empresa_module
      JOIN public.module_catalog AS module
        ON module.id = empresa_module.module_id
      WHERE empresa_module.empresa_id = _empresa_id
        AND module.feature_key = _feature_key
        AND module.ativo = true
        AND empresa_module.status = 'active'
        AND (
          empresa_module.expires_at IS NULL
          OR empresa_module.expires_at >= statement_timestamp()
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_read_company_data(
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_master_admin(auth.uid())
      OR _empresa_id = public.get_user_empresa_id(auth.uid())
    )
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_data(
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_master_admin(auth.uid())
      OR (
        public.has_role(
          auth.uid(),
          'admin_empresa'::public.app_role
        )
        AND _empresa_id = public.get_user_empresa_id(auth.uid())
        AND public.company_has_operational_access(_empresa_id)
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_read_company_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_master_admin(auth.uid())
      OR (
        public.can_read_company_data(_empresa_id)
        AND public.company_has_active_module(_empresa_id, _feature_key)
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_module(
  _empresa_id uuid,
  _feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_master_admin(auth.uid())
      OR (
        public.can_write_company_data(_empresa_id)
        AND public.company_has_active_module(_empresa_id, _feature_key)
      )
    )
$$;

-- Service-role Edge Functions bypass RLS. Sensitive functions must call this
-- assertion with the authenticated actor before changing operational data.
CREATE OR REPLACE FUNCTION public.assert_actor_company_operational_access(
  _actor_id uuid,
  _empresa_id uuid,
  _feature_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF _actor_id IS NULL OR _empresa_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor and company are required';
  END IF;

  IF public.is_master_admin(_actor_id) THEN
    RETURN;
  END IF;

  IF NOT public.has_role(
    _actor_id,
    'admin_empresa'::public.app_role
  ) OR public.get_user_empresa_id(_actor_id) IS DISTINCT FROM _empresa_id THEN
    RAISE EXCEPTION 'Actor is not an administrator of the active company';
  END IF;

  IF NOT public.company_has_operational_access(_empresa_id) THEN
    RAISE EXCEPTION 'Company subscription does not allow operational writes';
  END IF;

  IF _feature_key IS NOT NULL
     AND NOT public.company_has_active_module(_empresa_id, _feature_key) THEN
    RAISE EXCEPTION 'Required company module is not active: %', _feature_key;
  END IF;
END;
$$;

-- Cross-tenant relationship checks. Row-level empresa_id alone is not enough:
-- a caller must not be able to attach its row to another company's parent UUID.
CREATE OR REPLACE FUNCTION public.event_belongs_to_company(
  _event_id uuid,
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events
    WHERE id = _event_id
      AND empresa_id = _empresa_id
  )
$$;

CREATE OR REPLACE FUNCTION public.event_day_belongs_to_event(
  _event_day_id uuid,
  _event_id uuid,
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    _event_day_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.event_days
      WHERE id = _event_day_id
        AND event_id = _event_id
        AND empresa_id = _empresa_id
    )
$$;

CREATE OR REPLACE FUNCTION public.employee_belongs_to_company(
  _funcionario_id uuid,
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.funcionarios
    WHERE id = _funcionario_id
      AND empresa_id = _empresa_id
  )
$$;

CREATE OR REPLACE FUNCTION public.template_belongs_to_company(
  _template_id uuid,
  _empresa_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    _template_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.document_templates
      WHERE id = _template_id
        AND empresa_id = _empresa_id
    )
$$;

REVOKE ALL ON FUNCTION public.company_has_operational_access(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_has_active_module(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_belongs_to_company(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_day_belongs_to_event(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employee_belongs_to_company(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.template_belongs_to_company(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_read_company_data(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_company_data(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_company_module(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_company_module(uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_read_company_data(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_company_data(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_company_module(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_company_module(uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION
  public.assert_actor_company_operational_access(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.assert_actor_company_operational_access(uuid, uuid, text)
  TO service_role;

-- Existing capacity triggers remain authoritative for plan limits, but expired
-- or disabled capacity modules must no longer increase those limits.
CREATE OR REPLACE FUNCTION public.check_event_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_max_eventos integer;
  v_extra_eventos integer;
  v_current_count integer;
  v_plano_id uuid;
BEGIN
  IF public.is_master_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_has_operational_access(NEW.empresa_id) THEN
    RAISE EXCEPTION
      'Company subscription does not allow event creation';
  END IF;

  SELECT plano_id
  INTO v_plano_id
  FROM public.empresas
  WHERE id = NEW.empresa_id;

  IF v_plano_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_eventos
  INTO v_max_eventos
  FROM public.planos
  WHERE id = v_plano_id
    AND ativo = true;

  IF v_max_eventos IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(module.capacidade_extra_eventos), 0)
  INTO v_extra_eventos
  FROM public.empresa_modules AS empresa_module
  JOIN public.module_catalog AS module
    ON module.id = empresa_module.module_id
  WHERE empresa_module.empresa_id = NEW.empresa_id
    AND empresa_module.status = 'active'
    AND (
      empresa_module.expires_at IS NULL
      OR empresa_module.expires_at >= statement_timestamp()
    )
    AND module.ativo = true
    AND module.is_capacity_module = true
    AND module.capacidade_extra_eventos > 0;

  v_max_eventos := v_max_eventos + v_extra_eventos;

  SELECT count(*)
  INTO v_current_count
  FROM public.events
  WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_eventos THEN
    RAISE EXCEPTION
      'Company event limit reached (% of %)',
      v_current_count,
      v_max_eventos;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_max_usuarios integer;
  v_extra_usuarios integer;
  v_current_count integer;
  v_plano_id uuid;
BEGIN
  IF public.is_master_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  SELECT plano_id
  INTO v_plano_id
  FROM public.empresas
  WHERE id = NEW.empresa_id;

  IF v_plano_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_usuarios
  INTO v_max_usuarios
  FROM public.planos
  WHERE id = v_plano_id
    AND ativo = true;

  IF v_max_usuarios IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(module.capacidade_extra_usuarios), 0)
  INTO v_extra_usuarios
  FROM public.empresa_modules AS empresa_module
  JOIN public.module_catalog AS module
    ON module.id = empresa_module.module_id
  WHERE empresa_module.empresa_id = NEW.empresa_id
    AND empresa_module.status = 'active'
    AND (
      empresa_module.expires_at IS NULL
      OR empresa_module.expires_at >= statement_timestamp()
    )
    AND module.ativo = true
    AND module.is_capacity_module = true
    AND module.capacidade_extra_usuarios > 0;

  v_max_usuarios := v_max_usuarios + v_extra_usuarios;

  SELECT count(*)
  INTO v_current_count
  FROM public.empresa_usuarios
  WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_usuarios THEN
    RAISE EXCEPTION
      'Company user limit reached (% of %)',
      v_current_count,
      v_max_usuarios;
  END IF;

  RETURN NEW;
END;
$$;

-- Remove every permissive policy on the protected operational tables. Adding a
-- restrictive-looking policy without doing this would be ineffective because
-- PostgreSQL combines permissive policies with OR.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'events',
        'event_days',
        'event_files',
        'financials',
        'funcionarios',
        'event_funcionarios',
        'event_checklist_items',
        'document_templates',
        'generated_documents',
        'backups',
        'empresa_modules',
        'empresa_usuarios'
      ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END;
$$;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_usuarios ENABLE ROW LEVEL SECURITY;

-- Membership writes are server-managed by create-user/delete-user. Allowing a
-- tenant administrator to write this projection directly would bypass those
-- endpoints and their subscription, role and audit checks.
CREATE POLICY "Master administrators manage company memberships"
ON public.empresa_usuarios FOR ALL TO authenticated
USING (public.is_master_admin(auth.uid()))
WITH CHECK (public.is_master_admin(auth.uid()));

CREATE POLICY "Tenant administrators read company memberships"
ON public.empresa_usuarios FOR SELECT TO authenticated
USING (
  public.is_master_admin(auth.uid())
  OR user_id = auth.uid()
  OR (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    AND empresa_id = public.get_user_empresa_id(auth.uid())
  )
);

-- Module entitlements themselves cannot be activated by a company client.
-- The legacy onboarding flow may create a pending request-shaped row, while
-- only master/service-role flows may activate, update or remove entitlements.
CREATE POLICY "Master administrators manage module entitlements"
ON public.empresa_modules FOR ALL TO authenticated
USING (public.is_master_admin(auth.uid()))
WITH CHECK (public.is_master_admin(auth.uid()));

CREATE POLICY "Tenant users read module entitlements"
ON public.empresa_modules FOR SELECT TO authenticated
USING (public.can_read_company_data(empresa_id));

CREATE POLICY "Tenant administrators request pending onboarding modules"
ON public.empresa_modules FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
  AND empresa_id = public.get_user_empresa_id(auth.uid())
  AND status = 'pending'
  AND activated_at IS NULL
  AND expires_at IS NULL
  AND granted_by_admin = false
  AND trial_granted = false
  AND origem = 'onboarding'
);

-- Core agenda data: tenant reads survive a subscription block; writes do not.
CREATE POLICY "Tenant users read events"
ON public.events FOR SELECT TO authenticated
USING (public.can_read_company_data(empresa_id));

CREATE POLICY "Active tenant administrators insert events"
ON public.events FOR INSERT TO authenticated
WITH CHECK (public.can_write_company_data(empresa_id));

CREATE POLICY "Active tenant administrators update events"
ON public.events FOR UPDATE TO authenticated
USING (public.can_write_company_data(empresa_id))
WITH CHECK (public.can_write_company_data(empresa_id));

CREATE POLICY "Active tenant administrators delete events"
ON public.events FOR DELETE TO authenticated
USING (public.can_write_company_data(empresa_id));

CREATE POLICY "Tenant users read event days"
ON public.event_days FOR SELECT TO authenticated
USING (public.can_read_company_data(empresa_id));

CREATE POLICY "Active tenant administrators insert event days"
ON public.event_days FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_data(empresa_id)
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Active tenant administrators update event days"
ON public.event_days FOR UPDATE TO authenticated
USING (public.can_write_company_data(empresa_id))
WITH CHECK (
  public.can_write_company_data(empresa_id)
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Active tenant administrators delete event days"
ON public.event_days FOR DELETE TO authenticated
USING (public.can_write_company_data(empresa_id));

CREATE POLICY "Tenant users read event file metadata"
ON public.event_files FOR SELECT TO authenticated
USING (public.can_read_company_data(empresa_id));

CREATE POLICY "Active tenant administrators insert event file metadata"
ON public.event_files FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_data(empresa_id)
  AND public.event_belongs_to_company(event_id, empresa_id)
  AND public.event_day_belongs_to_event(
    event_day_id,
    event_id,
    empresa_id
  )
);

CREATE POLICY "Active tenant administrators update event file metadata"
ON public.event_files FOR UPDATE TO authenticated
USING (public.can_write_company_data(empresa_id))
WITH CHECK (
  public.can_write_company_data(empresa_id)
  AND public.event_belongs_to_company(event_id, empresa_id)
  AND public.event_day_belongs_to_event(
    event_day_id,
    event_id,
    empresa_id
  )
);

CREATE POLICY "Active tenant administrators delete event file metadata"
ON public.event_files FOR DELETE TO authenticated
USING (public.can_write_company_data(empresa_id));

-- Financial data is administrator-only and requires financeiro_avancado.
CREATE POLICY "Licensed tenant administrators read financials"
ON public.financials FOR SELECT TO authenticated
USING (
  public.is_master_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    AND public.can_read_company_module(
      empresa_id,
      'financeiro_avancado'
    )
  )
);

CREATE POLICY "Licensed active tenant administrators insert financials"
ON public.financials FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(
    empresa_id,
    'financeiro_avancado'
  )
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Licensed active tenant administrators update financials"
ON public.financials FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(
    empresa_id,
    'financeiro_avancado'
  )
)
WITH CHECK (
  public.can_write_company_module(
    empresa_id,
    'financeiro_avancado'
  )
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Licensed active tenant administrators delete financials"
ON public.financials FOR DELETE TO authenticated
USING (
  public.can_write_company_module(
    empresa_id,
    'financeiro_avancado'
  )
);

-- Employees and event team assignments are shared by finance, checklist and
-- the operational panel. Any one of those modules grants visibility.
CREATE POLICY "Licensed tenant users read employees"
ON public.funcionarios FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_read_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_read_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed active tenant administrators insert employees"
ON public.funcionarios FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_write_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed active tenant administrators update employees"
ON public.funcionarios FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_write_company_module(empresa_id, 'painel_operacional')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_write_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed active tenant administrators delete employees"
ON public.funcionarios FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_write_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed tenant users read event teams"
ON public.event_funcionarios FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_read_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_read_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed active tenant administrators insert event teams"
ON public.event_funcionarios FOR INSERT TO authenticated
WITH CHECK (
  (
    public.can_write_company_module(empresa_id, 'financeiro_avancado')
    OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
    OR public.can_write_company_module(empresa_id, 'painel_operacional')
  )
  AND public.event_belongs_to_company(event_id, empresa_id)
  AND public.employee_belongs_to_company(funcionario_id, empresa_id)
);

CREATE POLICY "Licensed active tenant administrators delete event teams"
ON public.event_funcionarios FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'financeiro_avancado')
  OR public.can_write_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_write_company_module(empresa_id, 'painel_operacional')
);

-- Checklist is a distinct paid data surface.
CREATE POLICY "Licensed tenant users read checklist items"
ON public.event_checklist_items FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'checklist_tecnico')
  OR public.can_read_company_module(empresa_id, 'painel_operacional')
);

CREATE POLICY "Licensed active tenant administrators insert checklist items"
ON public.event_checklist_items FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'checklist_tecnico')
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Licensed active tenant administrators update checklist items"
ON public.event_checklist_items FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'checklist_tecnico')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'checklist_tecnico')
  AND public.event_belongs_to_company(event_id, empresa_id)
);

CREATE POLICY "Licensed active tenant administrators delete checklist items"
ON public.event_checklist_items FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'checklist_tecnico')
);

-- Advanced documents are isolated from the core event record.
CREATE POLICY "Licensed tenant users read document templates"
ON public.document_templates FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'documentos_avancados')
);

CREATE POLICY "Licensed active tenant administrators insert templates"
ON public.document_templates FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
);

CREATE POLICY "Licensed active tenant administrators update templates"
ON public.document_templates FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
);

CREATE POLICY "Licensed active tenant administrators delete templates"
ON public.document_templates FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
);

CREATE POLICY "Licensed tenant users read generated documents"
ON public.generated_documents FOR SELECT TO authenticated
USING (
  public.can_read_company_module(empresa_id, 'documentos_avancados')
);

CREATE POLICY "Licensed active tenant administrators insert documents"
ON public.generated_documents FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
  AND public.template_belongs_to_company(template_id, empresa_id)
  AND (
    event_id IS NULL
    OR public.event_belongs_to_company(event_id, empresa_id)
  )
);

CREATE POLICY "Licensed active tenant administrators update documents"
ON public.generated_documents FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
  AND public.template_belongs_to_company(template_id, empresa_id)
  AND (
    event_id IS NULL
    OR public.event_belongs_to_company(event_id, empresa_id)
  )
);

CREATE POLICY "Licensed active tenant administrators delete documents"
ON public.generated_documents FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'documentos_avancados')
);

-- Backups contain financial data and require both an administrator role and
-- the reports module. Blocked companies can read/export existing backups, but
-- cannot create, restore (writes to operational tables), or delete them.
CREATE POLICY "Licensed tenant administrators read backups"
ON public.backups FOR SELECT TO authenticated
USING (
  public.is_master_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin_empresa'::public.app_role)
    AND public.can_read_company_module(empresa_id, 'relatorios')
  )
);

CREATE POLICY "Licensed active tenant administrators insert backups"
ON public.backups FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'relatorios')
);

CREATE POLICY "Licensed active tenant administrators delete backups"
ON public.backups FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'relatorios')
);

-- Storage policies from the event-files hardening migration call this helper.
-- Replacing it makes direct object writes honor the company subscription too.
CREATE OR REPLACE FUNCTION public.can_manage_event_storage_object(
  _file_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_valid_event_storage_path(_file_path)
    AND EXISTS (
      SELECT 1
      FROM public.events AS event
      WHERE event.id::text = split_part(_file_path, '/', 1)
        AND public.can_write_company_data(event.empresa_id)
    )
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_storage_object(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_event_storage_object(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.company_has_operational_access(uuid) IS
  'Fail-closed paid-plan/trial validation used by backend write authorization.';
COMMENT ON FUNCTION public.company_has_active_module(uuid, text) IS
  'Checks an active, unexpired company module against an active catalog entry.';
COMMENT ON FUNCTION public.can_read_company_data(uuid) IS
  'Tenant read isolation; intentionally remains true during subscription read-only mode.';
COMMENT ON FUNCTION public.can_write_company_data(uuid) IS
  'Tenant administrator write authorization with active subscription validation.';
COMMENT ON FUNCTION public.can_write_company_module(uuid, text) IS
  'Tenant administrator write authorization with subscription and module validation.';
