// RFID é um módulo comercial (rfid_materiais) como qualquer outro, mas é o
// PRIMEIRO gated pelo sistema granular por usuário (user_module_permissions/
// user_has_module_action, 20260810090000_user_module_permissions.sql) em vez
// do corte "admin_empresa/master escrevem, usuario só lê" que todo outro
// módulo usa hoje. Isso é consultivo para a UI (evita mostrar uma ação que o
// servidor vai recusar) - a autoridade real está nas RPCs de
// 20260814090000_rfid_uhf_foundation.sql, que chamam exatamente a mesma
// user_has_module_action().
//
// admin_empresa/master_admin continuam com acesso irrestrito (como sempre -
// can_write_company_data nunca depende desta tabela para eles). Um "usuario"
// precisa de um grant explícito por ação: ter o módulo contratado pela
// empresa não basta (nem para visualizar) - ver useModulePermission.ts para
// buscar esse grant.
export interface RfidPermissions {
  visualizar: boolean;
  vincularTag: boolean;
  trocarTag: boolean;
  desativarTag: boolean;
  iniciarConferencia: boolean;
  configurarReader: boolean;
}

export interface RfidGranularPermission {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const NO_GRANT: RfidGranularPermission = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

export function getRfidPermissions({
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
  /** Grant granular do usuário atual para 'rfid_materiais' - só relevante quando role === "usuario". */
  granular?: RfidGranularPermission | null;
}): RfidPermissions {
  const canRead = companySelected && moduleEnabled;
  const canWriteBase = canRead && !companyReadOnly;

  if (["master_admin", "admin_empresa"].includes(role ?? "")) {
    return {
      visualizar: canRead,
      vincularTag: canWriteBase,
      trocarTag: canWriteBase,
      desativarTag: canWriteBase,
      iniciarConferencia: canWriteBase,
      configurarReader: canWriteBase,
    };
  }

  if (role !== "usuario") {
    return {
      visualizar: false,
      vincularTag: false,
      trocarTag: false,
      desativarTag: false,
      iniciarConferencia: false,
      configurarReader: false,
    };
  }

  const grant = granular ?? NO_GRANT;
  return {
    visualizar: canRead && grant.canView,
    vincularTag: canWriteBase && grant.canCreate,
    trocarTag: canWriteBase && grant.canCreate,
    desativarTag: canWriteBase && grant.canDelete,
    iniciarConferencia: canWriteBase && grant.canCreate,
    configurarReader: canWriteBase && grant.canEdit,
  };
}

/**
 * Mostrar o item de menu depende só de papel/módulo contratado, igual a
 * todo outro item da sidebar - nenhum item de menu hoje é escondido por
 * permissão granular por usuário (só a tela em si reage a isso, com uma
 * mensagem clara de "sem permissão" em vez de um item de menu que some).
 * Manter esta função consistente com esse padrão evita que RFID seja o único
 * módulo com comportamento de menu diferente do resto do sistema.
 */
export function canShowRfidNavigation({
  isMasterAdmin,
  moduleEnabled,
}: {
  isMasterAdmin: boolean;
  moduleEnabled: boolean;
}) {
  return isMasterAdmin || moduleEnabled;
}
