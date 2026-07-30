-- A permanent trial-consumption marker prevents a paid transition from
-- erasing the only evidence that an empresa has already used its trial.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_consumed_at timestamptz;

UPDATE public.empresas
SET trial_started_at = COALESCE(
      trial_started_at,
      trial_expires_at - interval '7 days',
      created_at
    ),
    trial_consumed_at = COALESCE(
      trial_consumed_at,
      trial_expires_at - interval '7 days',
      created_at
    )
WHERE trial_expires_at IS NOT NULL
  AND trial_consumed_at IS NULL;

WITH historical_trials AS (
  SELECT empresa_id, min(created_at) AS started_at
  FROM public.system_logs
  WHERE acao = 'trial_ativado'
    AND empresa_id IS NOT NULL
  GROUP BY empresa_id
)
UPDATE public.empresas AS empresas
SET trial_started_at = COALESCE(
      empresas.trial_started_at,
      historical_trials.started_at
    ),
    trial_consumed_at = COALESCE(
      empresas.trial_consumed_at,
      historical_trials.started_at
    )
FROM historical_trials
WHERE empresas.id = historical_trials.empresa_id
  AND empresas.trial_consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.choose_company_plan(
  _actor_id uuid,
  _selection_type text,
  _plan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.empresas%ROWTYPE;
  v_plan public.planos%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_due_at timestamptz;
  v_trial_end timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'master_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Master admin must use the administrative plan flow';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _actor_id
      AND role = 'admin_empresa'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Only a company administrator can choose a plan';
  END IF;

  SELECT empresas.*
  INTO v_company
  FROM public.empresas AS empresas
  JOIN public.profiles AS profiles
    ON profiles.empresa_id = empresas.id
  WHERE profiles.user_id = _actor_id
  FOR UPDATE OF empresas;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated administrator has no company';
  END IF;

  IF _selection_type = 'free' THEN
    IF _plan_id IS NOT NULL
       OR v_company.plano_id IS NOT NULL
       OR v_company.trial_consumed_at IS NOT NULL
       OR v_company.trial_expires_at IS NOT NULL
       OR NOT v_company.precisa_escolher_plano
       OR EXISTS (
         SELECT 1
         FROM public.pagamentos
         WHERE empresa_id = v_company.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.system_logs
         WHERE empresa_id = v_company.id
           AND acao = 'plano_solicitado'
       )
       OR COALESCE(v_company.status_pagamento, '') IN (
         'aguardando_pagamento',
         'pagamento_em_analise',
         'pago'
       ) THEN
      RAISE EXCEPTION 'Trial already used or transition is not allowed';
    END IF;

    v_trial_end := v_now + interval '7 days';

    UPDATE public.empresas
    SET plano = 'Teste Free 7 dias',
        plano_id = NULL,
        trial_started_at = v_now,
        trial_consumed_at = v_now,
        trial_expires_at = v_trial_end,
        vencimento = v_trial_end,
        precisa_escolher_plano = false,
        plano_bloqueado = false,
        status = 'ativo',
        status_pagamento = NULL
    WHERE id = v_company.id;

    RETURN jsonb_build_object(
      'tipo', 'free',
      'empresa_id', v_company.id,
      'empresa_nome', v_company.nome_empresa,
      'trial_expires_at', v_trial_end
    );
  END IF;

  IF _selection_type <> 'paid' OR _plan_id IS NULL THEN
    RAISE EXCEPTION 'Invalid plan selection';
  END IF;

  SELECT planos.*
  INTO v_plan
  FROM public.planos AS planos
  WHERE planos.id = _plan_id
    AND planos.ativo = true
    AND planos.disponivel_novo_cadastro = true
    AND planos.valor > 0
    AND planos.periodicidade IN ('mensal', 'anual', 'vitalicio')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan is not available for signup';
  END IF;

  IF v_company.plano_id IS NOT NULL
     OR COALESCE(v_company.status_pagamento, '') IN (
       'aguardando_pagamento',
       'pagamento_em_analise',
       'pago'
     )
     OR NOT (
       v_company.precisa_escolher_plano
       OR v_company.trial_consumed_at IS NOT NULL
       OR v_company.trial_expires_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Paid plan transition is not allowed';
  END IF;

  CASE v_plan.periodicidade
    WHEN 'mensal' THEN v_due_at := v_now + interval '30 days';
    WHEN 'anual' THEN v_due_at := v_now + interval '1 year';
    WHEN 'vitalicio' THEN v_due_at := NULL;
  END CASE;

  UPDATE public.empresas
  SET precisa_escolher_plano = false,
      plano_bloqueado = true,
      status_pagamento = 'aguardando_pagamento',
      plano = v_plan.nome,
      plano_id = v_plan.id,
      trial_expires_at = NULL,
      data_contrato = v_now::date,
      vencimento = v_due_at,
      status = 'ativo'
  WHERE id = v_company.id;

  PERFORM public.deactivate_trial_modules(v_company.id);

  RETURN jsonb_build_object(
    'tipo', 'paid',
    'empresa_id', v_company.id,
    'empresa_nome', v_company.nome_empresa,
    'plano_id', v_plan.id,
    'plano_nome', v_plan.nome,
    'vencimento', v_due_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.choose_company_plan(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.choose_company_plan(uuid, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.choose_company_plan(uuid, text, uuid) IS
  'Atomically validates and applies initial trial or paid-plan transitions.';

CREATE OR REPLACE FUNCTION public.protect_company_subscription_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_service boolean :=
    current_user IN ('postgres', 'supabase_admin', 'service_role')
    OR current_setting('request.jwt.claim.role', true) = 'service_role';
  v_is_master boolean :=
    auth.uid() IS NOT NULL AND public.is_master_admin(auth.uid());
  v_sensitive_change boolean;
BEGIN
  IF v_is_service OR v_is_master THEN
    RETURN NEW;
  END IF;

  v_sensitive_change :=
    OLD.plano IS DISTINCT FROM NEW.plano
    OR OLD.plano_id IS DISTINCT FROM NEW.plano_id
    OR OLD.plano_bloqueado IS DISTINCT FROM NEW.plano_bloqueado
    OR OLD.trial_started_at IS DISTINCT FROM NEW.trial_started_at
    OR OLD.trial_consumed_at IS DISTINCT FROM NEW.trial_consumed_at
    OR OLD.trial_expires_at IS DISTINCT FROM NEW.trial_expires_at
    OR OLD.vencimento IS DISTINCT FROM NEW.vencimento
    OR OLD.precisa_escolher_plano IS DISTINCT FROM NEW.precisa_escolher_plano
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.data_contrato IS DISTINCT FROM NEW.data_contrato;

  IF v_sensitive_change THEN
    RAISE EXCEPTION 'Subscription fields can only be changed by a trusted server flow';
  END IF;

  IF OLD.status_pagamento IS DISTINCT FROM NEW.status_pagamento THEN
    IF OLD.status_pagamento = 'aguardando_pagamento'
       AND NEW.status_pagamento = 'pagamento_em_analise'
       AND EXISTS (
         SELECT 1
         FROM public.pagamentos
         WHERE empresa_id = OLD.id
           AND plano_id = OLD.plano_id
           AND status = 'pendente'
           AND comprovante_path IS NOT NULL
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid direct payment-status transition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_company_subscription_fields
  ON public.empresas;
CREATE TRIGGER protect_company_subscription_fields
BEFORE UPDATE ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.protect_company_subscription_fields();

COMMENT ON FUNCTION public.protect_company_subscription_fields() IS
  'Blocks authenticated clients from bypassing trusted subscription workflows.';
