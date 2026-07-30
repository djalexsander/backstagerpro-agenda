import { describe, expect, it } from "vitest";
import {
  isMissingAuthUserError,
  validateUserRemovalRequest,
} from "../../supabase/functions/_shared/user-removal";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const empresaId = "223e4567-e89b-42d3-a456-426614174000";

describe("safe company user removal", () => {
  it("requires valid user and company identifiers", () => {
    expect(
      validateUserRemovalRequest({
        user_id: userId,
        empresa_id: empresaId,
      }),
    ).toEqual({ userId, empresaId });

    expect(() =>
      validateUserRemovalRequest({
        user_id: "other-tenant",
        empresa_id: empresaId,
      }),
    ).toThrow(/user_id inválido/i);
    expect(() =>
      validateUserRemovalRequest({
        user_id: userId,
        empresa_id: "../other-company",
      }),
    ).toThrow(/empresa_id inválido/i);
  });

  it("allows a master flow to clean up an already orphaned identity", () => {
    expect(validateUserRemovalRequest({ user_id: userId })).toEqual({
      userId,
      empresaId: null,
    });
    expect(
      validateUserRemovalRequest({ user_id: userId, empresa_id: null }),
    ).toEqual({ userId, empresaId: null });
  });

  it("rejects browser attempts to influence the deletion decision", () => {
    for (const field of [
      "delete_auth",
      "remaining_links",
      "is_master",
      "force",
    ]) {
      expect(() =>
        validateUserRemovalRequest({
          user_id: userId,
          empresa_id: empresaId,
          [field]: true,
        }),
      ).toThrow(/somente user_id e empresa_id/i);
    }
  });

  it("treats an already missing Auth identity as an idempotent success", () => {
    expect(isMissingAuthUserError("User not found")).toBe(true);
    expect(isMissingAuthUserError("Usuário não encontrado")).toBe(true);
    expect(isMissingAuthUserError("Database timeout")).toBe(false);
  });
});
