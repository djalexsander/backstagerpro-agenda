import { describe, expect, it } from "vitest";
import {
  authorizeAsaasWebhook,
  parseAsaasWebhook,
} from "../../supabase/functions/_shared/asaas-webhook";

const strongToken = "a".repeat(32);

describe("Asaas webhook security", () => {
  it("requires a strong configured token and the exact header value", () => {
    expect(authorizeAsaasWebhook(undefined, strongToken)).toBe(
      "misconfigured",
    );
    expect(authorizeAsaasWebhook("short", "short")).toBe("misconfigured");
    expect(authorizeAsaasWebhook(strongToken, null)).toBe("unauthorized");
    expect(authorizeAsaasWebhook(strongToken, "wrong")).toBe("unauthorized");
    expect(authorizeAsaasWebhook(strongToken, strongToken)).toBe("authorized");
  });

  it("parses a valid confirmation using provider identifiers and amount", () => {
    expect(
      parseAsaasWebhook({
        id: "evt_confirmation_1",
        event: "PAYMENT_RECEIVED",
        dateCreated: "2026-07-29 18:00:00",
        payment: {
          id: "pay_payment_1",
          value: 199.9,
          externalReference: "backstage_pro:internal-payment-id",
        },
      }),
    ).toEqual({
      action: "process",
      eventId: "evt_confirmation_1",
      event: "PAYMENT_RECEIVED",
      eventCreatedAt: "2026-07-29T18:00:00.000Z",
      paymentId: "pay_payment_1",
      externalReference: "backstage_pro:internal-payment-id",
      amount: 199.9,
    });
  });

  it("ignores unrelated events while tolerating future provider fields", () => {
    expect(
      parseAsaasWebhook({
        id: "evt_created_1",
        event: "PAYMENT_CREATED",
        futureField: { addedByProvider: true },
      }),
    ).toEqual({ action: "ignored", event: "PAYMENT_CREATED" });
  });

  it("rejects malformed confirmation identifiers and amounts", () => {
    const valid = {
      id: "evt_confirmation_2",
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_payment_2", value: 99.9 },
    };

    expect(() => parseAsaasWebhook({ ...valid, id: "invalid" })).toThrow(
      /evento Asaas inválido/i,
    );
    expect(() =>
      parseAsaasWebhook({
        ...valid,
        payment: { id: "invalid", value: 99.9 },
      }),
    ).toThrow(/pagamento Asaas inválido/i);
    expect(() =>
      parseAsaasWebhook({
        ...valid,
        payment: { id: "pay_payment_2", value: "99.90" },
      }),
    ).toThrow(/valor do pagamento/i);
    expect(() =>
      parseAsaasWebhook({
        ...valid,
        payment: { id: "pay_payment_2", value: 99.999 },
      }),
    ).toThrow(/valor do pagamento/i);
  });

  it("rejects invalid provider timestamps before calling the database", () => {
    expect(() =>
      parseAsaasWebhook({
        id: "evt_confirmation_3",
        event: "PAYMENT_RECEIVED",
        dateCreated: "not-a-date",
        payment: { id: "pay_payment_3", value: 49.9 },
      }),
    ).toThrow(/data do evento/i);
  });
});
