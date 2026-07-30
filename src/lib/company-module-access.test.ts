import { describe, expect, it } from "vitest";
import { isCompanyModuleAccessible } from "@/lib/company-module-access";

const activeCatalogFeatureKeys = new Set([
  "gestao_materiais",
  "financeiro_avancado",
]);

describe("company module access", () => {
  it("requires both an active catalog entry and an active entitlement", () => {
    expect(
      isCompanyModuleAccessible({
        featureKey: "gestao_materiais",
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: new Set(["gestao_materiais"]),
        isLifetime: false,
      }),
    ).toBe(true);

    expect(
      isCompanyModuleAccessible({
        featureKey: "gestao_materiais",
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: new Set(),
        isLifetime: false,
      }),
    ).toBe(false);
  });

  it("gives lifetime companies every active catalog module only", () => {
    expect(
      isCompanyModuleAccessible({
        featureKey: "gestao_materiais",
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: new Set(),
        isLifetime: true,
      }),
    ).toBe(true);

    expect(
      isCompanyModuleAccessible({
        featureKey: "etiquetas_materiais",
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: new Set(),
        isLifetime: true,
      }),
    ).toBe(false);

    expect(
      isCompanyModuleAccessible({
        featureKey: "chave_inexistente",
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: new Set(),
        isLifetime: true,
      }),
    ).toBe(false);
  });
});
