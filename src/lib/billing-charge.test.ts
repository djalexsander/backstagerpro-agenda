import { describe, expect, it } from "vitest";
import {
  assertBillingAdmin,
  assertValidBillingDocument,
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

  it("accepts an 11-digit CPF and sends it through unchanged", () => {
    expect(assertValidBillingDocument("12345678909")).toBe("12345678909");
  });

  it("accepts a 14-digit CNPJ and sends it through unchanged", () => {
    expect(assertValidBillingDocument("12345678000195")).toBe(
      "12345678000195",
    );
  });

  it("strips punctuation before validating - a formatted CPF or CNPJ is normalized to digits only", () => {
    expect(assertValidBillingDocument("123.456.789-09")).toBe("12345678909");
    expect(assertValidBillingDocument("12.345.678/0001-95")).toBe(
      "12345678000195",
    );
    // Any non-digit noise (spaces, letters) is stripped the same way, not
    // just the conventional CPF/CNPJ punctuation.
    expect(assertValidBillingDocument(" 123 456 789-09 ")).toBe(
      "12345678909",
    );
  });

  it("blocks a missing document instead of inventing one", () => {
    expect(() => assertValidBillingDocument(null)).toThrow(
      /não possui cpf\/cnpj válido/i,
    );
    expect(() => assertValidBillingDocument(undefined)).toThrow(
      /não possui cpf\/cnpj válido/i,
    );
    expect(() => assertValidBillingDocument("")).toThrow(
      /não possui cpf\/cnpj válido/i,
    );
    expect(() => assertValidBillingDocument("   ")).toThrow(
      /não possui cpf\/cnpj válido/i,
    );
  });

  it("blocks a document with the wrong digit count instead of forwarding it as-is", () => {
    expect(() => assertValidBillingDocument("123")).toThrow(
      /não possui cpf\/cnpj válido/i,
    );
    expect(() => assertValidBillingDocument("123456789012")).toThrow( // 12 digits: neither CPF nor CNPJ
      /não possui cpf\/cnpj válido/i,
    );
    expect(() => assertValidBillingDocument(123456789)).toThrow( // not even a string
      /não possui cpf\/cnpj válido/i,
    );
  });

  it("never lets one company's document leak into another's validation result", () => {
    const companyACnpj = "11222333000181";
    const companyBCpf = "98765432100";
    // A pure function: interleaved, independent calls never share state -
    // company A's result is unaffected by validating company B's document
    // (or a bad one) in between.
    expect(assertValidBillingDocument(companyACnpj)).toBe(companyACnpj);
    expect(() => assertValidBillingDocument(null)).toThrow();
    expect(assertValidBillingDocument(companyBCpf)).toBe(companyBCpf);
    expect(assertValidBillingDocument(companyACnpj)).toBe(companyACnpj);
  });
});
