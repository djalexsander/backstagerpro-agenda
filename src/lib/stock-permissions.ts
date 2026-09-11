export interface StockPermissions {
  visualizar: boolean;
  movimentar: boolean;
  gerenciarLocalizacoes: boolean;
  ajustar: boolean;
  estornar: boolean;
}

export interface StockGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: StockGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

/**
 * "usuario" write actions are additionally gated by an explicit granular
 * grant (user_module_permissions on 'controle_estoque'), mirroring
 * rfid-permissions.ts/getCustodyPermissions - see
 * 20260911100000_stock_granular_write_permissions.sql for the backend side
 * (resolve_stock_company/registrar_movimentacao_estoque/
 * ajustar_estoque_material/estornar_movimentacao_estoque all consult the
 * same grant via user_has_module_action). gerenciarLocalizacoes is
 * deliberately NOT granted by this grant: estoque_localizacoes CRUD stays
 * behind RLS policies literally named "Company admins create/update/delete
 * stock locations" (20260806060000) - a company-configuration concern, not
 * an operational action a usuario would be granted.
 */
export function getStockPermissions({
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
  /** Grant granular do usuário atual para 'controle_estoque' - só relevante quando role === "usuario". */
  granular?: StockGranularPermission | null;
}): StockPermissions {
  const master = role === "master_admin";
  const admin = role === "admin_empresa";
  const user = role === "usuario";
  const canRead =
    companySelected && moduleEnabled && (master || admin || user);
  const canWriteBase = canRead && !companyReadOnly;

  if (user) {
    const grant = granular ?? NO_GRANT;
    return {
      visualizar: canRead,
      movimentar: canWriteBase && grant.canCreate,
      gerenciarLocalizacoes: false,
      ajustar: canWriteBase && grant.canEdit,
      estornar: canWriteBase && grant.canDelete,
    };
  }

  const canWrite = canWriteBase && (master || admin);
  return {
    visualizar: canRead,
    movimentar: canWrite,
    gerenciarLocalizacoes: canWrite,
    ajustar: canWrite,
    estornar: canWrite,
  };
}

export function canShowStockNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
