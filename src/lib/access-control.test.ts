import { describe, expect, it } from "vitest";
import {
  getCompanyAccessState,
  hasCompanyOperationalAccess,
  getSubscriptionRedirect,
  getWaitingPaymentRedirect,
  type CompanyAccessRecord,
} from "@/lib/access-control";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function company(overrides: Partial<CompanyAccessRecord> = {}): CompanyAccessRecord {
  return {
    plano_id: "plan-id",
    plano_bloqueado: false,
    trial_expires_at: null,
    status: "ativo",
    status_pagamento: "pago",
    vencimento: "2026-08-29T12:00:00.000Z",
    precisa_escolher_plano: false,
    ...overrides,
  };
}

describe("company access and redirects", () => {
  it("mirrors backend operational access for paid, trial and lifetime companies", () => {
    expect(hasCompanyOperationalAccess(company(), NOW)).toBe(true);
    expect(
      hasCompanyOperationalAccess(
        company({
          plano_id: null,
          trial_expires_at: "2026-08-01T12:00:00.000Z",
          status_pagamento: null,
          vencimento: null,
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      hasCompanyOperationalAccess(
        company({
          plan_periodicity: "vitalicio",
          status_pagamento: "isento",
          vencimento: null,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps master stock read-only when the selected company is not operational", () => {
    expect(
      hasCompanyOperationalAccess(
        company({ status_pagamento: "pendente" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      hasCompanyOperationalAccess(
        company({ precisa_escolher_plano: true }),
        NOW,
      ),
    ).toBe(false);
    expect(
      hasCompanyOperationalAccess(company({ status: "inativo" }), NOW),
    ).toBe(false);
  });

  it("keeps an active, paid company on the requested route", () => {
    const state = getCompanyAccessState(company(), NOW);

    expect(state).toEqual({
      blocked: false,
      expired: false,
      inGracePeriod: false,
      needsPlanSelection: false,
      paymentStatus: "pago",
    });
    expect(
      getSubscriptionRedirect({
        pathname: "/agenda",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
    expect(
      getWaitingPaymentRedirect({
        isMasterAdmin: false,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBe("/agenda");
  });

  it("never expires a lifetime company even if legacy data has a due date", () => {
    const state = getCompanyAccessState(
      company({
        plan_periodicity: "vitalicio",
        vencimento: "2020-01-01T00:00:00.000Z",
        status_pagamento: "isento",
      }),
      NOW,
    );

    expect(state.expired).toBe(false);
    expect(state.blocked).toBe(false);
  });

  it("keeps a pending company on the waiting page without redirect loop", () => {
    const state = getCompanyAccessState(
      company({
        plano_bloqueado: true,
        status_pagamento: "aguardando_pagamento",
      }),
      NOW,
    );

    expect(state.blocked).toBe(true);
    expect(
      getSubscriptionRedirect({
        pathname: "/agenda",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBe("/aguardando-pagamento");
    expect(
      getSubscriptionRedirect({
        pathname: "/aguardando-pagamento",
        skipPlanCheck: true,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
    expect(
      getWaitingPaymentRedirect({
        isMasterAdmin: false,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
  });

  it("keeps a 1-day-overdue company inside its grace period: expired but not blocked", () => {
    const state = getCompanyAccessState(
      company({ vencimento: "2026-07-28T12:00:00.000Z" }), // D+1
      NOW,
    );

    expect(state.expired).toBe(true);
    expect(state.inGracePeriod).toBe(true);
    expect(state.blocked).toBe(false);
    expect(
      getSubscriptionRedirect({
        pathname: "/evento/novo",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
  });

  it("blocks write routes once the grace period is over and sends them to the plan page", () => {
    const state = getCompanyAccessState(
      company({ vencimento: "2026-07-25T12:00:00.000Z" }), // D+4
      NOW,
    );

    expect(state.expired).toBe(true);
    expect(state.inGracePeriod).toBe(false);
    expect(state.blocked).toBe(true);
    expect(
      getSubscriptionRedirect({
        pathname: "/agenda",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
    expect(
      getSubscriptionRedirect({
        pathname: "/evento/novo",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBe("/plano");
  });

  it("handles an explicitly blocked company without bouncing away from the plan page", () => {
    const state = getCompanyAccessState(company({ plano_bloqueado: true }), NOW);

    expect(state.expired).toBe(false);
    expect(state.blocked).toBe(true);
    expect(
      getSubscriptionRedirect({
        pathname: "/plano",
        skipPlanCheck: false,
        isMasterAdmin: false,
        companyBlocked: state.blocked,
        needsPlanSelection: state.needsPlanSelection,
        paymentStatus: state.paymentStatus,
      }),
    ).toBeNull();
  });

  it("sends a company that still needs a plan from waiting to plan selection", () => {
    expect(
      getWaitingPaymentRedirect({
        isMasterAdmin: false,
        needsPlanSelection: true,
        paymentStatus: "pendente",
      }),
    ).toBe("/escolher-plano");
  });
});

describe("subscription grace period (D / D+1 / D+2 / D+3 / D+4)", () => {
  // Same worked example as the spec: vencimento 2026-07-29 -> grace
  // 2026-07-30/31, 2026-08-01 -> blocked from 2026-08-02. Expressed here as
  // offsets from a fixed "now" so it never depends on the real date.
  const DUE_DATE = "2026-07-29T00:00:00.000Z";
  const dayOffset = (days: number) => new Date(Date.parse(DUE_DATE) + days * 86400000);

  it.each([
    ["D (due date itself)", 0, true],
    ["D+1 (grace day 1)", 1, true],
    ["D+2 (grace day 2)", 2, true],
    ["D+3 (grace day 3, last grace day)", 3, true],
    ["D+4 (grace over)", 4, false],
    ["D+10 (long overdue, stays blocked)", 10, false],
  ])("%s: hasCompanyOperationalAccess is %s", (_label, offsetDays, expectedAccess) => {
    const now = dayOffset(offsetDays);
    expect(
      hasCompanyOperationalAccess(company({ vencimento: DUE_DATE }), now),
    ).toBe(expectedAccess);

    const state = getCompanyAccessState(company({ vencimento: DUE_DATE }), now);
    expect(state.blocked).toBe(!expectedAccess);
  });

  it("flags D+1..D+3 as inGracePeriod, and neither D nor D+4 as such", () => {
    expect(getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(0)).inGracePeriod).toBe(false);
    expect(getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(1)).inGracePeriod).toBe(true);
    expect(getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(2)).inGracePeriod).toBe(true);
    expect(getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(3)).inGracePeriod).toBe(true);
    expect(getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(4)).inGracePeriod).toBe(false);
  });

  it("never grants grace to trial expiry - a lapsed trial blocks immediately", () => {
    const trialCompany = company({
      plano_id: null,
      trial_expires_at: DUE_DATE,
      status_pagamento: null,
      vencimento: null,
    });
    expect(hasCompanyOperationalAccess(trialCompany, dayOffset(0))).toBe(true);
    expect(hasCompanyOperationalAccess(trialCompany, dayOffset(1))).toBe(false);
    expect(getCompanyAccessState(trialCompany, dayOffset(1)).inGracePeriod).toBe(false);
  });

  it("/plano stays reachable at every phase, including D+4 and beyond", () => {
    for (const offsetDays of [0, 1, 2, 3, 4, 10]) {
      const state = getCompanyAccessState(company({ vencimento: DUE_DATE }), dayOffset(offsetDays));
      expect(
        getSubscriptionRedirect({
          pathname: "/plano",
          skipPlanCheck: false,
          isMasterAdmin: false,
          companyBlocked: state.blocked,
          needsPlanSelection: state.needsPlanSelection,
          paymentStatus: state.paymentStatus,
        }),
      ).toBeNull();
    }
  });
});
