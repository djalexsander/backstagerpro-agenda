import { describe, expect, it } from "vitest";
import { getFinancialLedgerPermissions } from "./financial-ledger-permissions";

describe("financial ledger permissions", () => {
  it("hides and blocks the ledger without the financeiro_avancado module", () => {
    expect(
      getFinancialLedgerPermissions({ role: "admin_empresa", moduleEnabled: false, companyReadOnly: false }),
    ).toEqual({ visualizar: false, registrarRecebimento: false, estornar: false });
  });

  it("denies a plain 'usuario' - this module was already admin-only before the rental integration", () => {
    const permissions = getFinancialLedgerPermissions({ role: "usuario", moduleEnabled: true, companyReadOnly: false });
    expect(permissions.visualizar).toBe(false);
    expect(permissions.registrarRecebimento).toBe(false);
    expect(permissions.estornar).toBe(false);
  });

  it("allows an operational company administrator to view, register receipts and reverse them", () => {
    const permissions = getFinancialLedgerPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: false });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.registrarRecebimento).toBe(true);
    expect(permissions.estornar).toBe(true);
  });

  it("keeps a blocked (read-only) company administrator able to view but not register or reverse receipts", () => {
    const permissions = getFinancialLedgerPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.registrarRecebimento).toBe(false);
    expect(permissions.estornar).toBe(false);
  });

  it("requires a selected company in master context", () => {
    const permissions = getFinancialLedgerPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: false });
    expect(permissions.visualizar).toBe(false);
  });

  it("allows master operations for an entitled company", () => {
    const permissions = getFinancialLedgerPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.registrarRecebimento).toBe(true);
    expect(permissions.estornar).toBe(true);
  });
});
