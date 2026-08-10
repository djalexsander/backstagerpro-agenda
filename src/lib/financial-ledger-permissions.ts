export interface FinancialLedgerPermissions {
  visualizar: boolean;
  registrarRecebimento: boolean;
  estornar: boolean;
}

// Mirrors the RLS already in place on financeiro_lancamentos/financeiro_recebimentos
// (and on the pre-existing `financials` table): only master_admin or an
// admin_empresa with the financeiro_avancado module active. "usuario" has no
// access here - this module was already admin-only before this feature.
export function getFinancialLedgerPermissions({
  role,
  moduleEnabled,
  companyReadOnly,
  companySelected = true,
}: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): FinancialLedgerPermissions {
  const canRead =
    companySelected &&
    moduleEnabled &&
    ["master_admin", "admin_empresa"].includes(role ?? "");
  return {
    visualizar: canRead,
    registrarRecebimento: canRead && !companyReadOnly,
    estornar: canRead && !companyReadOnly,
  };
}
