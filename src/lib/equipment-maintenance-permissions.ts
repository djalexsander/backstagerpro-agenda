export interface MaintenanceGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: MaintenanceGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

/**
 * "usuario" write actions are additionally gated by an explicit granular
 * grant (user_module_permissions on 'manutencao_equipamentos'), mirroring
 * rfid-permissions.ts/getCustodyPermissions - see
 * 20260911110000_maintenance_granular_write_permissions.sql for the backend
 * side. This module has no separate delete action - transicionar covers
 * cancelamento too - so editar/transicionar/gerenciarInsumos all key off the
 * same 'edit' grant.
 */
export function getMaintenancePermissions({ role, moduleEnabled, companyReadOnly, companySelected = true, granular }: {
  role: string | null; moduleEnabled: boolean; companyReadOnly: boolean; companySelected?: boolean;
  /** Grant granular do usuário atual para 'manutencao_equipamentos' - só relevante quando role === "usuario". */
  granular?: MaintenanceGranularPermission | null;
}) {
  const visualizar = companySelected && moduleEnabled && ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  const canWriteBase = visualizar && !companyReadOnly;

  if (role === "usuario") {
    const grant = granular ?? NO_GRANT;
    return {
      visualizar,
      criar: canWriteBase && grant.canCreate,
      editar: canWriteBase && grant.canEdit,
      transicionar: canWriteBase && grant.canEdit,
      gerenciarInsumos: canWriteBase && grant.canEdit,
      visualizarCustos: visualizar,
    };
  }

  const escrever = canWriteBase && ["master_admin", "admin_empresa"].includes(role ?? "");
  return { visualizar, criar: escrever, editar: escrever, transicionar: escrever, gerenciarInsumos: escrever, visualizarCustos: visualizar };
}
export function canShowMaintenanceNavigation({ isMasterAdmin, moduleEnabled }: { isMasterAdmin: boolean; moduleEnabled: boolean }) {
  return isMasterAdmin || moduleEnabled;
}
