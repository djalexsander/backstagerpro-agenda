export interface CreateCompanyWithAdminParams {
  empresaPayload: Record<string, unknown>;
  isVitalicio: boolean;
  adminEmail: string | null;
  adminFullName: string;
  adminRole: string;
  logoFile: File | null;
}

export interface CreateCompanyWithAdminClient {
  insertEmpresa(payload: Record<string, unknown>): Promise<string>;
  setLifetimeSubscription(empresaId: string): Promise<void>;
  provisionModuleEntitlements(empresaId: string): Promise<void>;
  uploadLogo(empresaId: string, file: File): Promise<string | null>;
  updateEmpresaLogo(empresaId: string, logoUrl: string): Promise<void>;
  createAdminUser(
    empresaId: string,
    email: string,
    fullName: string,
    role: string,
  ): Promise<void>;
  deleteEmpresa(empresaId: string): Promise<void>;
}

export interface CreateCompanyWithAdminResult {
  empresaId: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a company and, if requested, its first admin user as a single
 * logical operation. The empresa row must exist before the lifetime/module
 * RPCs and the admin invite can reference it, so it cannot be created inside
 * a client-side transaction - instead, any failure in the steps that follow
 * the insert triggers a compensating delete of that empresa row, so a failed
 * create-empresa-user call (e.g. reusing an email already tied to another
 * company) never leaves an orphaned, admin-less company in the listing.
 */
export async function createCompanyWithAdmin(
  params: CreateCompanyWithAdminParams,
  client: CreateCompanyWithAdminClient,
): Promise<CreateCompanyWithAdminResult> {
  const empresaId = await client.insertEmpresa(params.empresaPayload);

  try {
    if (params.isVitalicio) {
      await client.setLifetimeSubscription(empresaId);
    }

    await client.provisionModuleEntitlements(empresaId);

    if (params.logoFile) {
      const logoUrl = await client.uploadLogo(empresaId, params.logoFile);
      if (logoUrl) {
        await client.updateEmpresaLogo(empresaId, logoUrl);
      }
    }

    if (params.adminEmail) {
      await client.createAdminUser(
        empresaId,
        params.adminEmail,
        params.adminFullName,
        params.adminRole,
      );
    }
  } catch (error) {
    try {
      await client.deleteEmpresa(empresaId);
    } catch (cleanupError) {
      throw new Error(
        `Falha ao concluir a criação da empresa e a limpeza automática também falhou. ` +
          `A empresa (id ${empresaId}) pode ter ficado incompleta e precisa de remoção manual. ` +
          `Erro original: ${toErrorMessage(error)}. Erro na limpeza: ${toErrorMessage(cleanupError)}`,
      );
    }
    throw error instanceof Error ? error : new Error(toErrorMessage(error));
  }

  return { empresaId };
}
