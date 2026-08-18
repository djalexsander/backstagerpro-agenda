import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useCheckinCheckout } from "./useCheckinCheckout";

vi.mock("@/lib/checkin-checkout-service", () => ({
  // Kept in sync by hand with the real export (checkin-checkout-service.ts)
  // - this file fully replaces the module, so the real constant is never
  // loaded here.
  CUSTODY_INVALIDATION_QUERY_KEYS: [
    "material-custodies",
    "material-custody-indicators",
    "stock-materials",
    "stock-movements",
    "stock-indicators",
    "materials",
    "material-rentals",
    "material-rental-indicators",
    "material-rental-detail",
  ],
  listCustodyOperations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getCustodyIndicators: vi.fn().mockResolvedValue({
    itens_fora: 0,
    previstos_hoje: 0,
    atrasados: 0,
    ocorrencias: 0,
  }),
  listCustodyResponsibles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/stock-service", () => ({
  listStockLocations: vi.fn().mockResolvedValue([]),
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

const emptyFilters = {
  search: "",
  status: "todos" as const,
  purpose: "todos" as const,
  responsible: "",
  executorId: "",
  locationId: "",
  dateFrom: "",
  dateTo: "",
};

describe("useCheckinCheckout", () => {
  it("also invalidates the Locações queries so a rental-linked checkin/checkout is reflected there without a manual reload", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () =>
        useCheckinCheckout({
          companyId: "company-1",
          openPage: 1,
          historyPage: 1,
          pageSize: 10,
          historyFilters: emptyFilters,
          accessEnabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.invalidateCustody();

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["material-rentals", "company-1"]);
    expect(invalidatedKeys).toContainEqual(["material-rental-indicators", "company-1"]);
    expect(invalidatedKeys).toContainEqual(["material-rental-detail", "company-1"]);
    // Estoque page's own KPI cards (movimentacoesRecentes etc.) via useStock.
    expect(invalidatedKeys).toContainEqual(["stock-indicators", "company-1"]);
    // pre-existing invalidations must still be there (regression guard)
    expect(invalidatedKeys).toContainEqual(["material-custodies", "company-1"]);
    expect(invalidatedKeys).toContainEqual(["stock-materials", "company-1"]);
  });
});
