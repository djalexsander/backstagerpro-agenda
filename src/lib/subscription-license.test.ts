import { describe, expect, it } from "vitest";
import {
  classifySubscriptionPlan,
  ensureSingleCommercialBasePlan,
  getSubscriptionLimitLabel,
  getSubscriptionValueLabel,
  getCustomerPlanPresentation,
  isCommercialBasePlan,
  isLifetimePlan,
} from "@/lib/subscription-license";
import { computeConsolidatedCapabilities } from "@/lib/plan-helpers";

describe("lifetime subscription helpers", () => {
  it("recognizes only the canonical lifetime periodicity", () => {
    expect(isLifetimePlan({ periodicidade: "vitalicio" })).toBe(true);
    expect(isLifetimePlan({ periodicidade: "mensal" })).toBe(false);
    expect(isLifetimePlan(null)).toBe(false);
  });

  it("presents lifetime subscriptions as non-billable", () => {
    expect(
      getSubscriptionValueLabel({ periodicidade: "vitalicio" }, 499.9),
    ).toBe("Sem cobrança");
    expect(
      getSubscriptionValueLabel({ periodicidade: "mensal" }, 99.9),
    ).toBe("R$ 99.90");
  });

  it("presents a monthly customer plan with its recurring value", () => {
    expect(getCustomerPlanPresentation({
      plan: { nome: "Plano Base", periodicidade: "mensal", valor: 99.9 },
      isOnTrial: false,
      isLifetime: false,
      isExpired: false,
      isReadOnly: false,
    })).toMatchObject({
      name: "Plano Base",
      type: "Mensal",
      status: "Ativo",
      chargeLabel: "R$ 99.90/mês",
    });
  });

  it("keeps the lifetime area active without a fictitious monthly charge", () => {
    expect(getCustomerPlanPresentation({
      plan: { nome: "Vitalícia", periodicidade: "vitalicio", valor: 499.9 },
      isOnTrial: false,
      isLifetime: true,
      isExpired: false,
      isReadOnly: false,
    })).toEqual({
      name: "Vitalícia",
      type: "Vitalício",
      status: "Ativo",
      chargeLabel: "Sem cobrança mensal",
      trialExpiresAt: null,
    });
  });

  it("shows trial status and deadline independently from a paid plan", () => {
    expect(getCustomerPlanPresentation({
      plan: null,
      isOnTrial: true,
      isLifetime: false,
      isExpired: false,
      isReadOnly: false,
      trialExpiresAt: "2026-08-24T00:00:00Z",
    })).toEqual({
      name: "Trial",
      type: "Trial",
      status: "Ativo",
      chargeLabel: "Sem cobrança durante o teste",
      trialExpiresAt: "2026-08-24T00:00:00Z",
    });
  });

  it("presents lifetime capacities as unlimited", () => {
    expect(getSubscriptionLimitLabel(5, true)).toBe("Ilimitado");
    expect(getSubscriptionLimitLabel(5, false)).toBe("5");
    expect(getSubscriptionLimitLabel(null, false)).toBe("Ilimitado");
  });

  it("ignores every base capacity for a lifetime plan", () => {
    expect(
      computeConsolidatedCapabilities(
        {
          periodicidade: "vitalicio",
          max_usuarios: 5,
          max_eventos: 30,
          storage_limit: 5,
        } as any,
        [],
      ),
    ).toMatchObject({
      maxUsuarios: null,
      maxEventos: null,
      storageLimitGb: null,
    });
  });

  it("classifies a zero-value lifetime plan as a base plan", () => {
    expect(
      classifySubscriptionPlan({
        categoria: "plano_base",
        periodicidade: "vitalicio",
        valor: 0,
        trial_days: 0,
        ativo: true,
        disponivel_novo_cadastro: false,
      }),
    ).toBe("base");
  });

  it("classifies only the seven-day plan as trial", () => {
    expect(
      classifySubscriptionPlan({
        categoria: "trial",
        periodicidade: "trial",
        valor: 0,
        trial_days: 7,
        ativo: true,
        disponivel_novo_cadastro: true,
      }),
    ).toBe("trial");
  });
});

describe("single commercial base plan helpers", () => {
  const basePlan = {
    id: "base-1",
    categoria: "plano_base",
    periodicidade: "mensal",
    ativo: true,
  };

  it("identifies only active recurring plano_base rows as commercial base", () => {
    expect(isCommercialBasePlan(basePlan)).toBe(true);
    expect(isCommercialBasePlan({ ...basePlan, periodicidade: "anual" })).toBe(true);
    expect(isCommercialBasePlan({ ...basePlan, ativo: false })).toBe(false);
    expect(isCommercialBasePlan({ ...basePlan, categoria: "legado" })).toBe(false);
  });

  it("keeps Trial and VitalÃ­cio outside the commercial base rule", () => {
    expect(
      isCommercialBasePlan({
        ...basePlan,
        categoria: "trial",
        periodicidade: "trial",
      }),
    ).toBe(false);
    expect(
      isCommercialBasePlan({ ...basePlan, periodicidade: "vitalicio" }),
    ).toBe(false);
  });

  it("accepts the first base plan and preserves editing the same row", () => {
    expect(ensureSingleCommercialBasePlan([basePlan])).toEqual([basePlan]);
    expect(
      ensureSingleCommercialBasePlan([
        { ...basePlan, periodicidade: "anual" },
      ]),
    ).toHaveLength(1);
  });

  it("fails closed instead of choosing between competing public cards", () => {
    expect(() =>
      ensureSingleCommercialBasePlan([
        basePlan,
        { ...basePlan, id: "base-2", periodicidade: "anual" },
      ]),
    ).toThrow(/mais de um plano base comercial ativo/i);
  });

  it("allows inactive historical plans alongside the active base", () => {
    expect(
      ensureSingleCommercialBasePlan([
        basePlan,
        { ...basePlan, id: "history", ativo: false },
      ]),
    ).toEqual([basePlan]);
  });
});
