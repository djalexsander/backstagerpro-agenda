import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

import { registerCheckout } from "./checkin-checkout-service";

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
});
