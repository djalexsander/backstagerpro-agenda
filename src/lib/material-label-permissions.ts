export interface MaterialLabelGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: MaterialLabelGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

/**
 * "usuario" gets imprimir gated by an explicit granular grant
 * (user_module_permissions on 'etiquetas_materiais', can_create) - see
 * 20260911120000_labels_granular_print_permission.sql. gerenciarModelos
 * stays admin-only on purpose: label templates are a company-configuration
 * concern (mirrors printer-permissions.ts's configurar), not something the
 * backend extends to a granular grant - a print grant must never unlock it.
 */
export function getMaterialLabelPermissions({ role, moduleEnabled, companyReadOnly, companySelected = true, granular }: {
  role: string | null; moduleEnabled: boolean; companyReadOnly: boolean; companySelected?: boolean;
  /** Grant granular do usuário atual para 'etiquetas_materiais' - só relevante quando role === "usuario". */
  granular?: MaterialLabelGranularPermission | null;
}) {
  const visualizar = companySelected && moduleEnabled && ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  const canWriteBase = visualizar && !companyReadOnly;

  if (role === "usuario") {
    const grant = granular ?? NO_GRANT;
    return { visualizar, imprimir: canWriteBase && grant.canCreate, gerenciarModelos: false };
  }

  const escrever = canWriteBase && ["master_admin", "admin_empresa"].includes(role ?? "");
  return { visualizar, imprimir: escrever, gerenciarModelos: escrever };
}

export function canShowMaterialLabelsNavigation({ isMasterAdmin, moduleEnabled }: { isMasterAdmin: boolean; moduleEnabled: boolean }) {
  return isMasterAdmin || moduleEnabled;
}
