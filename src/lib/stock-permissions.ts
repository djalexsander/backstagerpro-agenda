export interface StockPermissions {
  visualizar: boolean;
  movimentar: boolean;
  gerenciarLocalizacoes: boolean;
  ajustar: boolean;
  estornar: boolean;
}

export function getStockPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): StockPermissions {
  const master = role === "master_admin";
  const admin = role === "admin_empresa";
  const user = role === "usuario";
  const canRead = companySelected && (master || (moduleEnabled && (admin || user)));
  const canWrite =
    canRead && (master || admin) && !companyReadOnly;
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
