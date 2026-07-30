-- Official lifetime company license.
--
-- A lifetime license is an administrative entitlement, not a billable plan:
--   * it has no expiration or recurring charge;
--   * every current and future module feature is licensed;
--   * event, user and storage capacities are unlimited;
--   * only a global master administrator may grant it.

INSERT INTO public.planos (
  nome,
  valor,
  descricao,
  max_usuarios,
  max_eventos,
  ativo,
  trial_days,
  storage_limit,
  periodicidade,
  disponivel_novo_cadastro
)
VALUES (
  'Vitalícia',
  0,
  'Licença permanente com todos os módulos e capacidades ilimitadas.',
  NULL,
  NULL,
  true,
  0,
  NULL,
  'vitalicio',
  false
)
ON CONFLICT (nome) DO UPDATE
SET valor = EXCLUDED.valor,
    descricao = EXCLUDED.descricao,
    max_usuarios = EXCLUDED.max_usuarios,
    max_eventos = EXCLUDED.max_eventos,
    ativo = EXCLUDED.ativo,
    trial_days = EXCLUDED.trial_days,
    storage_limit = EXCLUDED.storage_limit,
    periodicidade = EXCLUDED.periodicidade,
    disponivel_novo_cadastro = EXCLUDED.disponivel_novo_cadastro,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.company_has_lifetime_subscription(
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
    JOIN public.planos AS plan
      ON plan.id = company.plano_id
    WHERE company.id = _empresa_id
      AND plan.ativo = true
      AND plan.periodicidade = 'vitalicio'
  )
$$;

REVOKE ALL ON FUNCTION public.company_has_lifetime_subscription(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_has_lifetime_subscription(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.company_has_lifetime_subscription(uuid) IS
  'Returns whether a company is assigned to an active lifetime plan.';

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
              AND company.vencimento IS NOT NULL
              AND company.vencimento >= statement_timestamp()
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
    AND (
      public.company_has_lifetime_subscription(_empresa_id)
      OR EXISTS (
        SELECT 1
        FROM public.empresa_modules AS company_module
        JOIN public.module_catalog AS module
          ON module.id = company_module.module_id
        WHERE company_module.empresa_id = _empresa_id
          AND module.feature_key = _feature_key
          AND module.ativo = true
          AND company_module.status = 'active'
          AND (
            company_module.expires_at IS NULL
            OR company_module.expires_at >= statement_timestamp()
          )
      )
    )
$$;

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
      OR company_module.expires_at >= statement_timestamp()
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
      OR company_module.expires_at >= statement_timestamp()
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

CREATE OR REPLACE FUNCTION public.reject_lifetime_company_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.company_has_lifetime_subscription(NEW.empresa_id) THEN
    RAISE EXCEPTION
      'Lifetime companies do not accept plan or module charges';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_lifetime_pagamento
  ON public.pagamentos;
CREATE TRIGGER reject_lifetime_pagamento
BEFORE INSERT ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public.reject_lifetime_company_charge();

DROP TRIGGER IF EXISTS reject_lifetime_asaas_payment
  ON public.asaas_payments;
CREATE TRIGGER reject_lifetime_asaas_payment
BEFORE INSERT ON public.asaas_payments
FOR EACH ROW EXECUTE FUNCTION public.reject_lifetime_company_charge();

DROP TRIGGER IF EXISTS reject_lifetime_module_request
  ON public.module_requests;
CREATE TRIGGER reject_lifetime_module_request
BEFORE INSERT ON public.module_requests
FOR EACH ROW EXECUTE FUNCTION public.reject_lifetime_company_charge();

DROP TRIGGER IF EXISTS reject_lifetime_module_payment
  ON public.module_payments;
CREATE TRIGGER reject_lifetime_module_payment
BEFORE INSERT ON public.module_payments
FOR EACH ROW EXECUTE FUNCTION public.reject_lifetime_company_charge();

DROP TRIGGER IF EXISTS reject_lifetime_module_batch_request
  ON public.module_batch_requests;
CREATE TRIGGER reject_lifetime_module_batch_request
BEFORE INSERT ON public.module_batch_requests
FOR EACH ROW EXECUTE FUNCTION public.reject_lifetime_company_charge();

CREATE OR REPLACE FUNCTION public.set_company_lifetime_subscription(
  _empresa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_already_lifetime boolean;
BEGIN
  IF v_actor_id IS NULL
     OR NOT public.is_master_admin(v_actor_id) THEN
    RAISE EXCEPTION
      'Only a global master administrator can grant a lifetime license';
  END IF;

  SELECT company.*
  INTO v_company
  FROM public.empresas AS company
  WHERE company.id = _empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company was not found';
  END IF;

  SELECT plan.*
  INTO v_plan
  FROM public.planos AS plan
  WHERE plan.nome = 'Vitalícia'
    AND plan.periodicidade = 'vitalicio'
    AND plan.ativo = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Official lifetime plan is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payment
    WHERE payment.empresa_id = _empresa_id
      AND payment.status IN ('pending', 'overdue')
      AND payment.asaas_payment_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Company has an open provider charge that must be cancelled first';
  END IF;

  v_already_lifetime :=
    v_company.plano_id = v_plan.id
    AND v_company.status = 'ativo'
    AND NOT COALESCE(v_company.plano_bloqueado, true)
    AND NOT COALESCE(v_company.precisa_escolher_plano, true)
    AND v_company.status_pagamento = 'isento'
    AND v_company.vencimento IS NULL
    AND v_company.trial_expires_at IS NULL;

  UPDATE public.asaas_payments
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'cancel_reason', 'company_granted_lifetime_license'
        )
  WHERE empresa_id = _empresa_id
    AND status = 'pending'
    AND asaas_payment_id IS NULL;

  UPDATE public.pagamentos
  SET status = 'cancelado',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pendente';

  UPDATE public.module_requests
  SET status = 'cancelled',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  UPDATE public.module_payments
  SET status = 'cancelled',
      updated_at = clock_timestamp()
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  UPDATE public.module_batch_requests
  SET status = 'cancelled'
  WHERE empresa_id = _empresa_id
    AND status = 'pending';

  UPDATE public.empresas
  SET plano = v_plan.nome,
      plano_id = v_plan.id,
      plano_bloqueado = false,
      precisa_escolher_plano = false,
      status = 'ativo',
      status_pagamento = 'isento',
      vencimento = NULL,
      trial_expires_at = NULL,
      data_contrato = COALESCE(data_contrato, current_date)
  WHERE id = _empresa_id;

  IF NOT v_already_lifetime THEN
    INSERT INTO public.system_logs (
      tipo,
      acao,
      descricao,
      user_id,
      empresa_id,
      empresa_nome,
      dados
    )
    VALUES (
      'plano',
      'licenca_vitalicia_concedida',
      'Licença Vitalícia concedida para ' || v_company.nome_empresa,
      v_actor_id,
      v_company.id,
      v_company.nome_empresa,
      jsonb_build_object(
        'plano_anterior_id', v_company.plano_id,
        'plano_anterior', v_company.plano,
        'plano_vitalicio_id', v_plan.id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'plano_id', v_plan.id,
    'plano_nome', v_plan.nome,
    'periodicidade', v_plan.periodicidade,
    'status_pagamento', 'isento',
    'vencimento', NULL,
    'todos_modulos', true,
    'limites_ilimitados', true,
    'alterado', NOT v_already_lifetime
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_lifetime_subscription(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_lifetime_subscription(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.set_company_lifetime_subscription(uuid) IS
  'Idempotently grants the official non-billable lifetime license. Master admin only.';
