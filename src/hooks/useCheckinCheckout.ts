import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listStockLocations } from "@/lib/stock-service";
import {
  getCustodyIndicators,
  listCustodyOperations,
  listCustodyResponsibles,
} from "@/lib/checkin-checkout-service";
import type { CustodyFilters } from "@/lib/checkin-checkout-types";

export function useCheckinCheckout({
  companyId,
  openPage,
  historyPage,
  pageSize,
  historyFilters,
  accessEnabled,
}: {
  companyId: string | null;
  openPage: number;
  historyPage: number;
  pageSize: number;
  historyFilters: CustodyFilters;
  accessEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const enabled = Boolean(companyId && accessEnabled);
  const emptyFilters: CustodyFilters = {
    search: "",
    status: "todos",
    purpose: "todos",
    responsible: "",
    executorId: "",
    locationId: "",
    dateFrom: "",
    dateTo: "",
  };
  const openQuery = useQuery({
    queryKey: ["material-custodies", companyId, "open", openPage, pageSize],
    queryFn: () =>
      listCustodyOperations({
        companyId: companyId!,
        page: openPage,
        pageSize,
        filters: emptyFilters,
        onlyOpen: true,
      }),
    enabled,
  });
  const historyQuery = useQuery({
    queryKey: [
      "material-custodies",
      companyId,
      "history",
      historyPage,
      pageSize,
      historyFilters,
    ],
    queryFn: () =>
      listCustodyOperations({
        companyId: companyId!,
        page: historyPage,
        pageSize,
        filters: historyFilters,
        onlyOpen: null,
      }),
    enabled,
  });
  const indicatorsQuery = useQuery({
    queryKey: ["material-custody-indicators", companyId],
    queryFn: () => getCustodyIndicators(companyId!),
    enabled,
  });
  const responsiblesQuery = useQuery({
    queryKey: ["material-custody-responsibles", companyId],
    queryFn: () => listCustodyResponsibles(companyId!),
    enabled,
  });
  const locationsQuery = useQuery({
    queryKey: ["stock-locations", companyId],
    queryFn: () => listStockLocations(companyId!, true),
    enabled,
  });

  const invalidateCustody = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["material-custodies", companyId] }),
      queryClient.invalidateQueries({
        queryKey: ["material-custody-indicators", companyId],
      }),
      queryClient.invalidateQueries({ queryKey: ["stock-materials", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["materials", companyId] }),
    ]);
  };

  return {
    openOperations: openQuery.data ?? { items: [], total: 0 },
    history: historyQuery.data ?? { items: [], total: 0 },
    indicators: indicatorsQuery.data ?? {
      itens_fora: 0,
      previstos_hoje: 0,
      atrasados: 0,
      ocorrencias: 0,
    },
    responsibles: responsiblesQuery.data ?? [],
    locations: locationsQuery.data ?? [],
    isLoading:
      openQuery.isLoading || indicatorsQuery.isLoading || locationsQuery.isLoading,
    error:
      openQuery.error || historyQuery.error || indicatorsQuery.error || locationsQuery.error,
    invalidateCustody,
  };
}
