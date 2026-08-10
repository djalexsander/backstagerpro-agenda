import { describe, expect, it } from "vitest";
import { canShowClientsNavigation, getClientPermissions } from "./client-permissions";

describe("client permissions", () => {
  it("hides and blocks clients without the module", () => {
    expect(
      getClientPermissions({ role: "admin_empresa", moduleEnabled: false, companyReadOnly: false }),
    ).toEqual({ visualizar: false, criar: false, editar: false, alternarStatus: false });
  });

  it("keeps an ordinary user in read-only mode", () => {
    const permissions = getClientPermissions({ role: "usuario", moduleEnabled: true, companyReadOnly: false });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.editar).toBe(false);
    expect(permissions.alternarStatus).toBe(false);
  });

  it("allows an operational company administrator full CRUD", () => {
    const permissions = getClientPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: false });
    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it("keeps a blocked company administrator read-only", () => {
    const permissions = getClientPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.editar).toBe(false);
    expect(permissions.alternarStatus).toBe(false);
  });

  it("requires a selected company in master context", () => {
    const permissions = getClientPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: false });
    expect(permissions.visualizar).toBe(false);
  });

  it("allows master operations for an entitled operational company", () => {
    const permissions = getClientPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(true);
  });

  it("shows navigation only for entitlement or master", () => {
    expect(canShowClientsNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
    expect(canShowClientsNavigation({ isMasterAdmin: false, moduleEnabled: true })).toBe(true);
    expect(canShowClientsNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
  });
});
