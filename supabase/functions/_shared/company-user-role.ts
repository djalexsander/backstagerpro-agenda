import type { CompanyRole } from "./company-tenancy.ts";

/**
 * Pure reference model of the reconciliation that
 * `public.service_set_company_user_role` performs in a single transaction:
 *
 *   INSERT INTO user_roles (user_id, role) VALUES (target, _role)
 *     ON CONFLICT (user_id, role) DO NOTHING;
 *   DELETE FROM user_roles WHERE user_id = target AND role <> _role;
 *
 * The authoritative write stays in the RPC; this keeps the invite Edge
 * Functions, the migration and the pgTAP suite describing the exact same
 * invariant ("exactly one canonical role, old role removed") and lets it be
 * unit-tested without a database.
 */
export function reconcileCanonicalRole(
  currentRoles: readonly string[],
  targetRole: CompanyRole,
): { finalRoles: string[]; removed: string[]; added: string[] } {
  const unique = [...new Set(currentRoles)];
  return {
    finalRoles: [targetRole],
    removed: unique.filter((role) => role !== targetRole),
    added: unique.includes(targetRole) ? [] : [targetRole],
  };
}

export type CompanyRoleRpcError = { status: number; message: string };

/**
 * Maps a `service_set_company_user_role` RPC failure to an HTTP status and a
 * safe message, mirroring the delete-user -> detach_company_user convention
 * (42501 -> 403, malformed input -> 400, anything else -> 500 with a generic
 * message so internal details never leak).
 */
export function describeCompanyRoleRpcError(
  code: string | null | undefined,
  rawMessage: string | null | undefined,
): CompanyRoleRpcError {
  const trimmed = typeof rawMessage === "string" ? rawMessage.trim() : "";

  if (code === "42501") {
    return {
      status: 403,
      message: trimmed || "Sem permissão para definir o papel deste usuário",
    };
  }

  if (
    code === "22023" ||
    code === "22004" ||
    code === "22P02" ||
    code === "23514" ||
    code === "23503"
  ) {
    return {
      status: 400,
      message: trimmed || "Dados inválidos para definir o papel do usuário",
    };
  }

  return {
    status: 500,
    message: "Não foi possível definir o papel do usuário",
  };
}
