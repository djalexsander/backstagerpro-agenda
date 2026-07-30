import { describe, expect, it } from "vitest";
import {
  accessTokenHasActivationMethod,
  getActivationRedirectUrl,
  mergeActivationMetadata,
  normalizeActivationFlow,
  validateActivationPassword,
} from "../../supabase/functions/_shared/account-activation";

function createUnsignedToken(payload: object) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

describe("account activation security", () => {
  it("accepts only invite and recovery flows", () => {
    expect(normalizeActivationFlow("invite")).toBe("invite");
    expect(normalizeActivationFlow("recovery")).toBe("recovery");
    expect(normalizeActivationFlow("password")).toBeNull();
    expect(normalizeActivationFlow(undefined)).toBeNull();
  });

  it("requires the exact invite or recovery authentication method", () => {
    const inviteToken = createUnsignedToken({
      amr: [{ method: "invite", timestamp: 1 }],
    });
    const recoveryToken = createUnsignedToken({
      amr: [{ method: "recovery", timestamp: 1 }],
    });

    expect(accessTokenHasActivationMethod(inviteToken, "invite")).toBe(true);
    expect(accessTokenHasActivationMethod(inviteToken, "recovery")).toBe(false);
    expect(accessTokenHasActivationMethod(recoveryToken, "recovery")).toBe(true);
    expect(accessTokenHasActivationMethod(recoveryToken, "invite")).toBe(false);
    expect(
      accessTokenHasActivationMethod(
        createUnsignedToken({ amr: [{ method: "otp", timestamp: 1 }] }),
        "invite",
      ),
    ).toBe(false);
    expect(
      accessTokenHasActivationMethod(
        createUnsignedToken({ amr: [{ method: "password", timestamp: 1 }] }),
        "recovery",
      ),
    ).toBe(false);
    expect(accessTokenHasActivationMethod("invalid", "invite")).toBe(false);
  });

  it("enforces password length bounds", () => {
    expect(validateActivationPassword("12345678")).toBe("12345678");
    expect(() => validateActivationPassword("1234567")).toThrow(/8 caracteres/i);
    expect(() => validateActivationPassword("x".repeat(129))).toThrow(
      /128 caracteres/i,
    );
  });

  it("builds only trusted HTTPS or localhost redirect URLs", () => {
    expect(getActivationRedirectUrl("https://agenda.example.com/app")).toBe(
      "https://agenda.example.com/primeiro-acesso",
    );
    expect(getActivationRedirectUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/primeiro-acesso",
    );
    expect(() => getActivationRedirectUrl("http://agenda.example.com")).toThrow(
      /HTTPS/i,
    );
  });

  it("preserves metadata while recording the server-issued flow", () => {
    const metadata = mergeActivationMetadata({ full_name: "Ana" }, "invite");
    expect(metadata.full_name).toBe("Ana");
    expect(metadata.account_activation_flow).toBe("invite");
    expect(metadata.account_activation_requested_at).toEqual(expect.any(String));
  });
});
