-- Codex review (cycle 2) flagged two real problems with the Master panel's
-- "editar empresa" flow:
--
-- 1. Editing an existing Vitalícia company calls
--    set_company_lifetime_subscription (which unconditionally forces
--    status = 'ativo' as part of establishing the license baseline), then a
--    *separate* client-side UPDATE tries to apply the master's actually
--    chosen status afterwards. If that second call ever fails, the company
--    is left stuck "ativo" no matter what the master picked. The same
--    always-'ativo' comparison also makes the function treat every edit of
--    an already-canonical-but-currently-inativo Vitalícia company as "not
--    yet granted", re-inserting a licenca_vitalicia_concedida system_logs
--    row on every single edit even though the license itself never changed.
--
-- 2. provision_company_module_entitlements checks "does at least one
--    empresa_modules row exist for this (empresa, module)" and inserts one
--    if not, but that check-then-insert is not serialized: two concurrent
--    callers for the same company (e.g. two master edits, or an edit
--    racing the AFTER INSERT trigger) can both see no row and both insert
--    an 'inactive' entitlement, since the unique index on empresa_modules
--    only covers status = 'active' rows.
--
-- Fix (1): let the caller pass the target status into
-- set_company_lifetime_subscription so it is applied atomically in the same
-- transaction as the grant, and stop factoring status into the "already
-- granted" comparison so re-invoking on an unchanged license never
-- re-logs. The company-creation call site never passes _status, so it keeps
-- defaulting to 'ativo' exactly as before.
--
-- Fix (2): serialize provisioning per company with a transaction-scoped
-- advisory lock, so a second concurrent call always observes the first
-- call's inserts (or lack thereof) instead of racing it.

DROP FUNCTION IF EXISTS public.set_company_lifetime_subscription(uuid);

CREATE OR REPLACE FUNCTION public.set_company_lifetime_subscription(
  _empresa_id uuid,
  _status text DEFAULT 'ativo'
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
  v_status text := COALESCE(NULLIF(_status, ''), 'ativo');
BEGIN
  IF v_status NOT IN ('ativo', 'inativo') THEN
    RAISE EXCEPTION 'Invalid company status: %', v_status;
  END IF;

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

  -- Status is intentionally excluded from this comparison: it is a
  -- separate, freely editable field on an already-lifetime company, not
  -- part of whether the license itself was granted.
  v_already_lifetime :=
    v_company.plano_id = v_plan.id
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
      status = v_status,
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
    'status', v_status,
    'status_pagamento', 'isento',
    'vencimento', NULL,
    'todos_modulos', true,
    'limites_ilimitados', true,
    'alterado', NOT v_already_lifetime
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_lifetime_subscription(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_lifetime_subscription(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.set_company_lifetime_subscription(uuid, text) IS
  'Idempotently grants the separate, canonical, non-billable lifetime plan and applies the caller-selected company status atomically. Master admin only.';

DO $$
DECLARE
  v_fn regprocedure := 'public.set_company_lifetime_subscription(uuid, text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN132',
      MESSAGE = 'Hardening falhou: set_company_lifetime_subscription executavel por anon.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN133',
      MESSAGE = 'set_company_lifetime_subscription nao esta executavel por authenticated.';
  END IF;
END;
$$;

-- Fix (2): serialize provisioning per company so concurrent callers cannot
-- both observe "no row yet" for the same (empresa, module) pair. The lock
-- is transaction-scoped (released automatically at COMMIT/ROLLBACK) and
-- keyed by empresa_id, so unrelated companies never block each other.
CREATE OR REPLACE FUNCTION public.provision_company_module_entitlements(
  _empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_record public.empresas%ROWTYPE;
  v_lifetime boolean;
  v_module_record public.module_catalog%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('provision_company_module_entitlements'),
    hashtext(_empresa_id::text)
  );

  SELECT *
  INTO v_company_record
  FROM public.empresas
  WHERE id = _empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT public.company_has_lifetime_subscription(_empresa_id)
  INTO v_lifetime;

  IF v_lifetime THEN
    RETURN;
  END IF;

  FOR v_module_record IN
    SELECT *
    FROM public.module_catalog
    WHERE ativo = true
    ORDER BY ordem, created_at
  LOOP
    -- Only existence is needed here, so PERFORM avoids the fragile
    -- positional column-count matching a SELECT ... INTO %ROWTYPE requires
    -- (a prior version selected 10 columns into the 12-field empresa_modules
    -- %ROWTYPE, misaligning every field from trial_granted onward).
    PERFORM 1
    FROM public.empresa_modules
    WHERE empresa_id = _empresa_id
      AND module_id = v_module_record.id
    LIMIT 1;

    IF FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.empresa_modules (
      empresa_id,
      module_id,
      status,
      activated_at,
      expires_at,
      granted_by_admin,
      valor_cobrado,
      origem,
      trial_granted
    )
    VALUES (
      _empresa_id,
      v_module_record.id,
      'inactive',
      NULL,
      NULL,
      false,
      COALESCE(v_module_record.valor, 0),
      'provisioning',
      false
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.provision_company_module_entitlements(uuid) IS
'Provision canonical module entitlements for a company without granting paid modules automatically. Lifetime companies are bypassed. Serialized per company via advisory lock to avoid concurrent duplicate inserts.';
