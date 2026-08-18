import { describe, expect, it } from "vitest";
import {
  buildCompanyModuleEntitlementPayload,
  expandModuleSelectionWithDependencies,
  validateModuleDependenciesForActivation,
} from "./company-module-entitlements";

describe("buildCompanyModuleEntitlementPayload", () => {
  it("marks an inactive row as active and stamps activation time", () => {
    const payload = buildCompanyModuleEntitlementPayload({
      requestedStatus: "active",
      grantedByAdmin: true,
      valorCobrado: 125,
      origem: "manual_admin",
      trialGranted: false,
      currentStatus: "inactive",
    });

    expect(payload.status).toBe("active");
    expect(payload.granted_by_admin).toBe(true);
    expect(payload.valor_cobrado).toBe(125);
    expect(payload.origem).toBe("manual_admin");
    expect(payload.activated_at).toBeTruthy();
  });

  it("preserves the existing activation timestamp when reactivating", () => {
    const existingActivatedAt = "2026-08-01T00:00:00.000Z";
    const payload = buildCompanyModuleEntitlementPayload({
      requestedStatus: "active",
      grantedByAdmin: false,
      valorCobrado: 0,
      origem: "manual_admin",
      trialGranted: false,
      currentStatus: "inactive",
      existingActivatedAt,
    });

    expect(payload.activated_at).toBe(existingActivatedAt);
  });

  it("blocks activation when required modules are not active yet", () => {
    const result = validateModuleDependenciesForActivation({
      moduleDependencies: [{ requiredModuleFeatureKey: "gestao_materiais" }],
      activeModuleFeatureKeys: ["controle_estoque"],
    });

    expect(result.isAllowed).toBe(false);
    expect(result.missingDependencies).toEqual(["gestao_materiais"]);
  });

  it("allows activation when all required modules are already active", () => {
    const result = validateModuleDependenciesForActivation({
      moduleDependencies: [{ requiredModuleFeatureKey: "gestao_materiais" }],
      activeModuleFeatureKeys: ["gestao_materiais", "controle_estoque"],
    });

    expect(result.isAllowed).toBe(true);
    expect(result.missingDependencies).toEqual([]);
  });
});

describe("expandModuleSelectionWithDependencies", () => {
  const dependencies = [
    { module_id: "stock", required_module_id: "materials" },
    { module_id: "checkout", required_module_id: "stock" },
  ];

  it("keeps a module without dependencies unchanged", () => {
    expect([
      ...expandModuleSelectionWithDependencies({
        selectedModuleIds: ["reports"],
        moduleDependencies: dependencies,
        activeModuleIds: [],
      }),
    ]).toEqual(["reports"]);
  });

  it("does not add a dependency that is already active", () => {
    expect([
      ...expandModuleSelectionWithDependencies({
        selectedModuleIds: ["stock"],
        moduleDependencies: dependencies,
        activeModuleIds: ["materials"],
      }),
    ]).toEqual(["stock"]);
  });

  it("includes every missing transitive dependency exactly once", () => {
    const selected = expandModuleSelectionWithDependencies({
      selectedModuleIds: ["checkout", "stock"],
      moduleDependencies: dependencies,
      activeModuleIds: [],
    });

    expect(selected).toEqual(new Set(["checkout", "stock", "materials"]));
  });

  it("uses only the active-module set supplied for the current company", () => {
    const selected = expandModuleSelectionWithDependencies({
      selectedModuleIds: ["stock"],
      moduleDependencies: dependencies,
      activeModuleIds: [],
    });

    expect(selected).toContain("materials");
  });
});
