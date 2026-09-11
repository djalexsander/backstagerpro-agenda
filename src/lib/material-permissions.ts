import type { AppRole } from "@/lib/user-role";

export interface MaterialPermissions {
  visualizar: boolean;
  criar: boolean;
  editar: boolean;
  inativar: boolean;
  gerenciarCategorias: boolean;
  gerenciarFotos: boolean;
  alterarStatus: boolean;
  gerarIdentificadores: boolean;
}

const NO_MATERIAL_PERMISSIONS: MaterialPermissions = {
  visualizar: false,
  criar: false,
  editar: false,
  inativar: false,
  gerenciarCategorias: false,
  gerenciarFotos: false,
  alterarStatus: false,
  gerarIdentificadores: false,
};

export interface MaterialGranularPermission {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: MaterialGranularPermission = {
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

export function canShowMaterialsNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}): boolean {
  return isMasterAdmin || moduleEnabled;
}

/**
 * Separa o entitlement comercial da empresa do papel individual.
 *
 * "usuario" write actions are additionally gated by an explicit granular
 * grant (user_module_permissions on 'gestao_materiais'), mirroring
 * rfid-permissions.ts/getCustodyPermissions - see
 * 20260911140000_materials_granular_write_permissions.sql for the backend
 * side. Unlike the RPC-backed modules in this rollout, Materiais writes
 * straight to the table via two RLS-enforced operations only (INSERT,
 * UPDATE - there is no DELETE policy on materiais at all, "inativar" is a
 * soft UPDATE), so editar/inativar/gerenciarCategorias/alterarStatus all key
 * off the same 'edit' grant, matching that single UPDATE policy's
 * granularity - same principle as equipment-maintenance-permissions.ts.
 * gerarIdentificadores stays role-only: its four RPCs
 * (generate_material_qr_code/generate_material_barcode/
 * replace_material_barcode/clear_material_barcode) were not part of this
 * migration's scope and remain can_write_company_module-only.
 * gerenciarFotos is included in the same 'edit' grant for API consistency,
 * though MaterialFormDialog.tsx does not currently gate the photo gallery on
 * it at all (pre-existing, unrelated to this change).
 */
export function getMaterialPermissions({
  role,
  moduleEnabled,
  companyReadOnly = false,
  granular,
}: {
  role: AppRole | null;
  moduleEnabled: boolean;
  companyReadOnly?: boolean;
  /** Grant granular do usuário atual para 'gestao_materiais' - só relevante quando role === "usuario". */
  granular?: MaterialGranularPermission | null;
}): MaterialPermissions {
  if (role === "master_admin") {
    return {
      visualizar: true,
      criar: true,
      editar: true,
      inativar: true,
      gerenciarCategorias: true,
      gerenciarFotos: true,
      alterarStatus: true,
      gerarIdentificadores: true,
    };
  }

  if (!moduleEnabled) return NO_MATERIAL_PERMISSIONS;

  if (role === "usuario") {
    const grant = granular ?? NO_GRANT;
    const canWrite = !companyReadOnly;
    return {
      visualizar: true,
      criar: canWrite && grant.canCreate,
      editar: canWrite && grant.canEdit,
      inativar: canWrite && grant.canEdit,
      gerenciarCategorias: canWrite && grant.canEdit,
      gerenciarFotos: canWrite && grant.canEdit,
      alterarStatus: canWrite && grant.canEdit,
      gerarIdentificadores: false,
    };
  }

  if (role === "admin_empresa") {
    const canWrite = !companyReadOnly;
    return {
      visualizar: true,
      criar: canWrite,
      editar: canWrite,
      inativar: canWrite,
      gerenciarCategorias: canWrite,
      gerenciarFotos: canWrite,
      alterarStatus: canWrite,
      gerarIdentificadores: canWrite,
    };
  }

  return NO_MATERIAL_PERMISSIONS;
}
