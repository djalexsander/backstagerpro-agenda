-- Separate the public seven-day trial from the administrative lifetime plan.
--
-- The preceding lifetime migration was installed in a database that did not
-- contain a plan row representing the free trial. This corrective migration:
--   * restores that first zero-value row as the public trial;
--   * creates a distinct, non-public lifetime plan;
--   * keeps only the explicitly named company on the lifetime plan;
--   * makes both the data repair and the canonical RPC idempotent.

ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS categoria text;

UPDATE public.planos
SET categoria = CASE
  WHEN periodicidade = 'trial' OR trial_days > 0 THEN 'trial'
  ELSE 'plano_base'
END
WHERE categoria IS NULL;

ALTER TABLE public.planos
  ALTER COLUMN categoria SET DEFAULT 'plano_base',
  ALTER COLUMN categoria SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'planos_categoria_check'
      AND conrelid = 'public.planos'::regclass
  ) THEN
    ALTER TABLE public.planos
      ADD CONSTRAINT planos_categoria_check
      CHECK (categoria IN ('trial', 'plano_base', 'legado'));
  END IF;
END;
$$;

DO $$
DECLARE
  v_trial_plan_id uuid;
  v_previous_lifetime_id uuid;
  v_lifetime_plan_id uuid;
  v_target_company_count integer;
BEGIN
  SELECT plan.id
  INTO v_trial_plan_id
  FROM public.planos AS plan
  WHERE plan.periodicidade = 'trial'
     OR plan.categoria = 'trial'
  ORDER BY
    CASE WHEN plan.periodicidade = 'trial' THEN 0 ELSE 1 END,
    plan.created_at,
    plan.id
  LIMIT 1
  FOR UPDATE;

  SELECT plan.id
  INTO v_previous_lifetime_id
  FROM public.planos AS plan
  WHERE plan.periodicidade = 'vitalicio'
    AND lower(plan.nome) IN ('vitalícia', 'vitalicia')
  ORDER BY plan.created_at, plan.id
  LIMIT 1
  FOR UPDATE;

  -- On databases affected by the previous migration there is no trial row.
  -- Reuse that migration-created row as the missing original trial, then
  -- create a new lifetime row with its own UUID.
  IF v_trial_plan_id IS NULL AND v_previous_lifetime_id IS NOT NULL THEN
    UPDATE public.planos
    SET nome = 'Teste Gratuito de 7 Dias',
        valor = 0,
        descricao = 'Teste gratuito por 7 dias.',
        max_usuarios = 5,
        max_eventos = 20,
        ativo = true,
        trial_days = 7,
        storage_limit = 5,
        periodicidade = 'trial',
        disponivel_novo_cadastro = true,
        categoria = 'trial',
        updated_at = clock_timestamp()
    WHERE id = v_previous_lifetime_id;

    v_trial_plan_id := v_previous_lifetime_id;
  ELSIF v_trial_plan_id IS NULL THEN
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
      disponivel_novo_cadastro,
      categoria
    )
    VALUES (
      'Teste Gratuito de 7 Dias',
      0,
      'Teste gratuito por 7 dias.',
      5,
      20,
      true,
      7,
      5,
      'trial',
      true,
      'trial'
    )
    RETURNING id INTO v_trial_plan_id;
  ELSE
    UPDATE public.planos
    SET nome = 'Teste Gratuito de 7 Dias',
        valor = 0,
        descricao = 'Teste gratuito por 7 dias.',
        max_usuarios = 5,
        max_eventos = 20,
        ativo = true,
        trial_days = 7,
        storage_limit = 5,
        periodicidade = 'trial',
        disponivel_novo_cadastro = true,
        categoria = 'trial',
        updated_at = clock_timestamp()
    WHERE id = v_trial_plan_id;
  END IF;

  SELECT plan.id
  INTO v_lifetime_plan_id
  FROM public.planos AS plan
  WHERE plan.periodicidade = 'vitalicio'
    AND lower(plan.nome) IN ('vitalícia', 'vitalicia')
  ORDER BY plan.created_at, plan.id
  LIMIT 1
  FOR UPDATE;

  IF v_lifetime_plan_id IS NULL THEN
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
      disponivel_novo_cadastro,
      categoria
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
      false,
      'plano_base'
    )
    RETURNING id INTO v_lifetime_plan_id;
  ELSE
    UPDATE public.planos
    SET nome = 'Vitalícia',
        valor = 0,
        descricao = 'Licença permanente com todos os módulos e capacidades ilimitadas.',
        max_usuarios = NULL,
        max_eventos = NULL,
        ativo = true,
        trial_days = 0,
        storage_limit = NULL,
        periodicidade = 'vitalicio',
        disponivel_novo_cadastro = false,
        categoria = 'plano_base',
        updated_at = clock_timestamp()
    WHERE id = v_lifetime_plan_id;
  END IF;

  IF v_trial_plan_id = v_lifetime_plan_id THEN
    RAISE EXCEPTION 'Trial and lifetime plans must have different IDs';
  END IF;

  SELECT count(*)
  INTO v_target_company_count
  FROM public.empresas
  WHERE nome_empresa = '64.257.267 ALEX SANDRO XAVIER VIEIRA';

  IF v_target_company_count > 1 THEN
    RAISE EXCEPTION
      'More than one company matches the lifetime conversion target';
  END IF;

  UPDATE public.empresas
  SET plano = 'Vitalícia',
      plano_id = v_lifetime_plan_id,
      plano_bloqueado = false,
      precisa_escolher_plano = false,
      status = 'ativo',
      status_pagamento = 'isento',
      vencimento = NULL,
      trial_expires_at = NULL
  WHERE nome_empresa = '64.257.267 ALEX SANDRO XAVIER VIEIRA';
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS planos_single_trial_idx
  ON public.planos ((1))
  WHERE periodicidade = 'trial';

CREATE UNIQUE INDEX IF NOT EXISTS planos_single_lifetime_idx
  ON public.planos ((1))
  WHERE periodicidade = 'vitalicio';

CREATE OR REPLACE FUNCTION public.protect_canonical_subscription_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.periodicidade NOT IN ('trial', 'vitalicio') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.periodicidade = 'vitalicio' THEN
      RAISE EXCEPTION 'The canonical lifetime plan cannot be deleted';
    END IF;
    RAISE EXCEPTION 'The canonical trial plan cannot be deleted';
  END IF;

  IF OLD.periodicidade = 'vitalicio'
     AND (
       NEW.nome IS DISTINCT FROM 'Vitalícia'
     OR NEW.periodicidade IS DISTINCT FROM 'vitalicio'
     OR NEW.categoria IS DISTINCT FROM 'plano_base'
     OR NEW.valor IS DISTINCT FROM 0::numeric
     OR NEW.max_usuarios IS NOT NULL
     OR NEW.max_eventos IS NOT NULL
     OR NEW.storage_limit IS NOT NULL
     OR NEW.trial_days IS DISTINCT FROM 0
     OR NEW.disponivel_novo_cadastro IS DISTINCT FROM false
     OR NEW.ativo IS DISTINCT FROM true
     ) THEN
    RAISE EXCEPTION
      'Canonical lifetime plan fields are protected';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_canonical_subscription_plan
  ON public.planos;
CREATE TRIGGER protect_canonical_subscription_plan
BEFORE UPDATE OR DELETE ON public.planos
FOR EACH ROW
EXECUTE FUNCTION public.protect_canonical_subscription_plan();

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
    AND plan.categoria = 'plano_base'
    AND plan.ativo = true
    AND plan.disponivel_novo_cadastro = false
    AND plan.valor = 0
    AND plan.max_usuarios IS NULL
    AND plan.max_eventos IS NULL
    AND plan.storage_limit IS NULL
    AND plan.trial_days = 0
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
  'Idempotently grants the separate, canonical, non-billable lifetime plan. Master admin only.';
