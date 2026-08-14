import { describe, expect, it } from "vitest";
import { canShowTraceabilityNavigation, getTraceabilityPermissions } from "./material-traceability-permissions";

describe("getTraceabilityPermissions", () => {
  it("admin_empresa can view whenever the module is enabled, no granular grant needed", () => {
    expect(
      getTraceabilityPermissions({ role: "admin_empresa", moduleEnabled: true }).visualizar,
    ).toBe(true);
  });

  it("master_admin can view whenever the module is enabled, no granular grant needed", () => {
    expect(
      getTraceabilityPermissions({ role: "master_admin", moduleEnabled: true }).visualizar,
    ).toBe(true);
  });

  it("admin_empresa cannot view when the module itself is disabled", () => {
    expect(
      getTraceabilityPermissions({ role: "admin_empresa", moduleEnabled: false }).visualizar,
    ).toBe(false);
  });

  it("usuario without a granular grant cannot view, even with the module enabled", () => {
    expect(
      getTraceabilityPermissions({ role: "usuario", moduleEnabled: true, granular: null }).visualizar,
    ).toBe(false);
  });

  it("usuario with an explicit can_view grant can view", () => {
    expect(
      getTraceabilityPermissions({
        role: "usuario",
        moduleEnabled: true,
        granular: { canView: true },
      }).visualizar,
    ).toBe(true);
  });

  it("usuario with a grant that explicitly denies view cannot view", () => {
    expect(
      getTraceabilityPermissions({
        role: "usuario",
        moduleEnabled: true,
        granular: { canView: false },
      }).visualizar,
    ).toBe(false);
  });

  it("no company selected blocks access regardless of role", () => {
    expect(
      getTraceabilityPermissions({
        role: "admin_empresa",
        moduleEnabled: true,
        companySelected: false,
      }).visualizar,
    ).toBe(false);
  });

  it("an unrecognized role never gets access", () => {
    expect(
      getTraceabilityPermissions({ role: "outro", moduleEnabled: true }).visualizar,
    ).toBe(false);
  });
});

describe("canShowTraceabilityNavigation", () => {
  it("master admin always sees the nav item", () => {
    expect(canShowTraceabilityNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
  });
  it("non-master users only see it when the module is enabled", () => {
    expect(canShowTraceabilityNavigation({ isMasterAdmin: false, moduleEnabled: true })).toBe(true);
    expect(canShowTraceabilityNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
