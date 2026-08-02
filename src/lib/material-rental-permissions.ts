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

export function getRentalPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): RentalPermissions {
  const canRead =
    companySelected &&
    moduleEnabled &&
    ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  const canWrite =
    canRead &&
    !companyReadOnly &&
    ["master_admin", "admin_empresa"].includes(role ?? "");
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
