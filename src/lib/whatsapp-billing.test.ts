import { describe, expect, it } from "vitest";
import { buildWhatsAppBillingMessage, buildWhatsAppProtocolUrl, buildWhatsAppUrl, normalizeWhatsAppPhone } from "./whatsapp-billing";
import type { ReceivableEntry } from "./financial-ledger-types";

function entry(overrides: Partial<ReceivableEntry>): ReceivableEntry {
  return {
    id: "e1", empresa_id: "company", origem_tipo: "locacao_material", origem_id: "rental-1",
    cliente_id: "client-1", cliente_nome: "Ana Produções", cliente_nome_fantasia: null,
    tipo: "receita", descricao: "Locação LOC-2026-000004", forma_cobranca: "avista",
    valor_original: 2000, valor_recebido: 0, valor_estornado: 0, status: "pendente",
    vencimento: "2026-10-05", forma_pagamento: null, observacoes: null, vencido: false,
    requer_revisao_vencimento: false, created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeWhatsAppPhone", () => {
  it("returns null for missing or unusably short input", () => {
    expect(normalizeWhatsAppPhone(null)).toBeNull();
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
    expect(normalizeWhatsAppPhone("")).toBeNull();
    expect(normalizeWhatsAppPhone("123")).toBeNull();
  });

  it("adds the 55 country code to a bare local number, formatting stripped", () => {
    expect(normalizeWhatsAppPhone("(11) 99999-8888")).toBe("5511999998888");
    expect(normalizeWhatsAppPhone("11999998888")).toBe("5511999998888");
  });

  it("leaves a number that already carries a country code untouched", () => {
    expect(normalizeWhatsAppPhone("5511999998888")).toBe("5511999998888");
  });
});

describe("buildWhatsAppUrl", () => {
  it("builds a wa.me deep link with the message URL-encoded, not an API endpoint", () => {
    const url = buildWhatsAppUrl("5511999998888", "Olá, teste & revisão");
    expect(url).toBe("https://wa.me/5511999998888?text=Ol%C3%A1%2C%20teste%20%26%20revis%C3%A3o");
  });
});

describe("buildWhatsAppProtocolUrl", () => {
  it("builds a whatsapp:// deep link with the same phone/message encoding as buildWhatsAppUrl", () => {
    const url = buildWhatsAppProtocolUrl("5511999998888", "Olá, teste & revisão");
    expect(url).toBe("whatsapp://send?phone=5511999998888&text=Ol%C3%A1%2C%20teste%20%26%20revis%C3%A3o");
  });
});

describe("buildWhatsAppBillingMessage", () => {
  const company = "Backstage Pro Produções";

  it("names the single title and its due date directly in the opening line", () => {
    const message = buildWhatsAppBillingMessage({
      client: { cliente_nome: "Alex Sandro", cliente_nome_fantasia: null, total_devido: 2000, proximo_vencimento: "2026-10-05" },
      entries: [entry({})],
      companyName: company,
    });
    expect(message).toContain("Olá, Alex.");
    expect(message).toContain("R$ 2.000,00 referente à Locação LOC-2026-000004, com vencimento em 05/10/2026.");
    expect(message).not.toContain("Resumo dos títulos");
    expect(message).toContain(company);
  });

  it("lists every open title in the summary when there is more than one, marking installment plans instead of inventing a date", () => {
    const message = buildWhatsAppBillingMessage({
      client: { cliente_nome: "Ana Produções", cliente_nome_fantasia: null, total_devido: 3500, proximo_vencimento: "2026-09-01" },
      entries: [
        entry({ id: "e1", descricao: "Locação LOC-2026-000004", valor_original: 2000, valor_recebido: 0, vencimento: "2026-10-05" }),
        entry({ id: "e2", descricao: "Locação LOC-2026-000009", valor_original: 1500, valor_recebido: 0, forma_cobranca: "parcelado", vencimento: null }),
      ],
      companyName: company,
    });
    expect(message).toContain("Resumo dos títulos em aberto:");
    expect(message).toContain("- Locação LOC-2026-000004: R$ 2.000,00 (vence 05/10/2026)");
    expect(message).toContain("- Locação LOC-2026-000009: R$ 1.500,00 (parcelado)");
  });

  it("never fabricates a due date when the client has none on record", () => {
    const message = buildWhatsAppBillingMessage({
      client: { cliente_nome: "Cliente Antigo", cliente_nome_fantasia: null, total_devido: 500, proximo_vencimento: null },
      entries: [entry({ vencimento: null, requer_revisao_vencimento: true })],
      companyName: company,
    });
    expect(message).not.toContain("vencimento em");
  });
});
