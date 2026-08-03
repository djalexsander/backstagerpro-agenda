import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMaintenanceIndicators, listMaintenanceOrders } from "@/lib/equipment-maintenance-service";
import type { MaintenanceFilters } from "@/lib/equipment-maintenance-types";

export function useEquipmentMaintenance({ companyId, page, pageSize, filters, enabled }: {
  companyId: string | null; page: number; pageSize: number; filters: MaintenanceFilters; enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const canQuery = Boolean(companyId && enabled);
  const orders = useQuery({ queryKey: ["equipment-maintenance", companyId, page, pageSize, filters],
    queryFn: () => listMaintenanceOrders({ companyId: companyId!, page, pageSize, filters }), enabled: canQuery });
  const indicators = useQuery({ queryKey: ["equipment-maintenance-indicators", companyId],
    queryFn: () => getMaintenanceIndicators(companyId!), enabled: canQuery });
  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["equipment-maintenance", companyId] }),
    queryClient.invalidateQueries({ queryKey: ["equipment-maintenance-indicators", companyId] }),
    queryClient.invalidateQueries({ queryKey: ["equipment-maintenance-detail", companyId] }),
    queryClient.invalidateQueries({ queryKey: ["material-rentals", companyId] }),
    queryClient.invalidateQueries({ queryKey: ["material-custodies", companyId] }),
  ]);
  return { orders: orders.data ?? { items: [], total: 0 }, indicators: indicators.data ?? {
    abertas: 0, em_manutencao: 0, aguardando_peca: 0, preventivas_proximas: 0, atrasadas: 0,
  }, isLoading: orders.isLoading || indicators.isLoading, error: orders.error || indicators.error, invalidate };
}
