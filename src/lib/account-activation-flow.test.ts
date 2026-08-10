import { describe, expect, it, vi } from "vitest";
import { runAccountActivation } from "./account-activation-flow";

function buildDeps(overrides: Partial<Parameters<typeof runAccountActivation>[0]> = {}) {
  return {
    getAccessToken: vi.fn().mockResolvedValue("token-abc"),
    invokeActivateAccount: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runAccountActivation", () => {
  it("rejects when there is no recognized flow, without calling the network", async () => {
    const deps = buildDeps();

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: null,
    });

    expect(result).toEqual({
      success: false,
      message: "Link inválido ou expirado. Solicite um novo link de ativação.",
    });
    expect(deps.getAccessToken).not.toHaveBeenCalled();
    expect(deps.invokeActivateAccount).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords before touching the network", async () => {
    const deps = buildDeps();

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "different",
      flow: "invite",
    });

    expect(result).toEqual({ success: false, message: "As senhas não coincidem." });
    expect(deps.invokeActivateAccount).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 8 characters before touching the network", async () => {
    const deps = buildDeps();

    const result = await runAccountActivation(deps, {
      password: "short",
      confirmPassword: "short",
      flow: "invite",
    });

    expect(result).toEqual({
      success: false,
      message: "A senha deve ter pelo menos 8 caracteres.",
    });
    expect(deps.invokeActivateAccount).not.toHaveBeenCalled();
  });

  it("rejects when the invite/recovery session is missing, without changing the password", async () => {
    const deps = buildDeps({ getAccessToken: vi.fn().mockResolvedValue(null) });

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: "invite",
    });

    expect(result).toEqual({
      success: false,
      message: "Link inválido ou expirado. Solicite um novo link de ativação.",
    });
    expect(deps.invokeActivateAccount).not.toHaveBeenCalled();
  });

  it("never calls a client-side password update - activate-account is the sole password writer", async () => {
    const deps = buildDeps();
    expect((deps as Record<string, unknown>).updateUser).toBeUndefined();

    await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: "invite",
    });

    expect(deps.invokeActivateAccount).toHaveBeenCalledWith({
      accessToken: "token-abc",
      password: "12345678",
      flow: "invite",
    });
  });

  it("signs out and reports success only after activate-account confirms 2xx", async () => {
    const deps = buildDeps();

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: "recovery",
    });

    expect(result).toEqual({ success: true });
    expect(deps.signOut).toHaveBeenCalledTimes(1);
  });

  it("propagates the server's exact single-use conflict message instead of a generic one", async () => {
    const deps = buildDeps({
      invokeActivateAccount: vi.fn().mockResolvedValue({
        error: "Este link já foi utilizado ou a conta já está ativada",
      }),
    });

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: "invite",
    });

    expect(result).toEqual({
      success: false,
      message: "Este link já foi utilizado ou a conta já está ativada",
    });
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it("propagates an invalid flow/OTP rejection from the server without hiding it", async () => {
    const deps = buildDeps({
      invokeActivateAccount: vi.fn().mockResolvedValue({
        error: "Convite ou recuperação inválidos",
      }),
    });

    const result = await runAccountActivation(deps, {
      password: "12345678",
      confirmPassword: "12345678",
      flow: "invite",
    });

    expect(result).toEqual({
      success: false,
      message: "Convite ou recuperação inválidos",
    });
  });
});
