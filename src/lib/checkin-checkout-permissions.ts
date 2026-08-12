// Projects the canonical role/module/read-only state onto this screen's
// four actions. It is not a parallel permission system: recognizedRole and
// the write roles below are the same three canonical roles used across the
// project (master_admin, admin_empresa, usuario). The backend RPCs re-check
// company, module and role independently, so this stays advisory for the UI.
export interface CustodyPermissions {
  visualizar: boolean;
  checkout: boolean;
  checkin: boolean;
  cancelar: boolean;
}

export function getCustodyPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): CustodyPermissions {
  const recognizedRole = ["master_admin", "admin_empresa", "usuario"].includes(
    role ?? "",
  );
  const canRead = companySelected && moduleEnabled && recognizedRole;
  const canWrite =
    canRead && ["master_admin", "admin_empresa"].includes(role ?? "") && !companyReadOnly;
  return {
    visualizar: canRead,
    checkout: canWrite,
    checkin: canWrite,
    cancelar: canWrite,
  };
}

export function canShowCustodyNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
