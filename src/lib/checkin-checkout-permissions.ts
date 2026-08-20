// Projects the canonical role/module/read-only state onto this screen's
// four actions. It is not a parallel permission system: recognizedRole and
// the write roles below are the same three canonical roles used across the
// project (master_admin, admin_empresa, usuario). The backend RPCs re-check
// company, module and role independently, so this stays advisory for the UI.
//
// "usuario" write actions are additionally gated by an explicit granular
// grant (user_module_permissions on 'checkin_checkout'), mirroring
// rfid-permissions.ts/getRfidPermissions - see
// 20260819090000_checkin_checkout_granular_write_permissions.sql for the
// backend side (resolve_custody_company/registrar_checkout_material/
// registrar_checkin_material/cancelar_checkout_material/
// registrar_baixa_custodia_material all now consult the same grant via
// user_has_module_action). Unlike RFID, `visualizar` is deliberately NOT
// gated by the grant: can_read_company_module has no per-user grant
// requirement for this module (never did), so keeping visualizar on
// role+module alone matches the backend instead of drifting stricter than
// it.
export interface CustodyPermissions {
  visualizar: boolean;
  checkout: boolean;
  checkin: boolean;
  cancelar: boolean;
}

export interface CustodyGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: CustodyGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

export function getCustodyPermissions({
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
  /** Grant granular do usuário atual para 'checkin_checkout' - só relevante quando role === "usuario". */
  granular?: CustodyGranularPermission | null;
}): CustodyPermissions {
  const recognizedRole = ["master_admin", "admin_empresa", "usuario"].includes(
    role ?? "",
  );
  const canRead = companySelected && moduleEnabled && recognizedRole;
  const canWriteBase = canRead && !companyReadOnly;

  if (role === "usuario") {
    const grant = granular ?? NO_GRANT;
    return {
      visualizar: canRead,
      checkout: canWriteBase && grant.canCreate,
      checkin: canWriteBase && grant.canEdit,
      cancelar: canWriteBase && grant.canDelete,
    };
  }

  const canWrite = canWriteBase && ["master_admin", "admin_empresa"].includes(role ?? "");
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
