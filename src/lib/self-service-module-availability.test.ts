import { describe, expect, it } from "vitest";
import type { ModuleCatalogRow } from "@/types/subscription";
import {
  doesCompanyModuleBlockPurchase,
  validateModuleDependenciesForActivation,
} from "./company-module-entitlements";
import {
  getSelfServiceAvailableModules,
  getLifetimeLicensedCatalogModules,
  getSelfServiceModulesInProgress,
} from "./self-service-module-availability";

const companyA = "company-a";
const companyB = "company-b";

function catalogModule(
  id: string,
  featureKey: string,
  tipoModulo = "addon",
): ModuleCatalogRow {
  return {
    id,
    feature_key: featureKey,
    nome: featureKey,
    ativo: true,
    tipo_modulo: tipoModulo,
  } as ModuleCatalogRow;
}

const catalog = [
  catalogModule("materials", "gestao_materiais"),
  catalogModule("addon", "documentos_avancados"),
  catalogModule("rfid", "rfid_materiais"),
];

function available(overrides: Partial<Parameters<typeof getSelfServiceAvailableModules>[0]> = {}) {
  return getSelfServiceAvailableModules({
    companyId: companyA,
    catalog,
    companyModules: [],
    moduleRequests: [],
    batchRequests: [],
    modulePayments: [],
    ...overrides,
  }).map((module) => module.feature_key);
}

describe("self-service module availability", () => {
  it("keeps an automatically provisioned inactive placeholder available", () => {
    expect(available({
      companyModules: [{ empresa_id: companyA, module_id: "materials", status: "inactive" }],
    })).toContain("gestao_materiais");
  });

  it("never interprets inactive as active and hides a truly active entitlement", () => {
    const result = available({
      companyModules: [
        { empresa_id: companyA, module_id: "materials", status: "active" },
        { empresa_id: companyA, module_id: "addon", status: "inactive" },
      ],
    });

    expect(result).not.toContain("gestao_materiais");
    expect(result).toContain("documentos_avancados");
  });

  it("does not offer an active module for a duplicate purchase", () => {
    expect(available({
      companyModules: [{ empresa_id: companyA, module_id: "addon", status: "active" }],
    })).not.toContain("documentos_avancados");
  });

  it("allows generic addon and RFID placeholders to be contracted", () => {
    const result = available({
      companyModules: [
        { empresa_id: companyA, module_id: "addon", status: "inactive" },
        { empresa_id: companyA, module_id: "rfid", status: "inactive" },
      ],
    });

    expect(result).toContain("documentos_avancados");
    expect(result).toContain("rfid_materiais");
  });

  it.each(["inactive", "cancelled", "rejected"])(
    "treats entitlement status %s as available for a new applicable purchase",
    (status) => {
      expect(available({
        companyModules: [{ empresa_id: companyA, module_id: "addon", status }],
      })).toContain("documentos_avancados");
    },
  );

  it("blocks pending entitlement, request, batch and payment states", () => {
    expect(available({
      companyModules: [{ empresa_id: companyA, module_id: "materials", status: "pending" }],
    })).not.toContain("gestao_materiais");

    expect(available({
      moduleRequests: [{ empresa_id: companyA, module_id: "addon", status: "pending" }],
    })).not.toContain("documentos_avancados");

    expect(available({
      batchRequests: [{
        empresa_id: companyA,
        status: "paid",
        module_batch_request_items: [{ module_id: "rfid" }],
      }],
    })).not.toContain("rfid_materiais");

    expect(available({
      modulePayments: [{ empresa_id: companyA, module_id: "materials", status: "paid" }],
    })).not.toContain("gestao_materiais");
  });

  it("exposes a pending module once with the most advanced customer status", () => {
    expect(getSelfServiceModulesInProgress({
      companyId: companyA,
      catalog,
      companyModules: [],
      moduleRequests: [{ empresa_id: companyA, module_id: "addon", status: "pending" }],
      batchRequests: [],
      modulePayments: [{ empresa_id: companyA, module_id: "addon", status: "paid" }],
    })).toEqual([{
      module: catalog[1],
      status: "payment_confirmed",
    }]);
  });

  it("does not leak another company's pending module into the customer view", () => {
    expect(getSelfServiceModulesInProgress({
      companyId: companyA,
      catalog,
      companyModules: [{ empresa_id: companyB, module_id: "materials", status: "pending" }],
      moduleRequests: [],
      batchRequests: [],
      modulePayments: [],
    })).toEqual([]);
  });

  it("allows a new purchase after rejected or cancelled commercial states", () => {
    expect(available({
      moduleRequests: [{ empresa_id: companyA, module_id: "addon", status: "rejected" }],
      batchRequests: [{
        empresa_id: companyA,
        status: "cancelled",
        module_batch_request_items: [{ module_id: "rfid" }],
      }],
      modulePayments: [{ empresa_id: companyA, module_id: "materials", status: "cancelled" }],
    })).toEqual(["gestao_materiais", "documentos_avancados", "rfid_materiais"]);
  });

  it("ignores entitlement and commercial rows belonging to another company", () => {
    expect(available({
      companyModules: [{ empresa_id: companyB, module_id: "materials", status: "active" }],
      moduleRequests: [{ empresa_id: companyB, module_id: "addon", status: "pending" }],
      batchRequests: [{
        empresa_id: companyB,
        status: "paid",
        module_batch_request_items: [{ module_id: "rfid" }],
      }],
    })).toEqual(["gestao_materiais", "documentos_avancados", "rfid_materiais"]);
  });

  it("keeps the canonical dependency rule: inactive dependencies do not authorize activation", () => {
    const validation = validateModuleDependenciesForActivation({
      moduleDependencies: [{ requiredModuleFeatureKey: "gestao_materiais" }],
      activeModuleFeatureKeys: [],
    });

    expect(validation).toEqual({
      isAllowed: false,
      missingDependencies: ["gestao_materiais"],
    });
  });

  it("matches the Master rule that only active and pending entitlements block availability", () => {
    const result = available({
      companyModules: [
        { empresa_id: companyA, module_id: "materials", status: "active" },
        { empresa_id: companyA, module_id: "addon", status: "pending" },
        { empresa_id: companyA, module_id: "rfid", status: "inactive" },
      ],
    });

    expect(result).toEqual(["rfid_materiais"]);
    expect([
      "active", "pending", "inactive", "cancelled", "rejected",
    ].filter(doesCompanyModuleBlockPurchase)).toEqual(["active", "pending"]);
  });

  it("does not offer inactive commercial entries while keeping real modules available", () => {
    const nonCommercial = [
      "agenda_compartilhada",
      "equipe_permissoes",
      "notificacoes_premium",
      "relatorios_materiais",
    ].map((featureKey, index) => ({
      ...catalogModule(`non-commercial-${index}`, featureKey),
      ativo: false,
    }));

    const result = available({ catalog: [...catalog, ...nonCommercial] });

    expect(result).toEqual([
      "gestao_materiais",
      "documentos_avancados",
      "rfid_materiais",
    ]);
  });

  it("never offers extra_storage even if stale catalog data marks it active", () => {
    expect(available({
      catalog: [catalogModule("storage", "extra_storage")],
    })).toEqual([]);
  });

  it("lists concrete lifetime modules without exposing inactive or storage products", () => {
    expect(getLifetimeLicensedCatalogModules([
      catalogModule("events", "extra_eventos"),
      catalogModule("users", "extra_usuarios"),
      catalogModule("storage", "extra_storage"),
      { ...catalogModule("disabled", "disabled_feature"), ativo: false },
    ]).map((module) => module.feature_key)).toEqual([
      "extra_eventos",
      "extra_usuarios",
    ]);
  });
});
