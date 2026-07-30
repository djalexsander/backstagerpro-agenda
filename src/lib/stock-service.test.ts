import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

import {
  adjustStock,
  registerStockMovement,
  reverseStockMovement,
} from "./stock-service";

const companyId = "71000000-0000-4000-8000-000000000001";
const materialId = "72000000-0000-4000-8000-000000000001";
const locationId = "73000000-0000-4000-8000-000000000001";
const operationId = "74000000-0000-4000-8000-000000000001";

describe("stock mutation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({
      data: { id: "movement-id" },
      error: null,
    });
  });

  it("registers an entry only through the atomic RPC", async () => {
    await registerStockMovement(companyId, {
      materialId,
      type: "entrada",
      quantity: 3,
      destinationLocationId: locationId,
      reason: "Compra",
      clientUuid: operationId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "registrar_movimentacao_estoque",
      expect.objectContaining({
        _empresa_id: companyId,
        _material_id: materialId,
        _client_uuid: operationId,
        _quantidade: 3,
        _localizacao_destino_id: locationId,
      }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("preserves the same idempotency key on the service boundary", async () => {
    const input = {
      materialId,
      type: "saida" as const,
      quantity: 1,
      originLocationId: locationId,
      clientUuid: operationId,
    };
    await registerStockMovement(companyId, input);
    await registerStockMovement(companyId, input);
    expect(mocks.rpc.mock.calls[0][1]._client_uuid).toBe(operationId);
    expect(mocks.rpc.mock.calls[1][1]._client_uuid).toBe(operationId);
  });

  it("sends physical inventory quantity to the dedicated adjustment RPC", async () => {
    await adjustStock(companyId, {
      materialId,
      locationId,
      physicalQuantity: 8,
      reason: "Contagem física",
      justification: "Contagem anual",
      clientUuid: operationId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("ajustar_estoque_material", {
      _empresa_id: companyId,
      _material_id: materialId,
      _localizacao_id: locationId,
      _quantidade_fisica: 8,
      _motivo: "Contagem física",
      _justificativa: "Contagem anual",
      _observacao: null,
      _data_efetiva: null,
      _client_uuid: operationId,
    });
  });

  it("creates a compensating reversal instead of updating the ledger", async () => {
    await reverseStockMovement(companyId, {
      movementId: "movement-original",
      justification: "Lançamento incorreto",
      clientUuid: operationId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("estornar_movimentacao_estoque", {
      _empresa_id: companyId,
      _movimentacao_id: "movement-original",
      _justificativa: "Lançamento incorreto",
      _data_efetiva: null,
      _client_uuid: operationId,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not leak a technical database error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX999", message: 'relation "internal" failed' },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      registerStockMovement(companyId, {
        materialId,
        type: "entrada",
        quantity: 1,
        destinationLocationId: locationId,
        clientUuid: operationId,
      }),
    ).rejects.not.toThrow(/internal|relation/i);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
