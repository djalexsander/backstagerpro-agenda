import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { createMaintenanceOrder, listMaintenanceOrders } from "./equipment-maintenance-service";

describe("equipment maintenance service", () => {
  beforeEach(() => rpc.mockReset());
  it("envia filtros e paginação à fachada canônica", async () => {
    rpc.mockResolvedValue({ data: [{ item: { id: "one" }, total_count: 1 }], error: null });
    const result = await listMaintenanceOrders({ companyId: "company", page: 2, pageSize: 15,
      filters: { search: "scanner", status: "aberta", type: "corretiva", priority: "alta", responsible: "Ana", materialId: "material", dateFrom: "2026-08-01", dateTo: "2026-08-02" } });
    expect(result.total).toBe(1);
    expect(rpc).toHaveBeenCalledWith("listar_ordens_manutencao", expect.objectContaining({ _pagina: 2, _status: "aberta", _material_id: "material" }));
  });
  it("preserva origem e referência explícita do Check-in", async () => {
    rpc.mockResolvedValue({ data: { id: "order" }, error: null });
    await createMaintenanceOrder("company", { materialId: "material", type: "corretiva", priority: "alta", origin: "checkin",
      defect: "Case quebrado", affectedQuantity: 1, entryCondition: "danificado", execution: "interna",
      custodyEventId: "event", clientUuid: "request" });
    expect(rpc).toHaveBeenCalledWith("criar_ordem_manutencao", expect.objectContaining({ _origem: "checkin", _custodia_evento_origem_id: "event", _condicao_entrada: "danificado", _client_uuid: "request" }));
  });
});
