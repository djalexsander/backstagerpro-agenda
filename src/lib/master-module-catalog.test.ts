import { describe, expect, it, vi } from "vitest";
import { fetchMasterModuleCatalog } from "./master-module-catalog";

describe("fetchMasterModuleCatalog", () => {
  it("loads the remote module catalog directly from the table", async () => {
    const select = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [{ feature_key: "gestao_materiais" }], error: null });
    const supabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({ select, order }),
    } as any;

    const rows = await fetchMasterModuleCatalog(supabase);

    expect(rows).toEqual([{ feature_key: "gestao_materiais" }]);
    expect(supabase.from).toHaveBeenCalledWith("module_catalog");
    expect(select).toHaveBeenCalledWith("*");
    expect(order).toHaveBeenCalledWith("ordem", { ascending: true });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("surfaces table errors from the remote catalog query", async () => {
    const error = new Error("catalog unavailable");
    const supabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockRejectedValue(error),
      }),
    } as any;

    await expect(fetchMasterModuleCatalog(supabase)).rejects.toThrow("catalog unavailable");
  });
});
