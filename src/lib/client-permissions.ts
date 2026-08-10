export interface ClientPermissions {
  visualizar: boolean;
  criar: boolean;
  editar: boolean;
  alternarStatus: boolean;
}

export function getClientPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): ClientPermissions {
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
    alternarStatus: canWrite,
  };
}

export function canShowClientsNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
