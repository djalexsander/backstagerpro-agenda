import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

import {
  getEventCustodyTotals,
  listEventCustodyMaterials,
  registerCheckout,
  registerCustodyWriteOff,
} from "./checkin-checkout-service";

describe("check-in/check-out mutation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("preserves the scanner idempotency key across rapid duplicate submits", async () => {
    const companyId = "72000000-0000-4000-8000-000000000001";
    const clientUuid = "79200000-0000-4000-8000-000000000009";
    const input = {
      materialId: "79000000-0000-4000-8000-000000000005",
      quantity: 1,
      originLocationId: "76000000-0000-4000-8000-000000000001",
      responsibleType: "funcionario" as const,
      responsibleId: "77000000-0000-4000-8000-000000000001",
      purpose: "uso_interno" as const,
      condition: "bom" as const,
      clientUuid,
    };

    await Promise.all([
      registerCheckout(companyId, input),
      registerCheckout(companyId, input),
    ]);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][0]).toBe("registrar_checkout_material");
    expect(mocks.rpc.mock.calls[1][0]).toBe("registrar_checkout_material");
    expect(mocks.rpc.mock.calls[0][1]._client_uuid).toBe(clientUuid);
    expect(mocks.rpc.mock.calls[1][1]._client_uuid).toBe(clientUuid);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
  });

  it("sends a stock-neutral custody write-off only through the transactional RPC", async () => {
    await registerCustodyWriteOff("72000000-0000-4000-8000-000000000001", {
      custodyId: "78100000-0000-4000-8000-000000000001",
      quantity: 2,
      classification: "avariado",
      justification: "Dano irreversível constatado no local",
      note: "Fotos anexadas ao chamado",
      clientUuid: "78200000-0000-4000-8000-000000000001",
    });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "registrar_baixa_custodia_material",
      expect.objectContaining({
        _quantidade: 2,
        _classificacao: "avariado",
        _justificativa: "Dano irreversível constatado no local",
      }),
    );
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("_localizacao_destino_id");
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("_movimento_estoque_id");
  });
});

describe("listEventCustodyMaterials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes a single paginated request and maps snake_case rows to the camelCase summary shape", async () => {
    const rawRow = {
      material_id: "m1",
      material_nome: "Mesa de Som",
      material_codigo: "MESA-001",
      quantidade_retirada: 3,
      quantidade_devolvida: 1,
      quantidade_pendente: 2,
      custodias_abertas: [{ id: "op1" }],
    };
    mocks.rpc.mockResolvedValue({ data: [{ item: rawRow, total_count: 1 }], error: null });

    const result = await listEventCustodyMaterials(
      "72000000-0000-4000-8000-000000000001",
      "80800000-0000-4000-8000-000000000001",
      { pendente: true, page: 2, pageSize: 10, search: " mesa ", locationId: "loc1" },
    );

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("listar_custodias_evento_por_material", {
      _empresa_id: "72000000-0000-4000-8000-000000000001",
      _evento_id: "80800000-0000-4000-8000-000000000001",
      _pendente: true,
      _pagina: 2,
      _tamanho_pagina: 10,
      _busca: "mesa",
      _localizacao_id: "loc1",
    });
    expect(result).toEqual({
      total: 1,
      items: [
        {
          materialId: "m1",
          materialNome: "Mesa de Som",
          materialCodigo: "MESA-001",
          quantidadeRetirada: 3,
          quantidadeDevolvida: 1,
          quantidadePendente: 2,
          custodiasAbertas: [{ id: "op1" }],
        },
      ],
    });
  });

  it("returns an empty page without throwing when no rows come back", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const result = await listEventCustodyMaterials(
      "72000000-0000-4000-8000-000000000001",
      "80800000-0000-4000-8000-000000000001",
      { page: 1, pageSize: 10 },
    );

    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe("getEventCustodyTotals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the totals RPC's snake_case result to camelCase", async () => {
    mocks.rpc.mockResolvedValue({
      data: { total_retirado: 5, total_devolvido: 3, total_pendente: 2 },
      error: null,
    });

    const result = await getEventCustodyTotals(
      "72000000-0000-4000-8000-000000000001",
      "80800000-0000-4000-8000-000000000001",
    );

    expect(mocks.rpc).toHaveBeenCalledWith("obter_totais_custodia_evento", {
      _empresa_id: "72000000-0000-4000-8000-000000000001",
      _evento_id: "80800000-0000-4000-8000-000000000001",
      _busca: undefined,
      _localizacao_id: undefined,
    });
    expect(result).toEqual({ totalRetirado: 5, totalDevolvido: 3, totalPendente: 2 });
  });

  it("defaults to zero when the RPC returns no data", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const result = await getEventCustodyTotals(
      "72000000-0000-4000-8000-000000000001",
      "80800000-0000-4000-8000-000000000001",
    );

    expect(result).toEqual({ totalRetirado: 0, totalDevolvido: 0, totalPendente: 0 });
  });
});
