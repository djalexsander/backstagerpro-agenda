import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMaterialRentals } from "./useMaterialRentals";

vi.mock("@/lib/material-rental-service", () => ({
  // Kept in sync by hand with the real export (material-rental-service.ts)
  // - this file fully replaces the module, so the real constant is never
  // loaded here.
  RENTAL_INVALIDATION_QUERY_KEYS: [
    "material-rentals",
    "material-rental-indicators",
    "material-rental-detail",
    "material-custodies",
    "stock-materials",
    "stock-movements",
    "rental-customers",
  ],
  listMaterialRentals: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getRentalIndicators: vi.fn().mockResolvedValue({
    em_andamento: 0,
    retiradas_hoje: 0,
    devolucoes_hoje: 0,
    atrasadas: 0,
  }),
  listRentalCustomers: vi.fn().mockResolvedValue([]),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const filters = {
  search: "",
  status: "todos" as const,
  customerId: "",
  dateFrom: "",
  dateTo: "",
  overdueOnly: false,
  responsible: "",
};

describe("useMaterialRentals", () => {
  it("invalidates the rental-customers query so a newly created customer shows up immediately", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () =>
        useMaterialRentals({
          companyId: "company-1",
          page: 1,
          pageSize: 10,
          filters,
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.invalidateRentals();

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["rental-customers", "company-1"]);
  });
});
