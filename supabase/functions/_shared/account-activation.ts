export type AccountActivationFlow = "invite" | "recovery";

type AuthenticationMethodReference =
  | string
  | {
      method?: unknown;
    };

type AccessTokenPayload = {
  amr?: AuthenticationMethodReference[];
};

export function normalizeActivationFlow(
  value: unknown,
): AccountActivationFlow | null {
  return value === "invite" || value === "recovery" ? value : null;
}

export function validateActivationPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("A senha deve ter pelo menos 8 caracteres");
  }

  if (password.length > 128) {
    throw new Error("A senha deve ter no máximo 128 caracteres");
  }

  return password;
}

export function getActivationRedirectUrl(appUrl: string | undefined): string {
  if (!appUrl) {
    throw new Error("APP_URL não configurada para o envio do convite");
  }

  const parsed = new URL(appUrl);
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
    throw new Error("APP_URL deve usar HTTPS, exceto em localhost");
  }

  parsed.pathname = "/primeiro-acesso";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function accessTokenHasActivationMethod(
  accessToken: string,
  expectedFlow: AccountActivationFlow,
): boolean {
  try {
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) return false;

    const normalized = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized)) as AccessTokenPayload;

    return (
      payload.amr?.some((reference) => {
        if (typeof reference === "string") return reference === expectedFlow;
        return reference?.method === expectedFlow;
      }) ?? false
    );
  } catch {
    return false;
  }
}

export function mergeActivationMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  flow: AccountActivationFlow,
): Record<string, unknown> {
  return {
    ...(currentMetadata ?? {}),
    account_activation_flow: flow,
    account_activation_requested_at: new Date().toISOString(),
  };
}
