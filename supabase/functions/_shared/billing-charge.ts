export type BillingChargeRequest =
  | { kind: "base_plan"; resourceId: string }
  | { kind: "modules"; resourceId: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertBillingAdmin(roles: readonly unknown[]): void {
  if (roles.includes("master_admin")) {
    throw new Error("Master admin deve usar o fluxo financeiro administrativo");
  }
  if (!roles.includes("admin_empresa")) {
    throw new Error("Apenas o administrador da empresa pode criar cobranças");
  }
}

export function validateBillingChargeRequest(
  body: Record<string, unknown>,
): BillingChargeRequest {
  const allowedKeys = new Set(["plano_id", "modulo_id"]);
  const keys = Object.keys(body);
  if (
    keys.length > 1 ||
    keys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error(
      "A cobrança aceita somente plano_id ou modulo_id; valor e descrição são calculados no servidor",
    );
  }

  const planId = body.plano_id;
  const moduleId = body.modulo_id;
  const hasPlan = typeof planId === "string" && uuidPattern.test(planId);
  const hasModule = typeof moduleId === "string" && uuidPattern.test(moduleId);

  if (hasPlan === hasModule) {
    throw new Error("Informe exatamente um plano_id ou modulo_id válido");
  }

  return hasPlan
    ? { kind: "base_plan", resourceId: planId }
    : { kind: "modules", resourceId: moduleId as string };
}

export function toTrustedCurrencyAmount(value: unknown): number {
  const numericValue =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  const cents = Math.round(numericValue * 100);

  if (!Number.isFinite(numericValue) || cents <= 0) {
    throw new Error("Preço inválido no catálogo");
  }

  return cents / 100;
}
