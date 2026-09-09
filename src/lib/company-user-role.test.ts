import { describe, expect, it } from "vitest";
import {
  describeCompanyRoleRpcError,
  reconcileCanonicalRole,
} from "../../supabase/functions/_shared/company-user-role";

describe("reconcileCanonicalRole (P0-7: one canonical role, old role removed)", () => {
  it("new user with no roles: only the target role is added", () => {
    expect(reconcileCanonicalRole([], "usuario")).toEqual({
      finalRoles: ["usuario"],
      removed: [],
      added: ["usuario"],
    });
  });

  it("new invite seeded with 'usuario' promoted to admin_empresa: drops the seeded role", () => {
    expect(reconcileCanonicalRole(["usuario"], "admin_empresa")).toEqual({
      finalRoles: ["admin_empresa"],
      removed: ["usuario"],
      added: ["admin_empresa"],
    });
  });

  it("existing user re-added with the same role: nothing changes", () => {
    expect(reconcileCanonicalRole(["usuario"], "usuario")).toEqual({
      finalRoles: ["usuario"],
      removed: [],
      added: [],
    });
  });

  it("existing admin demoted to usuario: the previous admin_empresa row is removed", () => {
    expect(reconcileCanonicalRole(["admin_empresa"], "usuario")).toEqual({
      finalRoles: ["usuario"],
      removed: ["admin_empresa"],
      added: ["usuario"],
    });
  });

  it("collapses a user who already holds several roles down to one", () => {
    expect(
      reconcileCanonicalRole(["admin_empresa", "usuario"], "usuario"),
    ).toEqual({
      finalRoles: ["usuario"],
      removed: ["admin_empresa"],
      added: [],
    });
  });

  it("de-duplicates repeated current roles", () => {
    expect(reconcileCanonicalRole(["usuario", "usuario"], "admin_empresa")).toEqual(
      {
        finalRoles: ["admin_empresa"],
        removed: ["usuario"],
        added: ["admin_empresa"],
      },
    );
  });

  it("never reports master_admin as a role to keep", () => {
    const plan = reconcileCanonicalRole(["admin_empresa"], "usuario");
    expect(plan.finalRoles).toEqual(["usuario"]);
    expect(plan.removed).toContain("admin_empresa");
  });
});

describe("describeCompanyRoleRpcError", () => {
  it("maps 42501 to 403 and keeps the RPC message", () => {
    expect(
      describeCompanyRoleRpcError("42501", "Contas master_admin não podem ser alteradas por este fluxo."),
    ).toEqual({
      status: 403,
      message: "Contas master_admin não podem ser alteradas por este fluxo.",
    });
  });

  it("falls back to a safe message when 42501 has no text", () => {
    expect(describeCompanyRoleRpcError("42501", "  ")).toEqual({
      status: 403,
      message: "Sem permissão para definir o papel deste usuário",
    });
  });

  it("maps malformed-input codes to 400", () => {
    expect(describeCompanyRoleRpcError("22023", "").status).toBe(400);
    expect(describeCompanyRoleRpcError("23514", null).status).toBe(400);
    expect(describeCompanyRoleRpcError("22P02", "invalid input syntax for type uuid").status).toBe(400);
  });

  it("hides unexpected errors behind a generic 500", () => {
    expect(describeCompanyRoleRpcError("XX000", "internal detail")).toEqual({
      status: 500,
      message: "Não foi possível definir o papel do usuário",
    });
    expect(describeCompanyRoleRpcError(undefined, undefined).status).toBe(500);
  });
});
