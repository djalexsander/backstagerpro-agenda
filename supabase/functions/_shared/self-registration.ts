export const selfRegistrationGenericMessage =
  "Se o cadastro puder ser iniciado, enviaremos um link de confirmação para o email informado.";

export type SelfRegistrationInput = {
  companyName: string;
  responsibleName: string;
  email: string;
  phone: string | null;
  password: string;
  honeypotFilled: boolean;
};

function requiredText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} é obrigatório`);
  }

  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(
      `${label} deve ter entre ${minimum} e ${maximum} caracteres`,
    );
  }
  return normalized;
}

export function validateSelfRegistrationInput(
  body: Record<string, unknown>,
): SelfRegistrationInput {
  const companyName = requiredText(body.nome_empresa, "Nome da empresa", 2, 120);
  const responsibleName = requiredText(
    body.nome_responsavel,
    "Nome do responsável",
    2,
    120,
  );
  const email = requiredText(body.email, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email inválido");
  }

  if (
    typeof body.password !== "string" ||
    body.password.length < 8 ||
    body.password.length > 128
  ) {
    throw new Error("A senha deve ter entre 8 e 128 caracteres");
  }

  const phone =
    typeof body.telefone === "string" && body.telefone.trim()
      ? body.telefone.trim()
      : null;
  if (phone && phone.length > 30) {
    throw new Error("Telefone deve ter no máximo 30 caracteres");
  }

  return {
    companyName,
    responsibleName,
    email,
    phone,
    password: body.password,
    honeypotFilled:
      typeof body.website === "string" && body.website.trim().length > 0,
  };
}

export function getSelfRegistrationRedirectUrl(
  appUrl: string | undefined,
): string {
  if (!appUrl) {
    throw new Error("APP_URL não configurada para confirmação de cadastro");
  }

  const parsed = new URL(appUrl);
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.protocol !== "https:" &&
    !(isLocalhost && parsed.protocol === "http:")
  ) {
    throw new Error("APP_URL deve usar HTTPS, exceto em localhost");
  }

  parsed.pathname = "/escolher-plano";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function getRegistrationClientIdentifier(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp =
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwardedFor;

  if (clientIp) return clientIp;
  return `unknown:${req.headers.get("user-agent")?.slice(0, 200) ?? "client"}`;
}

export async function hashRegistrationIdentifier(
  identifier: string,
  secret: string | undefined,
): Promise<string> {
  if (!secret || secret.length < 32) {
    throw new Error(
      "REGISTRATION_RATE_LIMIT_SECRET deve ter pelo menos 32 caracteres",
    );
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(identifier),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isPendingSelfRegistration(user: {
  email_confirmed_at?: string | null;
  registration_source?: string | null;
}): boolean {
  return (
    !user.email_confirmed_at &&
    user.registration_source === "self_register"
  );
}
