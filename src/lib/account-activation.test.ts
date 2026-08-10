import { describe, expect, it } from "vitest";
import {
  accessTokenHasOtpAuthenticationMethod,
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

  it("accepts sessions established via Supabase's OTP email link, regardless of invite vs recovery", () => {
    // GoTrue's amr claim records the authentication METHOD ("otp", "password",
    // "oauth", ...), not the EmailOtpType used to request the link ("invite",
    // "recovery", ...). Invite and recovery links are both verified through
    // the same OTP mechanism, so both produce amr method "otp" - never the
    // literal strings "invite"/"recovery". Distinguishing invite from
    // recovery is the job of account_activation_flow in user_metadata,
    // checked separately in activate-account; this helper only confirms the
    // session came from an OTP link at all.
    const otpObjectFormat = createUnsignedToken({
      amr: [{ method: "otp", timestamp: 1 }],
    });
    const otpStringFormat = createUnsignedToken({ amr: ["otp"] });

    expect(accessTokenHasOtpAuthenticationMethod(otpObjectFormat)).toBe(true);
    expect(accessTokenHasOtpAuthenticationMethod(otpStringFormat)).toBe(true);
  });

  it("rejects sessions established via a non-OTP authentication method", () => {
    expect(
      accessTokenHasOtpAuthenticationMethod(
        createUnsignedToken({ amr: [{ method: "password", timestamp: 1 }] }),
      ),
    ).toBe(false);
    expect(
      accessTokenHasOtpAuthenticationMethod(
        createUnsignedToken({ amr: [{ method: "oauth", timestamp: 1 }] }),
      ),
    ).toBe(false);
    expect(accessTokenHasOtpAuthenticationMethod(createUnsignedToken({}))).toBe(
      false,
    );
    expect(accessTokenHasOtpAuthenticationMethod("invalid")).toBe(false);
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

  it("always targets /primeiro-acesso on the configured APP_URL host, even if it is a supabase.co domain", () => {
    // APP_URL must be the frontend's own domain. If it is ever misconfigured
    // to the Supabase project URL, this must still resolve to /primeiro-acesso
    // on that host rather than silently rerouting to a different endpoint -
    // rerouting previously masked the misconfiguration instead of surfacing it.
    expect(
      getActivationRedirectUrl("https://zupcxxtnaglcappazciu.supabase.co"),
    ).toBe("https://zupcxxtnaglcappazciu.supabase.co/primeiro-acesso");
  });

  it("strips any existing path, query string and hash from APP_URL", () => {
    expect(
      getActivationRedirectUrl(
        "https://agenda.example.com/some/path?x=1#frag",
      ),
    ).toBe("https://agenda.example.com/primeiro-acesso");
  });

  it("preserves metadata while recording the server-issued flow", () => {
    const metadata = mergeActivationMetadata({ full_name: "Ana" }, "invite");
    expect(metadata.full_name).toBe("Ana");
    expect(metadata.account_activation_flow).toBe("invite");
    expect(metadata.account_activation_requested_at).toEqual(expect.any(String));
  });
});
