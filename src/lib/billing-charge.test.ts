import { describe, expect, it } from "vitest";
import {
  assertBillingAdmin,
  toTrustedCurrencyAmount,
  validateBillingChargeRequest,
} from "../../supabase/functions/_shared/billing-charge";

const planId = "123e4567-e89b-42d3-a456-426614174000";
const moduleId = "223e4567-e89b-42d3-a456-426614174000";

describe("Asaas billing security", () => {
  it("accepts exactly one server-resolved resource identifier", () => {
    expect(validateBillingChargeRequest({ plano_id: planId })).toEqual({
      kind: "base_plan",
      resourceId: planId,
    });
    expect(validateBillingChargeRequest({ modulo_id: moduleId })).toEqual({
      kind: "modules",
      resourceId: moduleId,
    });
    expect(() => validateBillingChargeRequest({})).toThrow(/exatamente um/i);
    expect(() =>
      validateBillingChargeRequest({ plano_id: planId, modulo_id: moduleId }),
    ).toThrow(/somente plano_id ou modulo_id/i);
    expect(() =>
      validateBillingChargeRequest({ plano_id: planId, modulo_id: null }),
    ).toThrow(/somente plano_id ou modulo_id/i);
  });

  it("rejects browser-controlled amount, description, due date and tenant", () => {
    for (const field of [
      "amount",
      "description",
      "due_date",
      "empresa_id",
      "payment_type",
      "related_batch_request_id",
    ]) {
      expect(() =>
        validateBillingChargeRequest({ plano_id: planId, [field]: "attacker" }),
      ).toThrow(/somente plano_id ou modulo_id/i);
    }
  });

  it("rejects malformed identifiers", () => {
    expect(() =>
      validateBillingChargeRequest({ plano_id: "not-a-uuid" }),
    ).toThrow(/válido/i);
    expect(() =>
      validateBillingChargeRequest({ modulo_id: "../other-company" }),
    ).toThrow(/válido/i);
  });

  it("allows only company administrators to create charges", () => {
    expect(() => assertBillingAdmin(["admin_empresa"])).not.toThrow();
    expect(() => assertBillingAdmin(["usuario"])).toThrow(/administrador/i);
    expect(() =>
      assertBillingAdmin(["master_admin", "admin_empresa"]),
    ).toThrow(/fluxo financeiro/i);
  });

  it("uses only a positive database price rounded to cents", () => {
    expect(toTrustedCurrencyAmount(99.9)).toBe(99.9);
    expect(toTrustedCurrencyAmount("49.999")).toBe(50);
    expect(() => toTrustedCurrencyAmount(0)).toThrow(/preço inválido/i);
    expect(() => toTrustedCurrencyAmount(-1)).toThrow(/preço inválido/i);
    expect(() => toTrustedCurrencyAmount("not-a-price")).toThrow(
      /preço inválido/i,
    );
  });
});
