import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRentalIndicators, listMaterialRentals, listRentalCustomers } from "@/lib/material-rental-service";
import type { RentalFilters } from "@/lib/material-rental-types";

export function useMaterialRentals({
  companyId,
  page,
  pageSize,
  filters,
  enabled,
}: {
  companyId: string | null;
  page: number;
  pageSize: number;
  filters: RentalFilters;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const canQuery = Boolean(companyId && enabled);
  const rentals = useQuery({
    queryKey: ["material-rentals", companyId, page, pageSize, filters],
    queryFn: () => listMaterialRentals({ companyId: companyId!, page, pageSize, filters }),
    enabled: canQuery,
  });
  const indicators = useQuery({
    queryKey: ["material-rental-indicators", companyId],
    queryFn: () => getRentalIndicators(companyId!),
    enabled: canQuery,
  });
  const customers = useQuery({
    queryKey: ["rental-customers", companyId],
    queryFn: () => listRentalCustomers(companyId!),
    enabled: canQuery,
  });

  const invalidateRentals = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["material-rentals", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["material-rental-indicators", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["material-rental-detail", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["material-custodies", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["stock-materials", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements", companyId] }),
    ]);
  };

  return {
    rentals: rentals.data ?? { items: [], total: 0 },
    indicators: indicators.data ?? {
      em_andamento: 0,
      retiradas_hoje: 0,
      devolucoes_hoje: 0,
      atrasadas: 0,
    },
    customers: customers.data ?? [],
    isLoading: rentals.isLoading || indicators.isLoading || customers.isLoading,
    error: rentals.error || indicators.error || customers.error,
    invalidateRentals,
  };
}
