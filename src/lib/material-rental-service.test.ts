import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

import { confirmMaterialRental, createMaterialRental, registerRentalCheckout } from "./material-rental-service";

describe("material rental idempotent service boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: { id: "rental", numero: "LOC-2026-000001" }, error: null });
  });

  it("preserves the creation key across duplicate network submissions", async () => {
    const input = {
      customerId: "customer",
      withdrawalAt: "2026-08-10T10:00:00Z",
      returnAt: "2026-08-12T10:00:00Z",
      responsibleType: "usuario" as const,
      responsibleId: "user",
      clientUuid: "request-create",
    };
    await Promise.all([createMaterialRental("company", input), createMaterialRental("company", input)]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
    expect(mocks.rpc.mock.calls[0][1]._client_uuid).toBe("request-create");
  });

  it("sends the payment condition chosen during confirmation to the RPC", async () => {
    await confirmMaterialRental("company", "rental", "request-avista", {
      formaCobranca: "avista",
      vencimento: "2026-09-01",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("confirmar_reserva_locacao_material", expect.objectContaining({
      _forma_cobranca: "avista", _vencimento: "2026-09-01", _parcelas: undefined,
    }));

    mocks.rpc.mockClear();
    const parcelas = [{ numero: 1, valor: 50, vencimento: "2026-09-01" }, { numero: 2, valor: 50, vencimento: "2026-10-01" }];
    await confirmMaterialRental("company", "rental", "request-parcelado", {
      formaCobranca: "parcelado",
      parcelas,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("confirmar_reserva_locacao_material", expect.objectContaining({
      _forma_cobranca: "parcelado", _vencimento: undefined, _parcelas: parcelas,
    }));
  });

  it("preserves confirmation and checkout keys supplied by the UI retry", async () => {
    await Promise.all([
      confirmMaterialRental("company", "rental", "request-confirm"),
      confirmMaterialRental("company", "rental", "request-confirm"),
    ]);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
    mocks.rpc.mockClear();
    const checkout = {
      rentalId: "rental",
      itemId: "item",
      quantity: 7,
      locationId: "location",
      responsibleType: "usuario" as const,
      responsibleId: "user",
      condition: "bom",
      clientUuid: "request-checkout",
    };
    await Promise.all([
      registerRentalCheckout("company", checkout),
      registerRentalCheckout("company", checkout),
    ]);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
    expect(mocks.rpc.mock.calls[1][1]._client_uuid).toBe("request-checkout");
  });
});
