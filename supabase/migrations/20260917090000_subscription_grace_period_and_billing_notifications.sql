-- Vencimento flow fixes (audited in two prior read-only passes, see
-- AUDITORIA de vencimento/carencia): the current system has NO grace period
-- at all - operational write access cuts off at the exact vencimento
-- instant - and the admin_empresa never gets a reliable in-app warning
-- (check-vencimentos only writes to notificacoes_master, which is Master-only
-- by RLS + UI; NotificacoesEmpresa.tsx's own client-computed alert is gated
-- on status_pagamento <> 'pago', which never becomes true again once a
-- company completes its first payment, so it never fires for a lapsed
-- renewal - the one real-world case that matters).
--
-- This migration:
--   1. Introduces a 3-day grace period AFTER vencimento, authoritative in the
--      backend (company_has_operational_access + company_has_active_module +
--      the two capacity-limit triggers, so a company in grace keeps full
--      read/write access to its base data AND to its paid modules, not just
--      the base agenda).
--   2. Adds public.scan_subscription_billing_notifications(), a new
--      SECURITY DEFINER RPC that classifies every paid-plan company into
--      "vencendo" (1-7d before) / "vence hoje" / "carencia" (day 1-3 after)
--      / "bloqueada" (day 4+) and calls the EXISTING criar_notificacao()
--      with categoria='financeiro' - already proven admin_empresa/
--      master_admin-only by push_notifications_test.sql section 2d, not a
--      new authorization mechanism. check-vencimentos will call this RPC in
--      addition to (not instead of) its existing notificacoes_master writes.
--   3. Adds a "payment confirmed" categoria='financeiro' notification inside
--      process_asaas_payment_webhook's base_plan/renewal branches, so
--      reactivation is announced the same way.
--   4. Deliberately does NOT touch plano_bloqueado, prepare_asaas_renewal_charge
--      or any RLS on /plano's own data: the prior audit already established
--      that self-service renewal payment never depends on vencimento being
--      in the future (only on plano_bloqueado, which nothing in the
--      non-payment path ever sets true) - so it already keeps working through
--      and after the grace period. Covered by a regression test below rather
--      than by new product code, per "no acidental lockout" requirement.

-- ============================================================================
-- 1. GRACE PERIOD - single source of truth
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subscription_grace_period_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT 3 $$;

COMMENT ON FUNCTION public.subscription_grace_period_days() IS
  'Days of full read/write access granted after a paid plan''s vencimento before write access is cut. Single source of truth for the whole billing flow (access gate, module expiry, notification scan).';

-- Signed day-difference between a due instant and a reference instant,
-- ceil()-rounded: 0 = due today (now in [_due, _due+1day)), positive = days
-- remaining, negative = days elapsed since _due. Pure function of its two
-- explicit args (no clock_timestamp()/statement_timestamp() default) so it
-- stays IMMUTABLE and trivially unit-testable without wall-clock coupling.
CREATE OR REPLACE FUNCTION public.subscription_days_until_due(
  _due timestamptz,
  _now timestamptz
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ceil(EXTRACT(EPOCH FROM (_due - _now)) / 86400)::integer
$$;

COMMENT ON FUNCTION public.subscription_days_until_due(timestamptz, timestamptz) IS
  'ceil((_due - _now) / 1 day): 0 = due today, negative = days overdue. Epoch-seconds based, so it is immune to session TimeZone/DST, unlike timestamptz + interval arithmetic.';

-- True while _due is still within its grace window (due date itself counts
-- as day 0, never blocked on its own - grace adds subscription_grace_period_days()
-- MORE full days on top of that). NULL _due (no due date at all) is never
-- "within grace" - callers already require _due IS NOT NULL alongside this
-- for the cases that matter (vitalicio/trial are handled separately, never
-- via this function).
CREATE OR REPLACE FUNCTION public.subscription_within_grace(
  _due timestamptz,
  _now timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT _due IS NOT NULL
    AND public.subscription_days_until_due(_due, _now) >= -public.subscription_grace_period_days()
$$;

COMMENT ON FUNCTION public.subscription_within_grace(timestamptz, timestamptz) IS
  'Authoritative grace-period check: true through the due date and subscription_grace_period_days() full days after it. Used by company_has_operational_access (vencimento) and company_has_active_module (expires_at) so both stay consistent during grace.';

REVOKE ALL ON FUNCTION public.subscription_grace_period_days()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_days_until_due(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_within_grace(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_grace_period_days()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_days_until_due(timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_within_grace(timestamptz, timestamptz)
  TO service_role;

-- ============================================================================
-- 2. ACCESS GATE - grace-aware company_has_operational_access/company_has_active_module
-- ============================================================================
-- Bodies otherwise IDENTICAL to their true latest pre-existing definitions -
-- 20260730053000_add_lifetime_company_license.sql for
-- company_has_operational_access/check_event_limit/check_user_limit, and
-- 20260730073000_materials_inventory_stage_one.sql for
-- company_has_active_module/company_module_dependencies_satisfied (the
-- lifetime-bypass + module-dependency-aware rewrite - NOT the older, simpler
-- version in 20260730043000_enforce_backend_entitlements.sql). Every
-- `x >= statement_timestamp()` comparison against vencimento/expires_at is
-- replaced with public.subscription_within_grace(x, statement_timestamp());
-- nothing else changes. Trial access (trial_expires_at) is deliberately left
-- ungraced: a free trial is not "a payment running late".

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
    FROM public.empresas AS company
    LEFT JOIN public.planos AS plan
      ON plan.id = company.plano_id
    WHERE company.id = _empresa_id
      AND company.status = 'ativo'
      AND NOT COALESCE(company.plano_bloqueado, true)
      AND NOT COALESCE(company.precisa_escolher_plano, true)
      AND (
        (
          company.plano_id IS NULL
          AND company.trial_expires_at IS NOT NULL
          AND company.trial_expires_at >= statement_timestamp()
        )
        OR
        (
          company.plano_id IS NOT NULL
          AND plan.ativo = true
          AND (
            plan.periodicidade = 'vitalicio'
            OR (
              company.status_pagamento = 'pago'
              AND public.subscription_within_grace(company.vencimento, statement_timestamp())
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.company_module_dependencies_satisfied(
  _empresa_id uuid,
  _module_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.company_has_lifetime_subscription(_empresa_id)
    OR NOT EXISTS (
      WITH RECURSIVE required_modules(module_id) AS (
        SELECT dependency.required_module_id
        FROM public.module_dependencies AS dependency
        WHERE dependency.module_id = _module_id

        UNION

        SELECT dependency.required_module_id
        FROM public.module_dependencies AS dependency
        JOIN required_modules AS required
          ON dependency.module_id = required.module_id
      )
      SELECT 1
      FROM required_modules AS required
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.empresa_modules AS company_module
        JOIN public.module_catalog AS catalog
          ON catalog.id = company_module.module_id
        WHERE company_module.empresa_id = _empresa_id
          AND company_module.module_id = required.module_id
          AND company_module.status = 'active'
          AND catalog.ativo = true
          AND (
            company_module.expires_at IS NULL
            OR public.subscription_within_grace(company_module.expires_at, statement_timestamp())
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
    _empresa_id IS NOT NULL
    AND _feature_key IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.module_catalog AS catalog
      WHERE catalog.feature_key = _feature_key
        AND catalog.ativo = true
        AND (
          public.company_has_lifetime_subscription(_empresa_id)
          OR (
            EXISTS (
              SELECT 1
              FROM public.empresa_modules AS company_module
              WHERE company_module.empresa_id = _empresa_id
                AND company_module.module_id = catalog.id
                AND company_module.status = 'active'
                AND (
                  company_module.expires_at IS NULL
                  OR public.subscription_within_grace(company_module.expires_at, statement_timestamp())
                )
            )
            AND public.company_module_dependencies_satisfied(
              _empresa_id,
              catalog.id
            )
          )
        )
    )
$$;

COMMENT ON FUNCTION public.company_has_operational_access(uuid) IS
  'Fail-closed paid-plan/trial validation used by backend write authorization. Paid-plan branch is grace-aware (subscription_within_grace); trial branch and the vitalicio short-circuit are not.';
COMMENT ON FUNCTION public.company_has_active_module(uuid, text) IS
  'Checks an active, unexpired company module (or a lifetime license) against an active catalog entry and its dependencies. expires_at (when set) honors the same grace period as the base subscription. WRITE-side check only - see company_module_entitlement_active for reads.';
COMMENT ON FUNCTION public.company_module_dependencies_satisfied(uuid, uuid) IS
  'Recursively checks that every module a given module depends on is itself active (or the company is on a lifetime license). expires_at honors the same grace period as everywhere else.';

-- ----------------------------------------------------------------------------
-- 2.1 READ-SIDE module check - deliberately time/dependency independent
-- ----------------------------------------------------------------------------
-- Found while validating this migration: company_has_active_module's
-- expires_at check (grace-aware, correct for WRITES) was also the only
-- input to can_read_company_module, which has no business depending on
-- expiry at all - can_read_company_data never depends on
-- company_has_operational_access either (its own comment says so: "Tenant
-- read isolation; intentionally remains true during subscription read-only
-- mode"). Concretely, an Asaas-purchased module's expires_at mirrors the
-- company's own vencimento, so once grace ends (D+4+) the module's own
-- expiry lapses at the exact same instant as the company's - without this
-- fix, can_read_company_module would ALSO go false at D+4, silently hiding
-- e.g. financials data that "dados continuam disponiveis para leitura"
-- requires to stay readable. Dependency-satisfaction is left out of the read
-- check for the same reason: a dependency being deactivated should not hide
-- previously-written data either. Both were empirically confirmed by
-- subscription_grace_period_modules_validation_test.sql before this fix
-- (financials read failing at D+4) and after (passing).
CREATE OR REPLACE FUNCTION public.company_module_entitlement_active(
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
    _empresa_id IS NOT NULL
    AND _feature_key IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.module_catalog AS catalog
      WHERE catalog.feature_key = _feature_key
        AND catalog.ativo = true
        AND (
          public.company_has_lifetime_subscription(_empresa_id)
          OR EXISTS (
            SELECT 1
            FROM public.empresa_modules AS company_module
            WHERE company_module.empresa_id = _empresa_id
              AND company_module.module_id = catalog.id
              AND company_module.status = 'active'
          )
        )
    )
$$;

REVOKE ALL ON FUNCTION public.company_module_entitlement_active(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_module_entitlement_active(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.company_module_entitlement_active(uuid, text) IS
  'READ-side module check: active catalog entry + status=active (or lifetime), deliberately ignoring expires_at and module_dependencies. Reading previously-entitled module data must survive expiry/grace/dependency changes the same way core company data reads already do - only company_has_active_module (writes) is time/dependency-aware.';

-- can_read_company_module: true latest body is
-- 20260808100000_enforce_master_tenant_isolation.sql - only the module
-- check changes, from company_has_active_module to
-- company_module_entitlement_active. can_write_company_module is NOT
-- touched: writes must keep requiring the full, grace-aware,
-- dependency-aware check.
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
    AND public.can_read_company_data(_empresa_id)
    AND public.company_module_entitlement_active(_empresa_id, _feature_key)
$$;

COMMENT ON FUNCTION public.can_read_company_module(uuid, text) IS
  'Tenant read isolation for module-gated data; intentionally remains true during subscription read-only mode and past module expiry alike, mirroring can_read_company_data. can_write_company_module (unchanged) is the time/dependency-aware one.';

-- Capacity triggers: same grace-aware expires_at check, so an extra_usuarios/
-- extra_eventos module bought alongside the base plan does not lose its
-- capacity bump ahead of the base plan's own grace-extended cutoff.
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

  IF public.company_has_lifetime_subscription(NEW.empresa_id) THEN
    RETURN NEW;
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
  FROM public.empresa_modules AS company_module
  JOIN public.module_catalog AS module
    ON module.id = company_module.module_id
  WHERE company_module.empresa_id = NEW.empresa_id
    AND company_module.status = 'active'
    AND (
      company_module.expires_at IS NULL
      OR public.subscription_within_grace(company_module.expires_at, statement_timestamp())
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
  IF public.is_master_admin(auth.uid())
     OR public.company_has_lifetime_subscription(NEW.empresa_id) THEN
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
  FROM public.empresa_modules AS company_module
  JOIN public.module_catalog AS module
    ON module.id = company_module.module_id
  WHERE company_module.empresa_id = NEW.empresa_id
    AND company_module.status = 'active'
    AND (
      company_module.expires_at IS NULL
      OR public.subscription_within_grace(company_module.expires_at, statement_timestamp())
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

-- ============================================================================
-- 3. NOTIFICATIONS - billing lifecycle scan, reusing criar_notificacao
-- ============================================================================
-- categoria='financeiro' is already proven admin_empresa/master_admin-only by
-- criar_notificacao's existing fan-out (push_notifications_test.sql, section
-- 2d) - this function does not add or change any authorization rule, it only
-- decides WHEN to call the existing, already-audited primitive.

CREATE OR REPLACE FUNCTION public.scan_subscription_billing_notifications()
RETURNS TABLE(empresa_id uuid, tipo text, dias integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_today text := to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_grace integer := public.subscription_grace_period_days();
  v_company record;
  v_dias integer;
  v_tipo text;
  v_titulo text;
  v_mensagem text;
  v_notif_id uuid;
BEGIN
  FOR v_company IN
    SELECT empresa.id, empresa.nome_empresa, empresa.vencimento
    FROM public.empresas AS empresa
    JOIN public.planos AS plano
      ON plano.id = empresa.plano_id
    WHERE empresa.plano_id IS NOT NULL
      AND plano.periodicidade <> 'vitalicio'
      AND empresa.vencimento IS NOT NULL
      AND empresa.status = 'ativo'
      AND NOT COALESCE(empresa.plano_bloqueado, true)
  LOOP
    v_dias := public.subscription_days_until_due(v_company.vencimento, v_now);

    v_tipo := CASE
      WHEN v_dias > 7 THEN NULL
      WHEN v_dias >= 1 THEN 'assinatura_vencendo'
      WHEN v_dias = 0 THEN 'assinatura_vence_hoje'
      WHEN v_dias >= -v_grace THEN 'assinatura_carencia'
      ELSE 'assinatura_bloqueada'
    END;

    CONTINUE WHEN v_tipo IS NULL;

    v_titulo := CASE v_tipo
      WHEN 'assinatura_vencendo' THEN 'Mensalidade vence em breve'
      WHEN 'assinatura_vence_hoje' THEN 'Mensalidade vence hoje'
      WHEN 'assinatura_carencia' THEN 'Mensalidade em atraso'
      WHEN 'assinatura_bloqueada' THEN 'Acesso em modo somente leitura'
    END;

    v_mensagem := CASE v_tipo
      WHEN 'assinatura_vencendo' THEN
        'Sua mensalidade vence em ' || v_dias || ' dia(s), em '
          || to_char(v_company.vencimento AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
          || '. Acesse Plano & Assinatura para renovar.'
      WHEN 'assinatura_vence_hoje' THEN
        'Sua mensalidade vence hoje. Pague para evitar a entrada em carência.'
      WHEN 'assinatura_carencia' THEN
        'Sua mensalidade está em atraso há ' || abs(v_dias) || ' dia(s) (dia ' || abs(v_dias)
          || ' de ' || v_grace || ' de carência). O acesso continua normal; regularize em Plano & Assinatura antes do fim da carência.'
      WHEN 'assinatura_bloqueada' THEN
        'Sua mensalidade está vencida há ' || abs(v_dias)
          || ' dia(s) e o período de carência terminou: o acesso está em modo somente leitura. Pague em Plano & Assinatura para reativar.'
    END;

    v_notif_id := public.criar_notificacao(
      _empresa_id => v_company.id,
      _categoria => 'financeiro',
      _tipo => v_tipo,
      _titulo => v_titulo,
      _mensagem => v_mensagem,
      _referencia_tipo => 'empresa',
      _referencia_id => v_company.id,
      _rota => '/plano',
      _dedupe_key => v_tipo || ':' || v_company.id || ':' || v_today
    );

    IF v_notif_id IS NOT NULL THEN
      empresa_id := v_company.id;
      tipo := v_tipo;
      dias := v_dias;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_subscription_billing_notifications()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_subscription_billing_notifications()
  TO service_role;

COMMENT ON FUNCTION public.scan_subscription_billing_notifications() IS
  'Daily billing-lifecycle scan for paid, non-lifetime, non-blocked companies: fires categoria=financeiro criar_notificacao() calls for "vencendo" (1-7d before), "vence hoje", "carencia" (day 1..grace after) and "bloqueada" (day grace+1 after). Dedupe is per company+tipo+day via criar_notificacao''s own dedupe_key. Intended to be called once/day by check-vencimentos, in addition to (not instead of) its existing notificacoes_master writes.';

-- ============================================================================
-- 4. process_asaas_payment_webhook - add "pagamento confirmado" notification
-- ============================================================================
-- Full body otherwise identical to 20260916180000_fix_monthly_vencimento_calendar_anchor.sql
-- - the only change is one new PERFORM public.criar_notificacao(...) call
-- added at the end of the base_plan and renewal branches, right after their
-- existing system_logs insert.

CREATE OR REPLACE FUNCTION public.process_asaas_payment_webhook(
  _event_id text,
  _event_type text,
  _asaas_payment_id text,
  _provider_amount numeric,
  _external_reference text DEFAULT NULL,
  _event_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.asaas_payments%ROWTYPE;
  v_existing_event public.asaas_webhook_events%ROWTYPE;
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_batch public.module_batch_requests%ROWTYPE;
  v_item record;
  v_existing_module_id uuid;
  v_activation_time timestamptz;
  v_expiration timestamptz;
  v_cycle_start timestamptz;
  v_new_status text;
  v_action text := 'status_updated';
  v_item_count integer := 0;
  v_distinct_item_count integer := 0;
  v_items_total numeric := 0;
  v_base_item_count integer := 0;
  v_renewed_module_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  IF _event_id IS NULL
     OR length(_event_id) < 5
     OR length(_event_id) > 255
     OR _asaas_payment_id IS NULL
     OR length(_asaas_payment_id) < 5
     OR length(_asaas_payment_id) > 255 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid Asaas event or payment identifier';
  END IF;

  IF _event_type NOT IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported Asaas confirmation event';
  END IF;

  IF _provider_amount IS NULL OR _provider_amount <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid Asaas payment amount';
  END IF;

  SELECT payments.*
  INTO v_payment
  FROM public.asaas_payments AS payments
  WHERE payments.asaas_payment_id = _asaas_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF COALESCE(_external_reference, '') LIKE 'backstage_pro:%' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BACKSTAGE_PAYMENT_MAPPING_PENDING';
    END IF;

    RETURN jsonb_build_object(
      'action', 'not_backstage_pro',
      'event_id', _event_id,
      'asaas_payment_id', _asaas_payment_id
    );
  END IF;

  IF v_payment.source_app <> 'backstage_pro' THEN
    RETURN jsonb_build_object(
      'action', 'wrong_app',
      'event_id', _event_id,
      'asaas_payment_id', _asaas_payment_id
    );
  END IF;

  SELECT events.*
  INTO v_existing_event
  FROM public.asaas_webhook_events AS events
  WHERE events.id = _event_id;

  IF FOUND THEN
    IF v_existing_event.asaas_payment_id <> _asaas_payment_id
       OR v_existing_event.event_type <> _event_type THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'Asaas event identifier was reused with different data';
    END IF;

    RETURN jsonb_build_object(
      'action', 'already_processed',
      'event_id', _event_id,
      'payment_id', v_payment.id,
      'activation_status', v_payment.activation_status
    );
  END IF;

  IF round(v_payment.amount, 2) <> round(_provider_amount, 2) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ASAAS_PAYMENT_AMOUNT_MISMATCH';
  END IF;

  IF v_payment.status IN ('cancelled', 'refunded') THEN
    INSERT INTO public.asaas_webhook_events (
      id,
      internal_payment_id,
      asaas_payment_id,
      event_type,
      provider_amount,
      result
    )
    VALUES (
      _event_id,
      v_payment.id,
      _asaas_payment_id,
      _event_type,
      round(_provider_amount, 2),
      'inactive_payment'
    );

    UPDATE public.asaas_payments
    SET last_webhook_event_id = _event_id
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'action', 'inactive_payment',
      'event_id', _event_id,
      'payment_id', v_payment.id
    );
  END IF;

  v_new_status := CASE
    WHEN v_payment.status = 'received' OR _event_type = 'PAYMENT_RECEIVED'
      THEN 'received'
    ELSE 'confirmed'
  END;

  v_activation_time := COALESCE(
    v_payment.payment_confirmed_at,
    LEAST(COALESCE(_event_created_at, clock_timestamp()), clock_timestamp())
  );

  IF v_payment.activation_status <> 'completed' THEN
    SELECT companies.*
    INTO v_company
    FROM public.empresas AS companies
    WHERE companies.id = v_payment.empresa_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Company for Asaas payment no longer exists';
    END IF;

    IF v_payment.payment_type = 'base_plan' THEN
      IF v_payment.related_plano_id IS NULL THEN
        RAISE EXCEPTION 'Asaas base-plan payment has no related plan';
      END IF;

      SELECT plans.*
      INTO v_plan
      FROM public.planos AS plans
      WHERE plans.id = v_payment.related_plano_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Plan related to Asaas payment no longer exists';
      END IF;

      v_expiration := CASE v_plan.periodicidade
        WHEN 'mensal' THEN public.next_monthly_due_date(v_activation_time, EXTRACT(DAY FROM v_activation_time)::integer)
        WHEN 'anual' THEN v_activation_time + interval '1 year'
        WHEN 'vitalicio' THEN NULL
        ELSE NULL
      END;

      IF v_plan.periodicidade NOT IN ('mensal', 'anual', 'vitalicio') THEN
        RAISE EXCEPTION 'Unsupported plan periodicity';
      END IF;

      UPDATE public.empresas
      SET plano_bloqueado = false,
          status_pagamento = 'pago',
          status = 'ativo',
          plano = v_plan.nome,
          plano_id = v_plan.id,
          vencimento = v_expiration,
          data_contrato = v_activation_time,
          precisa_escolher_plano = false
      WHERE id = v_company.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_plano_ativado',
        'Plano ' || v_plan.nome || ' ativado via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'plano_id', v_plan.id
        )
      );

      PERFORM public.criar_notificacao(
        _empresa_id => v_company.id,
        _categoria => 'financeiro',
        _tipo => 'assinatura_pagamento_confirmado',
        _titulo => 'Pagamento confirmado',
        _mensagem => 'Pagamento de R$ ' || to_char(v_payment.amount, 'FM999999990.00')
          || ' confirmado. Sua assinatura está ativa até '
          || to_char(v_expiration AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
        _referencia_tipo => 'asaas_payment',
        _referencia_id => v_payment.id,
        _rota => '/plano',
        _dedupe_key => 'assinatura_pagamento_confirmado:' || v_payment.id
      );
    ELSIF v_payment.payment_type = 'renewal' THEN
      IF v_payment.related_plano_id IS NULL
         OR v_payment.renewal_competence IS NULL THEN
        RAISE EXCEPTION 'Asaas renewal payment has no plan or competence';
      END IF;

      IF v_company.plano_id IS DISTINCT FROM v_payment.related_plano_id THEN
        RAISE EXCEPTION 'Company plan changed after the renewal charge was created';
      END IF;

      SELECT plans.*
      INTO v_plan
      FROM public.planos AS plans
      WHERE plans.id = v_payment.related_plano_id;

      IF NOT FOUND OR v_plan.periodicidade <> 'mensal' THEN
        RAISE EXCEPTION 'Plan related to Asaas renewal is not monthly';
      END IF;

      SELECT
        count(*) FILTER (
          WHERE items.item_type = 'base_plan'
            AND items.related_plano_id = v_payment.related_plano_id
        )::integer,
        count(*)::integer,
        round(COALESCE(sum(items.amount), 0), 2)
      INTO v_base_item_count, v_item_count, v_items_total
      FROM public.asaas_renewal_items AS items
      WHERE items.payment_id = v_payment.id;

      IF v_base_item_count <> 1
         OR v_item_count = 0
         OR v_items_total <> round(v_payment.amount, 2) THEN
        RAISE EXCEPTION 'Asaas renewal items do not match the reserved payment';
      END IF;

      v_cycle_start := CASE
        WHEN v_company.vencimento IS NOT NULL
             AND v_company.vencimento > v_activation_time
          THEN v_company.vencimento
        ELSE v_activation_time
      END;
      v_expiration := public.next_monthly_due_date(
        v_cycle_start,
        EXTRACT(DAY FROM COALESCE(v_company.data_contrato, v_cycle_start))::integer
      );

      UPDATE public.empresas
      SET plano_bloqueado = false,
          status_pagamento = 'pago',
          status = 'ativo',
          vencimento = v_expiration,
          precisa_escolher_plano = false
      WHERE id = v_company.id;

      FOR v_item IN
        SELECT
          items.related_empresa_module_id,
          items.related_module_id
        FROM public.asaas_renewal_items AS items
        WHERE items.payment_id = v_payment.id
          AND items.item_type = 'module'
        ORDER BY items.id
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            v_company.id::text || ':module:' || v_item.related_module_id::text,
            0
          )
        );

        UPDATE public.empresa_modules
        SET expires_at = CASE
              WHEN expires_at IS NULL OR expires_at < v_expiration
                THEN v_expiration
              ELSE expires_at
            END
        WHERE id = v_item.related_empresa_module_id
          AND empresa_id = v_company.id
          AND module_id = v_item.related_module_id
          AND status = 'active';

        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        v_renewed_module_count := v_renewed_module_count + v_updated_count;
      END LOOP;

      UPDATE public.asaas_payments
      SET billing_cycle_started_at = v_cycle_start,
          billing_cycle_ends_at = v_expiration
      WHERE id = v_payment.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_mensalidade_renovada',
        'Mensalidade renovada via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'plano_id', v_plan.id,
          'renewal_competence', v_payment.renewal_competence,
          'billing_cycle_started_at', v_cycle_start,
          'billing_cycle_ends_at', v_expiration,
          'renewed_module_count', v_renewed_module_count
        )
      );

      PERFORM public.criar_notificacao(
        _empresa_id => v_company.id,
        _categoria => 'financeiro',
        _tipo => 'assinatura_pagamento_confirmado',
        _titulo => 'Pagamento confirmado',
        _mensagem => 'Pagamento de R$ ' || to_char(v_payment.amount, 'FM999999990.00')
          || ' confirmado. Sua mensalidade foi renovada até '
          || to_char(v_expiration AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
        _referencia_tipo => 'asaas_payment',
        _referencia_id => v_payment.id,
        _rota => '/plano',
        _dedupe_key => 'assinatura_pagamento_confirmado:' || v_payment.id
      );
    ELSIF v_payment.payment_type = 'modules' THEN
      IF v_payment.related_batch_request_id IS NULL THEN
        RAISE EXCEPTION 'Asaas module payment has no related batch';
      END IF;

      SELECT batches.*
      INTO v_batch
      FROM public.module_batch_requests AS batches
      WHERE batches.id = v_payment.related_batch_request_id
        AND batches.empresa_id = v_company.id
        AND batches.payment_method = 'asaas'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trusted Asaas module batch was not found';
      END IF;

      IF v_batch.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Asaas module batch is not activatable';
      END IF;

      SELECT
        count(*)::integer,
        count(DISTINCT module_id)::integer,
        round(COALESCE(sum(valor), 0), 2)
      INTO v_item_count, v_distinct_item_count, v_items_total
      FROM public.module_batch_request_items
      WHERE batch_request_id = v_batch.id;

      IF v_item_count = 0
         OR v_item_count <> v_distinct_item_count
         OR v_items_total <> round(v_payment.amount, 2) THEN
        RAISE EXCEPTION 'Asaas module batch does not match the reserved payment';
      END IF;

      IF v_payment.related_module_id IS NOT NULL AND (
        v_item_count <> 1
        OR NOT EXISTS (
          SELECT 1
          FROM public.module_batch_request_items
          WHERE batch_request_id = v_batch.id
            AND module_id = v_payment.related_module_id
        )
      ) THEN
        RAISE EXCEPTION 'Asaas module batch does not match the related module';
      END IF;

      FOR v_item IN
        SELECT module_id, valor
        FROM public.module_batch_request_items
        WHERE batch_request_id = v_batch.id
        ORDER BY id
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            v_company.id::text || ':module:' || v_item.module_id::text,
            0
          )
        );

        v_existing_module_id := NULL;
        SELECT modules.id
        INTO v_existing_module_id
        FROM public.empresa_modules AS modules
        WHERE modules.empresa_id = v_company.id
          AND modules.module_id = v_item.module_id
          AND modules.status = 'active'
        ORDER BY modules.created_at DESC
        LIMIT 1
        FOR UPDATE;

        IF NOT FOUND THEN
          SELECT modules.id
          INTO v_existing_module_id
          FROM public.empresa_modules AS modules
          WHERE modules.empresa_id = v_company.id
            AND modules.module_id = v_item.module_id
            AND modules.status <> 'active'
          ORDER BY modules.created_at DESC
          LIMIT 1
          FOR UPDATE;

          IF FOUND THEN
            UPDATE public.empresa_modules
            SET status = 'active',
                activated_at = v_activation_time,
                valor_cobrado = v_item.valor,
                origem = 'asaas_pagamento',
                granted_by_admin = false,
                trial_granted = false,
                expires_at = v_company.vencimento
            WHERE id = v_existing_module_id;
          ELSE
            INSERT INTO public.empresa_modules (
              empresa_id,
              module_id,
              status,
              activated_at,
              valor_cobrado,
              origem,
              granted_by_admin,
              trial_granted,
              expires_at
            )
            VALUES (
              v_company.id,
              v_item.module_id,
              'active',
              v_activation_time,
              v_item.valor,
              'asaas_pagamento',
              false,
              false,
              v_company.vencimento
            );
          END IF;
        END IF;
      END LOOP;

      UPDATE public.module_batch_requests
      SET status = 'approved',
          approved_at = COALESCE(approved_at, v_activation_time)
      WHERE id = v_batch.id;

      INSERT INTO public.system_logs (
        tipo,
        acao,
        descricao,
        empresa_id,
        empresa_nome,
        dados
      )
      VALUES (
        'pagamento',
        'asaas_modulos_ativados',
        v_item_count || ' modulo(s) ativado(s) via pagamento Asaas para '
          || v_company.nome_empresa,
        v_company.id,
        v_company.nome_empresa,
        jsonb_build_object(
          'payment_id', v_payment.id,
          'asaas_payment_id', _asaas_payment_id,
          'event_id', _event_id,
          'batch_request_id', v_batch.id,
          'module_count', v_item_count
        )
      );
    ELSE
      RAISE EXCEPTION 'Unsupported Asaas payment type';
    END IF;

    INSERT INTO public.notificacoes_master (
      empresa_id,
      tipo,
      mensagem,
      dados
    )
    VALUES (
      v_company.id,
      'pagamento_confirmado',
      'Pagamento Asaas confirmado: R$ '
        || to_char(v_payment.amount, 'FM999999990D00')
        || ' (' || v_payment.payment_type || ') - '
        || v_company.nome_empresa,
      jsonb_build_object(
        'payment_id', v_payment.id,
        'asaas_payment_id', _asaas_payment_id,
        'event_id', _event_id,
        'payment_type', v_payment.payment_type,
        'amount', v_payment.amount
      )
    );

    v_action := 'activated';
  END IF;

  UPDATE public.asaas_payments
  SET status = v_new_status,
      payment_confirmed_at = COALESCE(payment_confirmed_at, v_activation_time),
      activation_status = 'completed',
      activation_completed_at = COALESCE(
        activation_completed_at,
        clock_timestamp()
      ),
      last_webhook_event_id = _event_id,
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'phase', 'activated',
          'last_webhook_event', _event_type
        )
  WHERE id = v_payment.id;

  INSERT INTO public.asaas_webhook_events (
    id,
    internal_payment_id,
    asaas_payment_id,
    event_type,
    provider_amount,
    result
  )
  VALUES (
    _event_id,
    v_payment.id,
    _asaas_payment_id,
    _event_type,
    round(_provider_amount, 2),
    v_action
  );

  RETURN jsonb_build_object(
    'action', v_action,
    'event_id', _event_id,
    'payment_id', v_payment.id,
    'payment_status', v_new_status,
    'activation_status', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_asaas_payment_webhook(
  text, text, text, numeric, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_asaas_payment_webhook(
  text, text, text, numeric, text, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.process_asaas_payment_webhook(
  text, text, text, numeric, text, timestamptz
) IS
  'Atomically records an Asaas confirmation and activates an initial plan, module purchase, or one monthly renewal. Renewal cycles and module expirations are advanced once only. base_plan/renewal branches also fire a categoria=financeiro "pagamento confirmado" notification to admin_empresa/master_admin.';
