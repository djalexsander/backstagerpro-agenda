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
  listCustodyOperationsByReference,
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

describe("listCustodyOperationsByReference pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps requesting pages while a page comes back full (100 rows), and stops on the first short page", async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ item: { id: `page1-${index}` } }));
    const page2 = Array.from({ length: 37 }, (_, index) => ({ item: { id: `page2-${index}` } }));
    mocks.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => {
      if (args._pagina === 1) return Promise.resolve({ data: page1, error: null });
      if (args._pagina === 2) return Promise.resolve({ data: page2, error: null });
      throw new Error(`unexpected _pagina ${args._pagina}`);
    });

    const result = await listCustodyOperationsByReference(
      "72000000-0000-4000-8000-000000000001",
      "evento",
      "80800000-0000-4000-8000-000000000001",
    );

    // A 137-row result only comes out right if the second (partial) page's
    // rows were appended after the first (full) page's, not lost or
    // requested twice - this is the actual truncation bug being fixed.
    expect(result).toHaveLength(137);
    expect(result.map((item) => item.id)).toEqual([
      ...page1.map((row) => row.item.id),
      ...page2.map((row) => row.item.id),
    ]);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][0]).toBe("listar_custodias_materiais");
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      _pagina: 1,
      _tamanho_pagina: 100,
      _referencia_tipo: "evento",
      _referencia_id: "80800000-0000-4000-8000-000000000001",
    });
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ _pagina: 2, _tamanho_pagina: 100 });
  });

  it("makes a single request when the first page is already short (the common case)", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ item: { id: `op-${index}` } }));
    mocks.rpc.mockResolvedValue({ data: items, error: null });

    const result = await listCustodyOperationsByReference(
      "72000000-0000-4000-8000-000000000001",
      "evento",
      "80800000-0000-4000-8000-000000000001",
    );

    expect(result).toHaveLength(5);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("stops immediately on an empty first page instead of looping", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const result = await listCustodyOperationsByReference(
      "72000000-0000-4000-8000-000000000001",
      "evento",
      "80800000-0000-4000-8000-000000000001",
    );

    expect(result).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
