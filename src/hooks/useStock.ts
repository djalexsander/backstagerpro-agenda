import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getStockIndicators,
  listStockCategories,
  listStockLocations,
  listStockMaterialOptions,
  listStockUsers,
  listStockMaterials,
  listStockMovements,
} from "@/lib/stock-service";
import type {
  StockFilters,
  StockMovementFilters,
} from "@/lib/stock-types";

export function useStock({
  companyId: requestedCompanyId,
  page,
  pageSize,
  filters,
  historyPage,
  historyFilters,
  accessEnabled = true,
}: {
  companyId?: string | null;
  page: number;
  pageSize: number;
  filters: StockFilters;
  historyPage: number;
  historyFilters: StockMovementFilters;
  accessEnabled?: boolean;
}) {
  const { empresaId: authenticatedCompanyId } = useAuth();
  const empresaId = requestedCompanyId ?? authenticatedCompanyId;
  const queryClient = useQueryClient();
  const enabled = !!empresaId && accessEnabled;
  const locationsQuery = useQuery({
    queryKey: ["stock-locations", empresaId],
    queryFn: () => listStockLocations(empresaId!, true),
    enabled,
  });
  const materialsQuery = useQuery({
    queryKey: ["stock-materials", empresaId, page, pageSize, filters],
    queryFn: () =>
      listStockMaterials({
        companyId: empresaId!,
        page,
        pageSize,
        filters,
      }),
    enabled,
  });
  const materialOptionsQuery = useQuery({
    queryKey: ["stock-material-options", empresaId],
    queryFn: () => listStockMaterialOptions(empresaId!),
    enabled,
  });
  const categoriesQuery = useQuery({
    queryKey: ["stock-categories", empresaId],
    queryFn: () => listStockCategories(empresaId!),
    enabled,
  });
  const usersQuery = useQuery({
    queryKey: ["stock-users", empresaId],
    queryFn: () => listStockUsers(empresaId!),
    enabled,
  });
  const indicatorsQuery = useQuery({
    queryKey: ["stock-indicators", empresaId],
    queryFn: () => getStockIndicators(empresaId!),
    enabled,
  });
  const historyQuery = useQuery({
    queryKey: [
      "stock-movements",
      empresaId,
      historyPage,
      pageSize,
      historyFilters,
    ],
    queryFn: () =>
      listStockMovements({
        companyId: empresaId!,
        page: historyPage,
        pageSize,
        filters: historyFilters,
      }),
    enabled,
  });

  const invalidateStock = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock-materials", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["stock-indicators", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["materials", empresaId] }),
    ]);
  };
  const invalidateLocations = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock-locations", empresaId] }),
      invalidateStock(),
    ]);
  };

  return {
    empresaId,
    locations: locationsQuery.data ?? [],
    materialsPage: materialsQuery.data ?? { items: [], total: 0 },
    materialOptions: materialOptionsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    users: usersQuery.data ?? [],
    indicators:
      indicatorsQuery.data ??
      {
        materiais: 0,
        unidades: 0,
        abaixoMinimo: 0,
        semSaldo: 0,
        localizacoesAtivas: 0,
        movimentacoesRecentes: 0,
      },
    historyPage: historyQuery.data ?? { items: [], total: 0 },
    isLoading:
      materialsQuery.isLoading ||
      locationsQuery.isLoading ||
      indicatorsQuery.isLoading,
    error:
      materialsQuery.error ||
      locationsQuery.error ||
      indicatorsQuery.error ||
      historyQuery.error,
    invalidateStock,
    invalidateLocations,
  };
}
