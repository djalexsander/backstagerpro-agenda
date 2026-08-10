export interface PrinterPermissions {
  visualizar: boolean;
  configurar: boolean;
}

// Mirrors RLS on empresa_impressora_config: SELECT for any company member
// (can_read_company_data), write only for admin_empresa/master
// (can_write_company_data). "usuario" can read the configured format to
// print correctly, but cannot change it - matches what was asked
// explicitly, not a new permission model.
export function getPrinterPermissions({
  role,
  companySelected = true,
}: {
  role: string | null;
  companySelected?: boolean;
}): PrinterPermissions {
  const knownRole = ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  return {
    visualizar: companySelected && knownRole,
    configurar: companySelected && ["master_admin", "admin_empresa"].includes(role ?? ""),
  };
}
