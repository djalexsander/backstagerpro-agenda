import { describe, expect, it } from "vitest";
import { canShowRfidNavigation, getRfidPermissions } from "@/lib/rfid-permissions";

const BASE = { moduleEnabled: true, companyReadOnly: false, companySelected: true };

describe("getRfidPermissions", () => {
  it("gives admin_empresa full access when the module is enabled", () => {
    const permissions = getRfidPermissions({ role: "admin_empresa", ...BASE });
    expect(permissions).toEqual({
      visualizar: true,
      vincularTag: true,
      trocarTag: true,
      desativarTag: true,
      iniciarConferencia: true,
      configurarReader: true,
    });
  });

  it("gives master_admin full access when the module is enabled", () => {
    const permissions = getRfidPermissions({ role: "master_admin", ...BASE });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.vincularTag).toBe(true);
  });

  it("admin_empresa is unaffected by a granular row, even a fully-empty one", () => {
    const permissions = getRfidPermissions({
      role: "admin_empresa",
      ...BASE,
      granular: { canView: false, canCreate: false, canEdit: false, canDelete: false },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.vincularTag).toBe(true);
    expect(permissions.desativarTag).toBe(true);
  });

  it("blocks admin_empresa writes when the company is read-only, but keeps view", () => {
    const permissions = getRfidPermissions({ role: "admin_empresa", ...BASE, companyReadOnly: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.vincularTag).toBe(false);
  });

  it("denies everything for usuario with no granular grant at all", () => {
    const permissions = getRfidPermissions({ role: "usuario", ...BASE });
    expect(permissions).toEqual({
      visualizar: false,
      vincularTag: false,
      trocarTag: false,
      desativarTag: false,
      iniciarConferencia: false,
      configurarReader: false,
    });
  });

  it("denies everything for usuario with an explicit all-false grant", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      granular: { canView: false, canCreate: false, canEdit: false, canDelete: false },
    });
    expect(permissions.visualizar).toBe(false);
  });

  it("grants usuario only visualizar when just canView is set", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      granular: { canView: true, canCreate: false, canEdit: false, canDelete: false },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.vincularTag).toBe(false);
    expect(permissions.trocarTag).toBe(false);
    expect(permissions.desativarTag).toBe(false);
    expect(permissions.iniciarConferencia).toBe(false);
  });

  it("grants usuario vincular/trocar/iniciarConferencia when canCreate is set", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      granular: { canView: true, canCreate: true, canEdit: false, canDelete: false },
    });
    expect(permissions.vincularTag).toBe(true);
    expect(permissions.trocarTag).toBe(true);
    expect(permissions.iniciarConferencia).toBe(true);
    expect(permissions.desativarTag).toBe(false);
  });

  it("grants usuario desativarTag only when canDelete is set", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      granular: { canView: true, canCreate: false, canEdit: false, canDelete: true },
    });
    expect(permissions.desativarTag).toBe(true);
    expect(permissions.vincularTag).toBe(false);
  });

  it("grants usuario configurarReader only when canEdit is set", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      granular: { canView: true, canCreate: false, canEdit: true, canDelete: false },
    });
    expect(permissions.configurarReader).toBe(true);
  });

  it("blocks usuario writes when the company is read-only, even with full grants", () => {
    const permissions = getRfidPermissions({
      role: "usuario",
      ...BASE,
      companyReadOnly: true,
      granular: { canView: true, canCreate: true, canEdit: true, canDelete: true },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.vincularTag).toBe(false);
  });

  it("denies everything when the module is disabled, regardless of role", () => {
    const permissions = getRfidPermissions({
      role: "admin_empresa",
      ...BASE,
      moduleEnabled: false,
    });
    expect(permissions.visualizar).toBe(false);
  });

  it("denies everything when no company is selected", () => {
    const permissions = getRfidPermissions({ role: "admin_empresa", ...BASE, companySelected: false });
    expect(permissions.visualizar).toBe(false);
  });

  it("denies everything for an unrecognized/null role", () => {
    const permissions = getRfidPermissions({ role: null, ...BASE });
    expect(permissions.visualizar).toBe(false);
  });
});

describe("canShowRfidNavigation", () => {
  it("always shows for master admin, even without the module", () => {
    expect(canShowRfidNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
  });

  it("shows for a non-master when the module is enabled", () => {
    expect(canShowRfidNavigation({ isMasterAdmin: false, moduleEnabled: true })).toBe(true);
  });

  it("hides for a non-master without the module", () => {
    expect(canShowRfidNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
