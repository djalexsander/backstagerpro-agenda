export interface RentalPermissions {
  visualizar: boolean;
  criar: boolean;
  editar: boolean;
  reservar: boolean;
  retirar: boolean;
  devolver: boolean;
  cancelar: boolean;
  visualizarValores: boolean;
}

export interface RentalGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: RentalGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

/**
 * "usuario" write actions are additionally gated by an explicit granular
 * grant (user_module_permissions on 'locacao_materiais'), mirroring
 * rfid-permissions.ts/getCustodyPermissions - see
 * 20260911130000_rental_granular_write_permissions.sql for the backend side.
 * reservar/editar share the 'edit' grant (both progress/modify an existing
 * rental, same as the backend's action mapping); retirar shares 'create'
 * with criar (registrar_retirada_locacao_material requires locacao_materiais
 * 'create' AND checkin_checkout 'create' on the backend - this frontend
 * approximation only reflects the locação-side grant, matching how the
 * backend's own defense in depth, not a duplicated frontend check, is what
 * enforces the checkin_checkout side).
 */
export function getRentalPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
  granular,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
  /** Grant granular do usuário atual para 'locacao_materiais' - só relevante quando role === "usuario". */
  granular?: RentalGranularPermission | null;
}): RentalPermissions {
  const canRead =
    companySelected &&
    moduleEnabled &&
    ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  const canWriteBase = canRead && !companyReadOnly;

  if (role === "usuario") {
    const grant = granular ?? NO_GRANT;
    return {
      visualizar: canRead,
      criar: canWriteBase && grant.canCreate,
      editar: canWriteBase && grant.canEdit,
      reservar: canWriteBase && grant.canEdit,
      retirar: canWriteBase && grant.canCreate,
      devolver: canWriteBase && grant.canEdit,
      cancelar: canWriteBase && grant.canDelete,
      visualizarValores: canRead,
    };
  }

  const canWrite = canWriteBase && ["master_admin", "admin_empresa"].includes(role ?? "");
  return {
    visualizar: canRead,
    criar: canWrite,
    editar: canWrite,
    reservar: canWrite,
    retirar: canWrite,
    devolver: canWrite,
    cancelar: canWrite,
    visualizarValores: canRead,
  };
}

export function canShowRentalNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
