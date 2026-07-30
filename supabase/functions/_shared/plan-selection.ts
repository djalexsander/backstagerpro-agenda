export type PlanSelectionRequest =
  | { type: "free"; planId: null }
  | { type: "paid"; planId: string };

export type CompanyPlanState = {
  planId: string | null;
  needsPlanSelection: boolean;
  paymentStatus: string | null;
  trialExpiresAt: string | null;
  trialConsumedAt: string | null;
  hasPaidPlanHistory: boolean;
};

export type SelectablePaidPlan = {
  active: boolean;
  availableForSignup: boolean;
  value: number;
  periodicity: string;
};

export function assertPlanSelectionAdmin(roles: readonly unknown[]): void {
  if (roles.includes("master_admin")) {
    throw new Error("Master admin deve usar o fluxo administrativo de planos");
  }
  if (!roles.includes("admin_empresa")) {
    throw new Error("Apenas o administrador da empresa pode escolher um plano");
  }
}

export function validatePlanSelectionRequest(
  body: Record<string, unknown>,
): PlanSelectionRequest {
  if (body.tipo === "free") {
    if (body.plano_id !== undefined && body.plano_id !== null) {
      throw new Error("Trial não aceita plano_id");
    }
    return { type: "free", planId: null };
  }

  if (
    body.tipo === "paid" &&
    typeof body.plano_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.plano_id,
    )
  ) {
    return { type: "paid", planId: body.plano_id };
  }

  throw new Error("Seleção de plano inválida");
}

export function assertTrialTransitionAllowed(state: CompanyPlanState): void {
  const paymentInProgress = [
    "aguardando_pagamento",
    "pagamento_em_analise",
    "pago",
  ].includes(state.paymentStatus ?? "");

  if (
    state.planId ||
    state.trialConsumedAt ||
    state.trialExpiresAt ||
    state.hasPaidPlanHistory ||
    !state.needsPlanSelection ||
    paymentInProgress
  ) {
    throw new Error("Trial já utilizado ou transição não permitida");
  }
}

export function assertPaidPlanTransitionAllowed(
  state: CompanyPlanState,
  plan: SelectablePaidPlan,
): void {
  if (
    !plan.active ||
    !plan.availableForSignup ||
    plan.value <= 0 ||
    !["mensal", "anual", "vitalicio"].includes(plan.periodicity)
  ) {
    throw new Error("Plano indisponível para contratação");
  }

  const paymentInProgress = [
    "aguardando_pagamento",
    "pagamento_em_analise",
    "pago",
  ].includes(state.paymentStatus ?? "");
  const isInitialSelection = state.needsPlanSelection;
  const isTrialConversion =
    Boolean(state.trialConsumedAt) || Boolean(state.trialExpiresAt);

  if (
    state.planId ||
    paymentInProgress ||
    (!isInitialSelection && !isTrialConversion)
  ) {
    throw new Error("Transição de plano não permitida");
  }
}
