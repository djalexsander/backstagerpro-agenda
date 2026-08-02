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

  it("keeps an expired company read-only and sends write routes to the plan page", () => {
    const state = getCompanyAccessState(
      company({ vencimento: "2026-07-28T12:00:00.000Z" }),
      NOW,
    );

    expect(state.expired).toBe(true);
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
