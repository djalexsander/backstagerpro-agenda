import { describe, expect, it, vi } from "vitest";
import { createCompanyWithAdmin, type CreateCompanyWithAdminClient } from "./company-creation";

function buildClient(overrides: Partial<CreateCompanyWithAdminClient> = {}): CreateCompanyWithAdminClient {
  return {
    insertEmpresa: vi.fn().mockResolvedValue("empresa-1"),
    applyPlan: vi.fn().mockResolvedValue(undefined),
    provisionModuleEntitlements: vi.fn().mockResolvedValue(undefined),
    uploadLogo: vi.fn().mockResolvedValue(null),
    updateEmpresaLogo: vi.fn().mockResolvedValue(undefined),
    createAdminUser: vi.fn().mockResolvedValue(undefined),
    deleteEmpresa: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const baseParams = {
  empresaPayload: { nome_empresa: "Backstage pro" },
  adminEmail: "admin@example.com",
  adminFullName: "Backstage pro",
  adminRole: "admin_empresa",
  logoFile: null,
};

describe("createCompanyWithAdmin", () => {
  it("creates the company and admin successfully without touching rollback", async () => {
    const client = buildClient();

    const result = await createCompanyWithAdmin(baseParams, client);

    expect(result).toEqual({ empresaId: "empresa-1" });
    expect(client.createAdminUser).toHaveBeenCalledWith(
      "empresa-1",
      "admin@example.com",
      "Backstage pro",
      "admin_empresa",
    );
    expect(client.deleteEmpresa).not.toHaveBeenCalled();
  });

  it("applies the plan for every company, regardless of plan shape", async () => {
    const client = buildClient();

    await createCompanyWithAdmin(baseParams, client);

    expect(client.applyPlan).toHaveBeenCalledWith("empresa-1");
  });

  it("applies the plan before provisioning module entitlements", async () => {
    const callOrder: string[] = [];
    const client = buildClient({
      applyPlan: vi.fn().mockImplementation(async () => {
        callOrder.push("applyPlan");
      }),
      provisionModuleEntitlements: vi.fn().mockImplementation(async () => {
        callOrder.push("provisionModuleEntitlements");
      }),
    });

    await createCompanyWithAdmin(baseParams, client);

    expect(callOrder).toEqual(["applyPlan", "provisionModuleEntitlements"]);
  });

  it("skips admin creation entirely when no admin email is provided", async () => {
    const client = buildClient();

    await createCompanyWithAdmin({ ...baseParams, adminEmail: null }, client);

    expect(client.createAdminUser).not.toHaveBeenCalled();
    expect(client.deleteEmpresa).not.toHaveBeenCalled();
  });

  it("rolls back (deletes) the empresa when create-empresa-user fails - no orphaned company", async () => {
    const client = buildClient({
      createAdminUser: vi
        .fn()
        .mockRejectedValue(new Error("Este usuário já pertence a outra empresa e não pode ser vinculado automaticamente")),
    });

    await expect(createCompanyWithAdmin(baseParams, client)).rejects.toThrow(
      "Este usuário já pertence a outra empresa",
    );
    expect(client.deleteEmpresa).toHaveBeenCalledWith("empresa-1");
  });

  it("rolls back the empresa when module provisioning fails, before the admin step ever runs", async () => {
    const client = buildClient({
      provisionModuleEntitlements: vi.fn().mockRejectedValue(new Error("provisioning failed")),
    });

    await expect(createCompanyWithAdmin(baseParams, client)).rejects.toThrow("provisioning failed");
    expect(client.createAdminUser).not.toHaveBeenCalled();
    expect(client.deleteEmpresa).toHaveBeenCalledWith("empresa-1");
  });

  it("rolls back the empresa when applying the plan fails", async () => {
    const client = buildClient({
      applyPlan: vi.fn().mockRejectedValue(new Error("plan rpc failed")),
    });

    await expect(
      createCompanyWithAdmin(baseParams, client),
    ).rejects.toThrow("plan rpc failed");
    expect(client.provisionModuleEntitlements).not.toHaveBeenCalled();
    expect(client.deleteEmpresa).toHaveBeenCalledWith("empresa-1");
  });

  it("surfaces a clear, actionable error when both the original failure and the rollback fail", async () => {
    const client = buildClient({
      createAdminUser: vi.fn().mockRejectedValue(new Error("create-empresa-user failed")),
      deleteEmpresa: vi.fn().mockRejectedValue(new Error("network error during cleanup")),
    });

    await expect(createCompanyWithAdmin(baseParams, client)).rejects.toThrow(
      /empresa \(id empresa-1\) pode ter ficado incompleta.*create-empresa-user failed.*network error during cleanup/s,
    );
  });

  it("uploads and persists the logo before creating the admin user", async () => {
    const callOrder: string[] = [];
    const client = buildClient({
      uploadLogo: vi.fn().mockImplementation(async () => {
        callOrder.push("uploadLogo");
        return "https://cdn.example.com/logo.png";
      }),
      updateEmpresaLogo: vi.fn().mockImplementation(async () => {
        callOrder.push("updateEmpresaLogo");
      }),
      createAdminUser: vi.fn().mockImplementation(async () => {
        callOrder.push("createAdminUser");
      }),
    });
    const logoFile = new File(["logo"], "logo.png", { type: "image/png" });

    await createCompanyWithAdmin({ ...baseParams, logoFile }, client);

    expect(callOrder).toEqual(["uploadLogo", "updateEmpresaLogo", "createAdminUser"]);
  });

  it("does not update the empresa logo when the upload returns no URL", async () => {
    const client = buildClient({ uploadLogo: vi.fn().mockResolvedValue(null) });
    const logoFile = new File(["logo"], "logo.png", { type: "image/png" });

    await createCompanyWithAdmin({ ...baseParams, logoFile }, client);

    expect(client.updateEmpresaLogo).not.toHaveBeenCalled();
  });
});
