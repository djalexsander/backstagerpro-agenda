import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  listMaterialCategories,
  listMaterials,
} from "@/lib/material-service";

export function useMaterials() {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ["material-categories", empresaId],
    queryFn: () => listMaterialCategories(empresaId!),
    enabled: !!empresaId,
  });

  const materialsQuery = useQuery({
    queryKey: ["materials", empresaId],
    queryFn: () => listMaterials(empresaId!),
    enabled: !!empresaId,
  });

  const invalidateMaterials = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["materials", empresaId],
    });
  };

  const invalidateCategories = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["material-categories", empresaId],
      }),
      invalidateMaterials(),
    ]);
  };

  return {
    empresaId,
    categories: categoriesQuery.data ?? [],
    materials: materialsQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || materialsQuery.isLoading,
    error: categoriesQuery.error || materialsQuery.error,
    invalidateMaterials,
    invalidateCategories,
  };
}

