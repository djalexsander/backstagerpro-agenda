import { describe, expect, it } from "vitest";
import { canShowMaterialLabelsNavigation, getMaterialLabelPermissions } from "./material-label-permissions";

describe("material label permissions", () => {
  it("allows consultation to users and limits printing/model writes to administrators", () => {
    expect(getMaterialLabelPermissions({ role: "usuario", moduleEnabled: true, companyReadOnly: false })).toEqual({ visualizar: true, imprimir: false, gerenciarModelos: false });
    expect(getMaterialLabelPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: false })).toEqual({ visualizar: true, imprimir: true, gerenciarModelos: true });
  });

  it("fails closed without tenant, module or operational access", () => {
    expect(getMaterialLabelPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: false }).visualizar).toBe(false);
    expect(getMaterialLabelPermissions({ role: "admin_empresa", moduleEnabled: false, companyReadOnly: false }).visualizar).toBe(false);
    expect(getMaterialLabelPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: true }).imprimir).toBe(false);
  });

  it("keeps Master navigation available for explicit company selection", () => {
    expect(canShowMaterialLabelsNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
    expect(canShowMaterialLabelsNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
