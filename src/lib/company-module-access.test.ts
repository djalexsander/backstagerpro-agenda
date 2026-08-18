import { describe, expect, it } from "vitest";
import {
  isCompanyModuleAccessible,
  isCustomerVisibleActiveEntitlement,
} from "@/lib/company-module-access";

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

describe("customer-visible active entitlements", () => {
  it("never presents extra_storage as an active benefit, even with stale catalog data", () => {
    expect(isCustomerVisibleActiveEntitlement({
      status: "active",
      catalog: { ativo: true, feature_key: "extra_storage" },
    })).toBe(false);
  });

  it("keeps historical inactive entitlements intact but outside active benefits", () => {
    const historical = {
      status: "active",
      catalog: { ativo: false, feature_key: "extra_storage" },
    };

    expect(isCustomerVisibleActiveEntitlement(historical)).toBe(false);
    expect(historical).toEqual({
      status: "active",
      catalog: { ativo: false, feature_key: "extra_storage" },
    });
  });

  it("continues presenting real active capacity extras", () => {
    expect(isCustomerVisibleActiveEntitlement({
      status: "active",
      catalog: { ativo: true, feature_key: "extra_eventos" },
    })).toBe(true);
    expect(isCustomerVisibleActiveEntitlement({
      status: "active",
      catalog: { ativo: true, feature_key: "extra_usuarios" },
    })).toBe(true);
  });
});
