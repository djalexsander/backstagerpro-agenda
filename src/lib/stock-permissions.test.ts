import { describe, expect, it } from "vitest";
import {
  canShowStockNavigation,
  getStockPermissions,
} from "./stock-permissions";

describe("stock permissions", () => {
  it("hides and blocks stock without the module", () => {
    expect(
      getStockPermissions({
        role: "admin_empresa",
        moduleEnabled: false,
        companyReadOnly: false,
      }),
    ).toEqual({
      visualizar: false,
      movimentar: false,
      gerenciarLocalizacoes: false,
      ajustar: false,
      estornar: false,
    });
  });

  it("keeps an ordinary user in read-only mode", () => {
    const permissions = getStockPermissions({
      role: "usuario",
      moduleEnabled: true,
      companyReadOnly: false,
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.movimentar).toBe(false);
    expect(permissions.estornar).toBe(false);
  });

  it("allows an operational company administrator", () => {
    expect(
      Object.values(
        getStockPermissions({
          role: "admin_empresa",
          moduleEnabled: true,
          companyReadOnly: false,
        }),
      ).every(Boolean),
    ).toBe(true);
  });

  it("keeps a blocked company administrator read-only", () => {
    const permissions = getStockPermissions({
      role: "admin_empresa",
      moduleEnabled: true,
      companyReadOnly: true,
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.movimentar).toBe(false);
    expect(permissions.gerenciarLocalizacoes).toBe(false);
  });

  it("requires a selected company in master context", () => {
    const permissions = getStockPermissions({
      role: "master_admin",
      moduleEnabled: true,
      companyReadOnly: false,
      companySelected: false,
    });
    expect(permissions.visualizar).toBe(false);
    expect(permissions.movimentar).toBe(false);
  });

  it("allows master operations after canonical company selection", () => {
    const permissions = getStockPermissions({
      role: "master_admin",
      moduleEnabled: false,
      companyReadOnly: false,
      companySelected: true,
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.movimentar).toBe(true);
  });

  it("shows navigation only for entitlement or master", () => {
    expect(
      canShowStockNavigation({ isMasterAdmin: false, moduleEnabled: false }),
    ).toBe(false);
    expect(
      canShowStockNavigation({ isMasterAdmin: false, moduleEnabled: true }),
    ).toBe(true);
    expect(
      canShowStockNavigation({ isMasterAdmin: true, moduleEnabled: false }),
    ).toBe(true);
  });
});
