import { describe, expect, it } from "vitest";
import { computeConsolidatedCapabilities } from "./plan-helpers";
import { getSelfServiceAvailableModules } from "./self-service-module-availability";

const companyId = "company-a";

function capacityModule({
  id,
  featureKey,
  users = 0,
  events = 0,
  storage = 0,
  price = 0,
  active = true,
}: {
  id: string;
  featureKey: string;
  users?: number;
  events?: number;
  storage?: number;
  price?: number;
  active?: boolean;
}) {
  return {
    id,
    nome: featureKey,
    feature_key: featureKey,
    valor: price,
    ativo: active,
    is_capacity_module: true,
    capacidade_extra_usuarios: users,
    capacidade_extra_eventos: events,
    capacidade_extra_storage: storage,
  } as any;
}

describe("commercial capacity extras", () => {
  it("adds the approved +20 defaults and retains their catalog prices", () => {
    const eventCatalog = capacityModule({
      id: "events",
      featureKey: "extra_eventos",
      events: 20,
      price: 49.9,
    });
    const userCatalog = capacityModule({
      id: "users",
      featureKey: "extra_usuarios",
      users: 20,
      price: 39.9,
    });

    const result = computeConsolidatedCapabilities(
      { max_eventos: 50, max_usuarios: 5, storage_limit: 5 } as any,
      [
        { module_id: eventCatalog.id, catalog: eventCatalog } as any,
        { module_id: userCatalog.id, catalog: userCatalog } as any,
      ],
    );

    expect(result).toMatchObject({
      maxEventos: 70,
      maxUsuarios: 25,
      storageLimitGb: null,
    });
    expect(eventCatalog.valor).toBe(49.9);
    expect(userCatalog.valor).toBe(39.9);
  });

  it("does not offer the inactive cosmetic storage extra", () => {
    const eventCatalog = capacityModule({
      id: "events",
      featureKey: "extra_eventos",
      events: 20,
      price: 49.9,
    });
    const storageCatalog = capacityModule({
      id: "storage",
      featureKey: "extra_storage",
      storage: 100,
      // Defense in depth: even stale data claiming it is active is hidden.
      active: true,
    });

    const available = getSelfServiceAvailableModules({
      companyId,
      catalog: [eventCatalog, storageCatalog],
      companyModules: [],
      moduleRequests: [],
      batchRequests: [],
      modulePayments: [],
    });

    expect(available.map((module) => module.feature_key)).toEqual([
      "extra_eventos",
    ]);
  });

  it("preserves tenant isolation when deciding whether an extra is available", () => {
    const userCatalog = capacityModule({
      id: "users",
      featureKey: "extra_usuarios",
      users: 20,
      price: 39.9,
    });

    const available = getSelfServiceAvailableModules({
      companyId,
      catalog: [userCatalog],
      companyModules: [{
        empresa_id: "company-b",
        module_id: userCatalog.id,
        status: "active",
      }],
      moduleRequests: [],
      batchRequests: [],
      modulePayments: [],
    });

    expect(available).toHaveLength(1);
  });
});
