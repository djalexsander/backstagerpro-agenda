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
  it("mantém menu do Master e condiciona menu da empresa", () => {
    expect(canShowMaintenanceNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
    expect(canShowMaintenanceNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
