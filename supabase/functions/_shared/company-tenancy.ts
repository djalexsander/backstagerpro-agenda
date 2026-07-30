export type CompanyRole = "admin_empresa" | "usuario";

type DeriveCompanyForCompanyAdminInput = {
  callerEmpresaId: string | null | undefined;
  requestedEmpresaId?: unknown;
};

type ResolveRequestedCompanyInput = {
  requestedEmpresaId: string | null | undefined;
  callerEmpresaId: string | null | undefined;
  isMaster: boolean;
  isAdmin: boolean;
};

export function validateCompanyManagedRole(role: unknown): CompanyRole {
  if (role === "admin_empresa" || role === "usuario") {
    return role;
  }

  throw new Error(
    "Papel inválido. Administradores de empresa só podem criar admin_empresa ou usuario",
  );
}

export function deriveCompanyForCompanyAdmin({
  callerEmpresaId,
  requestedEmpresaId,
}: DeriveCompanyForCompanyAdminInput): string {
  if (!callerEmpresaId) {
    throw new Error("Administrador sem empresa vinculada");
  }

  // The body is never authoritative. A mismatched legacy/malicious value is
  // rejected, while an omitted or matching value still resolves from profile.
  if (
    requestedEmpresaId !== undefined &&
    requestedEmpresaId !== null &&
    requestedEmpresaId !== callerEmpresaId
  ) {
    throw new Error("Sem permissão para gerenciar usuários de outra empresa");
  }

  return callerEmpresaId;
}

export function assertCompanyAdminEndpointAccess(roles: readonly unknown[]): void {
  if (roles.includes("master_admin")) {
    throw new Error("Master admin deve usar o fluxo administrativo de empresa");
  }
  if (!roles.includes("admin_empresa")) {
    throw new Error("Acesso negado");
  }
}

export function assertCompanyManagedTargetIsNotMaster(
  roles: readonly unknown[],
): void {
  if (roles.includes("master_admin")) {
    throw new Error("Contas master_admin não podem ser alteradas por este fluxo");
  }
}

export function normalizeCompanyRole(role: unknown): CompanyRole {
  if (role === "admin" || role === "admin_empresa") {
    return "admin_empresa";
  }

  return "usuario";
}

export function resolveRequestedCompany({
  requestedEmpresaId,
  callerEmpresaId,
  isMaster,
  isAdmin,
}: ResolveRequestedCompanyInput): string {
  if (!requestedEmpresaId) {
    throw new Error("Empresa é obrigatória");
  }

  if (isMaster) {
    return requestedEmpresaId;
  }

  if (!isAdmin || !callerEmpresaId || callerEmpresaId !== requestedEmpresaId) {
    throw new Error("Sem permissão para gerenciar usuários de outra empresa");
  }

  return callerEmpresaId;
}

export function assertCanonicalCompanyAssignment(
  currentEmpresaId: string | null | undefined,
  targetEmpresaId: string,
): void {
  if (currentEmpresaId && currentEmpresaId !== targetEmpresaId) {
    throw new Error(
      "Este usuário já pertence a outra empresa e não pode ser vinculado automaticamente",
    );
  }
}
