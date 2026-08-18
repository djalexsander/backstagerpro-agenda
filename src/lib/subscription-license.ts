export const LIFETIME_PERIODICITY = "vitalicio";

export interface SubscriptionPlanLike {
  periodicidade?: string | null;
}

export type SubscriptionPlanCategory = "trial" | "base" | "legado";

export interface ClassifiableSubscriptionPlan extends SubscriptionPlanLike {
  categoria?: string | null;
  valor: number;
  trial_days: number;
  ativo: boolean;
  disponivel_novo_cadastro: boolean;
}

export interface CommercialBasePlanLike extends SubscriptionPlanLike {
  id?: string;
  categoria?: string | null;
  ativo: boolean;
}

export const COMMERCIAL_BASE_PERIODICITIES = ["mensal", "anual"] as const;

export function isCommercialBasePlan(
  plan: CommercialBasePlanLike | null | undefined,
): boolean {
  return Boolean(
    plan?.ativo &&
      plan.categoria === "plano_base" &&
      COMMERCIAL_BASE_PERIODICITIES.includes(
        plan.periodicidade as (typeof COMMERCIAL_BASE_PERIODICITIES)[number],
      ),
  );
}

export function ensureSingleCommercialBasePlan<T extends CommercialBasePlanLike>(
  plans: readonly T[],
): T[] {
  const basePlans = plans.filter(isCommercialBasePlan);
  if (basePlans.length > 1) {
    throw new Error(
      "ConfiguraÃ§Ã£o invÃ¡lida: existe mais de um plano base comercial ativo.",
    );
  }
  return basePlans;
}

export function isLifetimePlan(
  plan: SubscriptionPlanLike | null | undefined,
): boolean {
  return plan?.periodicidade === LIFETIME_PERIODICITY;
}

export function classifySubscriptionPlan(
  plan: ClassifiableSubscriptionPlan,
): SubscriptionPlanCategory {
  if (
    plan.periodicidade === "trial" ||
    plan.categoria === "trial" ||
    (plan.trial_days > 0 && plan.valor === 0)
  ) {
    return "trial";
  }

  if (!plan.ativo) return "legado";

  if (
    plan.periodicidade === LIFETIME_PERIODICITY ||
    plan.categoria === "plano_base"
  ) {
    return "base";
  }

  return plan.disponivel_novo_cadastro ? "base" : "legado";
}

export function getSubscriptionValueLabel(
  plan: SubscriptionPlanLike | null | undefined,
  value: number,
): string {
  return isLifetimePlan(plan) ? "Sem cobrança" : `R$ ${value.toFixed(2)}`;
}

export function getSubscriptionLimitLabel(
  value: number | null | undefined,
  lifetime: boolean,
): string {
  if (lifetime || value == null) return "Ilimitado";
  return String(value);
}
