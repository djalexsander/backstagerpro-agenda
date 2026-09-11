import { describe, expect, it } from "vitest";
import { canShowMaintenanceNavigation, getMaintenancePermissions } from "./equipment-maintenance-permissions";

describe("equipment maintenance permissions", () => {
  it("permite leitura ao usuário e restringe escrita aos administradores", () => {
    expect(getMaintenancePermissions({ role: "usuario", moduleEnabled: true, companyReadOnly: false })).toMatchObject({ visualizar: true, criar: false });
    expect(getMaintenancePermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: false })).toMatchObject({ visualizar: true, criar: true, editar: true });
  });
  it("falha fechado sem módulo, empresa ou acesso operacional", () => {
    expect(getMaintenancePermissions({ role: "admin_empresa", moduleEnabled: false, companyReadOnly: false }).visualizar).toBe(false);
    expect(getMaintenancePermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: true }).criar).toBe(false);
    expect(getMaintenancePermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: false }).visualizar).toBe(false);
  });
  it("unlocks each write action independently for a usuario with an explicit grant", () => {
    expect(
      getMaintenancePermissions({
        role: "usuario", moduleEnabled: true, companyReadOnly: false,
        granular: { canCreate: true, canEdit: false, canDelete: false },
      }),
    ).toMatchObject({ visualizar: true, criar: true, editar: false, transicionar: false, gerenciarInsumos: false });
    expect(
      getMaintenancePermissions({
        role: "usuario", moduleEnabled: true, companyReadOnly: false,
        granular: { canCreate: false, canEdit: true, canDelete: false },
      }),
    ).toMatchObject({ visualizar: true, criar: false, editar: true, transicionar: true, gerenciarInsumos: true });
  });

  it("still blocks a granted usuario when the company is read-only", () => {
    const permissions = getMaintenancePermissions({
      role: "usuario", moduleEnabled: true, companyReadOnly: true,
      granular: { canCreate: true, canEdit: true, canDelete: true },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.editar).toBe(false);
  });

  it("mantém menu do Master e condiciona menu da empresa", () => {
    expect(canShowMaintenanceNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
    expect(canShowMaintenanceNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
