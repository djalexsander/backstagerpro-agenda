// Tela somente leitura, gated por gestao_materiais via
// user_has_module_action (mesmo mecanismo granular por usuário de
// rfid-permissions.ts) em vez do corte só-por-papel que a maioria dos
// outros módulos ainda usa - ver resolve_material_traceability_company em
// 20260814100000_material_traceability_foundation.sql. admin_empresa/
// master_admin continuam irrestritos (como sempre); um "usuario" precisa de
// um grant explícito de "visualizar" em Gestão de Materiais - como esse
// módulo é anterior ao backfill de 20260810090000_user_module_permissions.sql,
// quem já enxergava /materiais antes já tem esse grant.
export interface TraceabilityPermissions {
  visualizar: boolean;
}

export interface TraceabilityGranularPermission {
  canView: boolean;
}

export function getTraceabilityPermissions({
  role,
  moduleEnabled,
  companySelected = true,
  granular,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companySelected?: boolean;
  /** Grant granular do usuário atual para 'gestao_materiais' - só relevante quando role === "usuario". */
  granular?: TraceabilityGranularPermission | null;
}): TraceabilityPermissions {
  const canRead = companySelected && moduleEnabled;

  if (["master_admin", "admin_empresa"].includes(role ?? "")) {
    return { visualizar: canRead };
  }
  if (role !== "usuario") {
    return { visualizar: false };
  }
  return { visualizar: canRead && (granular?.canView ?? false) };
}

/**
 * Mostrar o item de menu depende só de papel/módulo contratado, mesmo padrão
 * de canShowRfidNavigation - a permissão granular por usuário só reage
 * dentro da própria tela (mensagem de "sem permissão"), não escondendo o
 * item do menu.
 */
export function canShowTraceabilityNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
