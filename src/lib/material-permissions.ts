import type { AppRole } from "@/lib/user-role";

export interface MaterialPermissions {
  visualizar: boolean;
  criar: boolean;
  editar: boolean;
  inativar: boolean;
  gerenciarCategorias: boolean;
  gerenciarFotos: boolean;
  alterarStatus: boolean;
  gerarIdentificadores: boolean;
}

const NO_MATERIAL_PERMISSIONS: MaterialPermissions = {
  visualizar: false,
  criar: false,
  editar: false,
  inativar: false,
  gerenciarCategorias: false,
  gerenciarFotos: false,
  alterarStatus: false,
  gerarIdentificadores: false,
};

export function canShowMaterialsNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}): boolean {
  return isMasterAdmin || moduleEnabled;
}

/**
 * Separa o entitlement comercial da empresa do papel individual.
 *
 * O projeto ainda não possui ACL granular por operação. Esta etapa formaliza
 * o padrão canônico: usuário consulta; administrador gerencia; master possui
 * acesso global.
 */
export function getMaterialPermissions({
  role,
  moduleEnabled,
  companyReadOnly = false,
}: {
  role: AppRole | null;
  moduleEnabled: boolean;
  companyReadOnly?: boolean;
}): MaterialPermissions {
  if (role === "master_admin") {
    return {
      visualizar: true,
      criar: true,
      editar: true,
      inativar: true,
      gerenciarCategorias: true,
      gerenciarFotos: true,
      alterarStatus: true,
      gerarIdentificadores: true,
    };
  }

  if (!moduleEnabled) return NO_MATERIAL_PERMISSIONS;

  if (role === "usuario") {
    return {
      ...NO_MATERIAL_PERMISSIONS,
      visualizar: true,
    };
  }

  if (role === "admin_empresa") {
    const canWrite = !companyReadOnly;
    return {
      visualizar: true,
      criar: canWrite,
      editar: canWrite,
      inativar: canWrite,
      gerenciarCategorias: canWrite,
      gerenciarFotos: canWrite,
      alterarStatus: canWrite,
      gerarIdentificadores: canWrite,
    };
  }

  return NO_MATERIAL_PERMISSIONS;
}
