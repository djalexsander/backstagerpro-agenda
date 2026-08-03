export function getMaintenancePermissions({ role, moduleEnabled, companyReadOnly, companySelected = true }: {
  role: string | null; moduleEnabled: boolean; companyReadOnly: boolean; companySelected?: boolean;
}) {
  const visualizar = companySelected && moduleEnabled && ["master_admin", "admin_empresa", "usuario"].includes(role ?? "");
  const escrever = visualizar && !companyReadOnly && ["master_admin", "admin_empresa"].includes(role ?? "");
  return { visualizar, criar: escrever, editar: escrever, transicionar: escrever, gerenciarInsumos: escrever, visualizarCustos: visualizar };
}
export function canShowMaintenanceNavigation({ isMasterAdmin, moduleEnabled }: { isMasterAdmin: boolean; moduleEnabled: boolean }) {
  return isMasterAdmin || moduleEnabled;
}
