export type ActivationFlow = "invite" | "recovery";

export interface RunAccountActivationInput {
  password: string;
  confirmPassword: string;
  flow: ActivationFlow | null;
}

export interface RunAccountActivationDeps {
  getAccessToken: () => Promise<string | null>;
  invokeActivateAccount: (params: {
    accessToken: string;
    password: string;
    flow: ActivationFlow;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export type RunAccountActivationResult =
  | { success: true }
  | { success: false; message: string };

const INVALID_LINK_MESSAGE =
  "Link inválido ou expirado. Solicite um novo link de ativação.";

export async function runAccountActivation(
  deps: RunAccountActivationDeps,
  input: RunAccountActivationInput,
): Promise<RunAccountActivationResult> {
  if (!input.flow) {
    return { success: false, message: INVALID_LINK_MESSAGE };
  }
  if (input.password !== input.confirmPassword) {
    return { success: false, message: "As senhas não coincidem." };
  }
  if (input.password.length < 8) {
    return {
      success: false,
      message: "A senha deve ter pelo menos 8 caracteres.",
    };
  }

  const accessToken = await deps.getAccessToken();
  if (!accessToken) {
    return { success: false, message: INVALID_LINK_MESSAGE };
  }

  // The password is set exclusively by activate-account (service role), and
  // only after it validates the token, matches the invite/recovery flow,
  // confirms the OTP authentication method and atomically consumes the
  // single-use activation claim. The client must never mutate the password
  // before that validation passes: doing so let a rejected or invalid
  // activation attempt silently change the account's password while the
  // account stayed flagged as not activated.
  const { error } = await deps.invokeActivateAccount({
    accessToken,
    password: input.password,
    flow: input.flow,
  });
  if (error) {
    return { success: false, message: error };
  }

  await deps.signOut();
  return { success: true };
}
