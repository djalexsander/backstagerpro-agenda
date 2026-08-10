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

// Supabase Auth's AMR (Authentication Method Reference) claim records HOW the
// session was established (e.g. "otp", "password", "oauth") - it is not the
// EmailOtpType ("invite" | "recovery" | "magiclink" | ...) used to request the
// link. Invite and recovery links are both verified through the same OTP
// mechanism, so a session created from either link always carries the amr
// value "otp", never the literal strings "invite"/"recovery". Comparing amr
// against the flow name here always evaluated to false and made every
// activation attempt fail with "Convite ou recuperação inválidos" - the flow
// itself (invite vs recovery) is already verified via account_activation_flow
// in user_metadata; this check only needs to confirm the session came from an
// OTP email link rather than some other (weaker) authentication method.
export function accessTokenHasOtpAuthenticationMethod(accessToken: string): boolean {
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
        const method = typeof reference === "string" ? reference : reference?.method;
        return method === "otp";
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
