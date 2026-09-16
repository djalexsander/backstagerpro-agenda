export type BillingChargeRequest =
  | { kind: "base_plan"; resourceId: string }
  | { kind: "modules"; resourceIds: string[] }
  | { kind: "renewal" };

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
  const allowedKeys = new Set([
    "plano_id",
    "modulo_id",
    "modulo_ids",
    "tipo_cobranca",
  ]);
  const keys = Object.keys(body);

  if (
    keys.length === 1 &&
    body.tipo_cobranca === "renewal"
  ) {
    return { kind: "renewal" };
  }

  if (
    keys.length > 1 ||
    keys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error(
      "A cobrança aceita somente plano_id ou modulo_id nos fluxos unitários, modulo_ids no lote, ou tipo_cobranca='renewal'; valor e descrição são calculados no servidor",
    );
  }

  if (body.tipo_cobranca !== undefined) {
    throw new Error("tipo_cobranca deve ser exatamente 'renewal'");
  }

  if (body.modulo_ids !== undefined) {
    if (!Array.isArray(body.modulo_ids) || body.modulo_ids.length === 0) {
      throw new Error("modulo_ids deve conter ao menos um UUID válido");
    }
    if (body.modulo_ids.length > 50) {
      throw new Error("modulo_ids excede o limite de 50 módulos por cobrança");
    }

    const moduleIds = body.modulo_ids;
    if (
      moduleIds.some((moduleId) =>
        typeof moduleId !== "string" || !uuidPattern.test(moduleId)
      )
    ) {
      throw new Error("modulo_ids deve conter somente UUIDs válidos");
    }

    const normalizedIds = moduleIds.map((moduleId) =>
      (moduleId as string).toLowerCase()
    );
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      throw new Error("modulo_ids não pode conter IDs duplicados");
    }

    return { kind: "modules", resourceIds: moduleIds as string[] };
  }

  const planId = body.plano_id;
  const moduleId = body.modulo_id;
  const hasPlan = typeof planId === "string" && uuidPattern.test(planId);
  const hasModule = typeof moduleId === "string" && uuidPattern.test(moduleId);

  if (hasPlan === hasModule) {
    throw new Error(
      "Informe exatamente um plano_id ou modulo_id válido, ou tipo_cobranca='renewal'",
    );
  }

  return hasPlan
    ? { kind: "base_plan", resourceId: planId }
    : { kind: "modules", resourceIds: [moduleId as string] };
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

// The Asaas customer/charge is billed to the subscribing company itself
// (prepare_asaas_charge resolves it from the caller's own profile - see
// 20260818160000_empresa_billing_document.sql), never to a `clientes` row.
// A CHECK constraint on empresas.cpf_cnpj already guarantees a stored value
// is digits-only and exactly 11 or 14 characters, but this function treats
// whatever `prepare_asaas_charge` returned as untrusted input anyway rather
// than assuming that invariant holds forever - same defense-in-depth
// posture as toTrustedCurrencyAmount above for price. Only shape (length) is
// validated, matching the DB constraint and clientes.cpf_cnpj's own
// precedent (20260802200000_material_rentals_stage_four.sql) - neither
// checks a CPF/CNPJ verification digit.
const CPF_DIGIT_COUNT = 11;
const CNPJ_DIGIT_COUNT = 14;
// Defensive cap before the regex strip - a legitimate document string is a
// handful of characters (formatted or not); anything wildly longer is
// already not a document and doesn't need to be scanned digit by digit.
const MAX_DOCUMENT_INPUT_LENGTH = 32;

export function assertValidBillingDocument(rawDocument: unknown): string {
  const digits =
    typeof rawDocument === "string"
      ? rawDocument.slice(0, MAX_DOCUMENT_INPUT_LENGTH).replace(/[^0-9]/g, "")
      : "";

  if (digits.length !== CPF_DIGIT_COUNT && digits.length !== CNPJ_DIGIT_COUNT) {
    throw new Error(
      "A empresa não possui CPF/CNPJ válido cadastrado para cobrança. Cadastre o documento antes de gerar uma cobrança no Asaas.",
    );
  }

  return digits;
}
