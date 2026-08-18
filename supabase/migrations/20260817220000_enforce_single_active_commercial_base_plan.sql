-- P1-1: there may be at most one active recurring commercial base plan.
-- Trial and the canonical lifetime license have their own existing rules;
-- inactive/legacy rows remain available for historical company references.

DO $$
DECLARE
  v_duplicate_count integer;
  v_duplicate_plans text;
BEGIN
  SELECT count(*),
         string_agg(format('%s (%s)', plan.nome, plan.id), ', ' ORDER BY plan.created_at, plan.id)
  INTO v_duplicate_count, v_duplicate_plans
  FROM public.planos AS plan
  WHERE plan.categoria = 'plano_base'
    AND plan.ativo = true
    AND plan.periodicidade IN ('mensal', 'anual');

  IF v_duplicate_count > 1 THEN
    RAISE EXCEPTION
      'Cannot enforce a single active commercial base plan: % matching plans found: %',
      v_duplicate_count,
      v_duplicate_plans
      USING
        ERRCODE = '23514',
        HINT = 'Explicitly keep one plan active and mark the others inactive or legado, then rerun this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX planos_single_active_commercial_base_idx
  ON public.planos ((1))
  WHERE categoria = 'plano_base'
    AND ativo = true
    AND periodicidade IN ('mensal', 'anual');

COMMENT ON INDEX public.planos_single_active_commercial_base_idx IS
  'Allows at most one active recurring commercial base plan; excludes Trial, Vitalicio, inactive and legado history.';
