import { describe, expect, it } from "vitest";
import {
  assertCanonicalCompanyAssignment,
  assertCompanyAdminEndpointAccess,
  assertCompanyManagedTargetIsNotMaster,
  deriveCompanyForCompanyAdmin,
  normalizeCompanyRole,
  resolveRequestedCompany,
  validateCompanyManagedRole,
} from "../../supabase/functions/_shared/company-tenancy";

describe("company tenancy rules", () => {
  it("keeps profiles.empresa_id as a single canonical assignment", () => {
    expect(() =>
      assertCanonicalCompanyAssignment("empresa-a", "empresa-b"),
    ).toThrow(/já pertence a outra empresa/i);

    expect(() =>
      assertCanonicalCompanyAssignment("empresa-a", "empresa-a"),
    ).not.toThrow();
    expect(() =>
      assertCanonicalCompanyAssignment(null, "empresa-a"),
    ).not.toThrow();
  });

  it("limits an admin to the company from their own profile", () => {
    expect(
      resolveRequestedCompany({
        requestedEmpresaId: "empresa-a",
        callerEmpresaId: "empresa-a",
        isMaster: false,
        isAdmin: true,
      }),
    ).toBe("empresa-a");

    expect(() =>
      resolveRequestedCompany({
        requestedEmpresaId: "empresa-b",
        callerEmpresaId: "empresa-a",
        isMaster: false,
        isAdmin: true,
      }),
    ).toThrow(/outra empresa/i);
  });

  it("derives create-user tenancy only from the authenticated admin profile", () => {
    expect(
      deriveCompanyForCompanyAdmin({
        callerEmpresaId: "empresa-a",
      }),
    ).toBe("empresa-a");

    expect(
      deriveCompanyForCompanyAdmin({
        callerEmpresaId: "empresa-a",
        requestedEmpresaId: "empresa-a",
      }),
    ).toBe("empresa-a");

    expect(() =>
      deriveCompanyForCompanyAdmin({
        callerEmpresaId: "empresa-a",
        requestedEmpresaId: "empresa-b",
      }),
    ).toThrow(/outra empresa/i);

    expect(() =>
      deriveCompanyForCompanyAdmin({
        callerEmpresaId: null,
        requestedEmpresaId: "empresa-atacante",
      }),
    ).toThrow(/sem empresa vinculada/i);
  });

  it("accepts only company-scoped roles and rejects privilege escalation", () => {
    expect(validateCompanyManagedRole("admin_empresa")).toBe("admin_empresa");
    expect(validateCompanyManagedRole("usuario")).toBe("usuario");
    expect(() => validateCompanyManagedRole("master_admin")).toThrow(
      /papel inválido/i,
    );
    expect(() => validateCompanyManagedRole("admin")).toThrow(/papel inválido/i);
    expect(() => validateCompanyManagedRole(undefined)).toThrow(
      /papel inválido/i,
    );
  });

  it("keeps master accounts outside the company-admin endpoint", () => {
    expect(() =>
      assertCompanyAdminEndpointAccess(["master_admin", "admin_empresa"]),
    ).toThrow(/fluxo administrativo/i);
    expect(() => assertCompanyAdminEndpointAccess(["usuario"])).toThrow(
      /acesso negado/i,
    );
    expect(() =>
      assertCompanyAdminEndpointAccess(["admin_empresa"]),
    ).not.toThrow();

    expect(() =>
      assertCompanyManagedTargetIsNotMaster([
        "master_admin",
        "admin_empresa",
      ]),
    ).toThrow(/master_admin/i);
    expect(() =>
      assertCompanyManagedTargetIsNotMaster(["admin_empresa", "usuario"]),
    ).not.toThrow();
  });

  it("allows a master admin to select a company explicitly", () => {
    expect(
      resolveRequestedCompany({
        requestedEmpresaId: "empresa-b",
        callerEmpresaId: null,
        isMaster: true,
        isAdmin: false,
      }),
    ).toBe("empresa-b");
  });

  it("normalizes legacy company roles without granting master access", () => {
    expect(normalizeCompanyRole("admin")).toBe("admin_empresa");
    expect(normalizeCompanyRole("admin_empresa")).toBe("admin_empresa");
    expect(normalizeCompanyRole("usuario")).toBe("usuario");
    expect(normalizeCompanyRole("master_admin")).toBe("usuario");
    expect(normalizeCompanyRole(undefined)).toBe("usuario");
  });
});
