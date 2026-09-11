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

  it("keeps an ordinary user read-only without an explicit granular grant", () => {
    const permissions = getStockPermissions({
      role: "usuario",
      moduleEnabled: true,
      companyReadOnly: false,
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.movimentar).toBe(false);
    expect(permissions.ajustar).toBe(false);
    expect(permissions.estornar).toBe(false);
    expect(permissions.gerenciarLocalizacoes).toBe(false);
    expect(
      getStockPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: false, canDelete: false },
      }),
    ).toEqual(permissions);
  });

  it("unlocks each write action independently for a usuario with an explicit grant", () => {
    expect(
      getStockPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: true, canEdit: false, canDelete: false },
      }),
    ).toEqual({ visualizar: true, movimentar: true, gerenciarLocalizacoes: false, ajustar: false, estornar: false });
    expect(
      getStockPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: true, canDelete: false },
      }),
    ).toEqual({ visualizar: true, movimentar: false, gerenciarLocalizacoes: false, ajustar: true, estornar: false });
    expect(
      getStockPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: false, canDelete: true },
      }),
    ).toEqual({ visualizar: true, movimentar: false, gerenciarLocalizacoes: false, ajustar: false, estornar: true });
  });

  it("never grants gerenciarLocalizacoes to a usuario, even with every write action granted", () => {
    const permissions = getStockPermissions({
      role: "usuario",
      moduleEnabled: true,
      companyReadOnly: false,
      granular: { canCreate: true, canEdit: true, canDelete: true },
    });
    expect(permissions.gerenciarLocalizacoes).toBe(false);
    expect(permissions.movimentar).toBe(true);
    expect(permissions.ajustar).toBe(true);
    expect(permissions.estornar).toBe(true);
  });

  it("still blocks a granted usuario when the company is read-only", () => {
    const permissions = getStockPermissions({
      role: "usuario",
      moduleEnabled: true,
      companyReadOnly: true,
      granular: { canCreate: true, canEdit: true, canDelete: true },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.movimentar).toBe(false);
    expect(permissions.ajustar).toBe(false);
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

  it("requires the selected company entitlement for master operations", () => {
    const permissions = getStockPermissions({
      role: "master_admin",
      moduleEnabled: false,
      companyReadOnly: false,
      companySelected: true,
    });
    expect(permissions.visualizar).toBe(false);
    expect(permissions.movimentar).toBe(false);
  });

  it("allows master operations for an entitled operational company", () => {
    const permissions = getStockPermissions({
      role: "master_admin",
      moduleEnabled: true,
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
