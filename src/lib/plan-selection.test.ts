import { describe, expect, it } from "vitest";
import {
  assertPaidPlanTransitionAllowed,
  assertPlanSelectionAdmin,
  assertTrialTransitionAllowed,
  validatePlanSelectionRequest,
} from "../../supabase/functions/_shared/plan-selection";

const newCompany = {
  planId: null,
  needsPlanSelection: true,
  paymentStatus: "pendente",
  trialExpiresAt: null,
  trialConsumedAt: null,
  hasPaidPlanHistory: false,
};

const paidPlan = {
  active: true,
  availableForSignup: true,
  value: 99,
  periodicity: "mensal",
};

describe("choose-plan security", () => {
  it("allows only a company administrator", () => {
    expect(() => assertPlanSelectionAdmin(["admin_empresa"])).not.toThrow();
    expect(() => assertPlanSelectionAdmin(["usuario"])).toThrow(
      /administrador da empresa/i,
    );
    expect(() =>
      assertPlanSelectionAdmin(["master_admin", "admin_empresa"]),
    ).toThrow(/fluxo administrativo/i);
  });

  it("validates the public request shape", () => {
    expect(validatePlanSelectionRequest({ tipo: "free" })).toEqual({
      type: "free",
      planId: null,
    });
    expect(
      validatePlanSelectionRequest({
        tipo: "paid",
        plano_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toEqual({
      type: "paid",
      planId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(() =>
      validatePlanSelectionRequest({ tipo: "free", plano_id: "unexpected" }),
    ).toThrow(/não aceita/i);
    expect(() =>
      validatePlanSelectionRequest({ tipo: "paid", plano_id: "invalid" }),
    ).toThrow(/inválida/i);
  });

  it("allows a trial only once from the initial state", () => {
    expect(() => assertTrialTransitionAllowed(newCompany)).not.toThrow();
    expect(() =>
      assertTrialTransitionAllowed({
        ...newCompany,
        needsPlanSelection: false,
        trialConsumedAt: "2026-07-01T00:00:00Z",
        trialExpiresAt: null,
      }),
    ).toThrow(/já utilizado/i);
    expect(() =>
      assertTrialTransitionAllowed({
        ...newCompany,
        trialExpiresAt: "2026-08-01T00:00:00Z",
      }),
    ).toThrow(/já utilizado/i);
    expect(() =>
      assertTrialTransitionAllowed({
        ...newCompany,
        planId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toThrow(/não permitida/i);
    expect(() =>
      assertTrialTransitionAllowed({
        ...newCompany,
        hasPaidPlanHistory: true,
      }),
    ).toThrow(/não permitida/i);
  });

  it("allows only initial paid selection or conversion from trial", () => {
    expect(() =>
      assertPaidPlanTransitionAllowed(newCompany, paidPlan),
    ).not.toThrow();
    expect(() =>
      assertPaidPlanTransitionAllowed(
        {
          ...newCompany,
          needsPlanSelection: false,
          trialConsumedAt: "2026-07-01T00:00:00Z",
        },
        paidPlan,
      ),
    ).not.toThrow();
    expect(() =>
      assertPaidPlanTransitionAllowed(
        {
          ...newCompany,
          needsPlanSelection: false,
          paymentStatus: "aguardando_pagamento",
        },
        paidPlan,
      ),
    ).toThrow(/não permitida/i);
  });

  it("rejects inactive, free, legacy and malformed paid plans", () => {
    expect(() =>
      assertPaidPlanTransitionAllowed(newCompany, {
        ...paidPlan,
        active: false,
      }),
    ).toThrow(/indisponível/i);
    expect(() =>
      assertPaidPlanTransitionAllowed(newCompany, {
        ...paidPlan,
        availableForSignup: false,
      }),
    ).toThrow(/indisponível/i);
    expect(() =>
      assertPaidPlanTransitionAllowed(newCompany, { ...paidPlan, value: 0 }),
    ).toThrow(/indisponível/i);
    expect(() =>
      assertPaidPlanTransitionAllowed(newCompany, {
        ...paidPlan,
        periodicity: "semanal",
      }),
    ).toThrow(/indisponível/i);
  });
});
