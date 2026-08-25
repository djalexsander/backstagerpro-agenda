import { describe, expect, it } from "vitest";
import { detectScannerRemotoOperation, maxScannerRemotoCheckoutQuantity } from "./scanner-remoto-domain";
import type { CustodyBalanceOption } from "./checkin-checkout-types";

function balance(overrides: Partial<CustodyBalanceOption>): CustodyBalanceOption {
  return {
    localizacao_id: "loc1",
    localizacao_codigo: "DEP",
    localizacao_nome: "Depósito",
    localizacao_ativa: true,
    quantidade: 10,
    ...overrides,
  };
}

describe("detectScannerRemotoOperation", () => {
  it("is always checkout for a pure checkout session, regardless of open custody", () => {
    expect(detectScannerRemotoOperation("checkout", false)).toBe("checkout");
    expect(detectScannerRemotoOperation("checkout", true)).toBe("checkout");
  });

  it("is always checkin for a pure checkin session, regardless of open custody", () => {
    expect(detectScannerRemotoOperation("checkin", false)).toBe("checkin");
    expect(detectScannerRemotoOperation("checkin", true)).toBe("checkin");
  });

  it("in misto mode, checks in when the material already has an open custody", () => {
    expect(detectScannerRemotoOperation("misto", true)).toBe("checkin");
  });

  it("in misto mode, checks out when the material has no open custody", () => {
    expect(detectScannerRemotoOperation("misto", false)).toBe("checkout");
  });
});

describe("maxScannerRemotoCheckoutQuantity", () => {
  it("returns the balance at the session's origin location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc1")).toBe(7);
  });

  it("picks the origin location's balance, not just the first one", () => {
    const saldos = [
      balance({ localizacao_id: "loc1", quantidade: 3 }),
      balance({ localizacao_id: "loc2", quantidade: 20 }),
    ];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc2")).toBe(20);
  });

  it("returns 0 when the material has no balance at that location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc-outra")).toBe(0);
  });

  it("returns 0 when the session has no origin location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, null)).toBe(0);
  });
});
