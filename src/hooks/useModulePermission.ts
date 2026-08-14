import { useQuery } from "@tanstack/react-query";
import { fetchUserModulePermissions, type ModulePermissionEntry } from "@/lib/user-module-permissions-service";

/**
 * Permissão granular (visualizar/criar/editar/excluir) do usuário atual
 * (self-read) para UM feature_key específico. Só busca quando role ===
 * "usuario": admin_empresa/master_admin têm acesso irrestrito via
 * can_write_company_data e nunca são regidos por user_module_permissions -
 * mesma regra que o backend aplica em user_has_module_action(), espelhada
 * aqui só para não pedir uma permissão que o servidor vai recusar de
 * qualquer forma.
 */
export function useModulePermission({
  companyId,
  featureKey,
  role,
}: {
  companyId: string | null;
  featureKey: string;
  role: string | null;
}): { permission: ModulePermissionEntry | null; isLoading: boolean } {
  const enabled = Boolean(companyId) && role === "usuario";
  const query = useQuery({
    queryKey: ["user-module-permission", companyId, featureKey],
    queryFn: () => fetchUserModulePermissions(companyId!),
    enabled,
  });
  const permission = query.data?.find((entry) => entry.featureKey === featureKey) ?? null;
  return { permission, isLoading: enabled && query.isLoading };
}
