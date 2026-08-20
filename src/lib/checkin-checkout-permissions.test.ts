import { describe, expect, it } from "vitest";
import {
  canShowCustodyNavigation,
  getCustodyPermissions,
} from "./checkin-checkout-permissions";

describe("check-in/check-out permissions", () => {
  it("fails closed without entitlement or selected company", () => {
    expect(
      getCustodyPermissions({
        role: "admin_empresa",
        moduleEnabled: false,
        companyReadOnly: false,
      }),
    ).toEqual({ visualizar: false, checkout: false, checkin: false, cancelar: false });
    expect(
      getCustodyPermissions({
        role: "master_admin",
        moduleEnabled: true,
        companyReadOnly: false,
        companySelected: false,
      }).visualizar,
    ).toBe(false);
  });

  it("keeps ordinary users read-only without an explicit granular grant", () => {
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
      }),
    ).toEqual({ visualizar: true, checkout: false, checkin: false, cancelar: false });
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: false, canDelete: false },
      }),
    ).toEqual({ visualizar: true, checkout: false, checkin: false, cancelar: false });
  });

  it("unlocks each write action independently for a usuario with an explicit grant", () => {
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: true, canEdit: false, canDelete: false },
      }),
    ).toEqual({ visualizar: true, checkout: true, checkin: false, cancelar: false });
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: true, canDelete: false },
      }),
    ).toEqual({ visualizar: true, checkout: false, checkin: true, cancelar: false });
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: false,
        granular: { canCreate: false, canEdit: false, canDelete: true },
      }),
    ).toEqual({ visualizar: true, checkout: false, checkin: false, cancelar: true });
  });

  it("still blocks a granted usuario when the company is read-only", () => {
    expect(
      getCustodyPermissions({
        role: "usuario",
        moduleEnabled: true,
        companyReadOnly: true,
        granular: { canCreate: true, canEdit: true, canDelete: true },
      }),
    ).toEqual({ visualizar: true, checkout: false, checkin: false, cancelar: false });
  });

  it("allows an operational company administrator", () => {
    expect(
      Object.values(
        getCustodyPermissions({
          role: "admin_empresa",
          moduleEnabled: true,
          companyReadOnly: false,
        }),
      ).every(Boolean),
    ).toBe(true);
  });

  it("keeps inactive/read-only companies from writing", () => {
    const permissions = getCustodyPermissions({
      role: "admin_empresa",
      moduleEnabled: true,
      companyReadOnly: true,
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.checkout).toBe(false);
    expect(permissions.checkin).toBe(false);
  });

  it("requires selected-company entitlement even for master operations", () => {
    expect(
      getCustodyPermissions({
        role: "master_admin",
        moduleEnabled: false,
        companyReadOnly: false,
      }).checkout,
    ).toBe(false);
    expect(
      getCustodyPermissions({
        role: "master_admin",
        moduleEnabled: true,
        companyReadOnly: false,
      }).checkout,
    ).toBe(true);
  });

  it("shows navigation for entitlement or master only", () => {
    expect(canShowCustodyNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
    expect(canShowCustodyNavigation({ isMasterAdmin: false, moduleEnabled: true })).toBe(true);
    expect(canShowCustodyNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
  });
});
