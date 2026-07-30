import { describe, expect, it } from "vitest";
import {
  classifySubscriptionPlan,
  getSubscriptionLimitLabel,
  getSubscriptionValueLabel,
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
