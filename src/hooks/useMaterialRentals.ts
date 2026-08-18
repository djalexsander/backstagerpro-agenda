import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RENTAL_INVALIDATION_QUERY_KEYS,
  getRentalIndicators,
  listMaterialRentals,
  listRentalCustomers,
} from "@/lib/material-rental-service";
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
    // Without "rental-customers" here, a customer created through the
    // quick-register form (which calls onCustomerCreated -> invalidateRentals)
    // never shows up in this page's own customer list/selector - it's a
    // separate query key from "material-rentals" and was never invalidated,
    // so the newly created customer stayed invisible until a full page
    // reload re-fetched it. See RENTAL_INVALIDATION_QUERY_KEYS for the full
    // list (shared with the realtime domain registry so both paths stay in
    // sync).
    await Promise.all(
      RENTAL_INVALIDATION_QUERY_KEYS.map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, companyId] }),
      ),
    );
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
