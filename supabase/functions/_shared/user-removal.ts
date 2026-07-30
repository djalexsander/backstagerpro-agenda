export type UserRemovalRequest = {
  userId: string;
  empresaId: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUserRemovalRequest(
  body: Record<string, unknown>,
): UserRemovalRequest {
  const allowedKeys = new Set(["user_id", "empresa_id"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new Error("A remoção aceita somente user_id e empresa_id");
  }

  const userId = body.user_id;
  const empresaId = body.empresa_id;
  if (typeof userId !== "string" || !uuidPattern.test(userId)) {
    throw new Error("user_id inválido");
  }
  if (
    empresaId !== null &&
    empresaId !== undefined &&
    (typeof empresaId !== "string" || !uuidPattern.test(empresaId))
  ) {
    throw new Error("empresa_id inválido");
  }

  return {
    userId,
    empresaId: typeof empresaId === "string" ? empresaId : null,
  };
}

export function isMissingAuthUserError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("user not found") ||
    normalized.includes("usuario não encontrado") ||
    normalized.includes("usuário não encontrado")
  );
}
