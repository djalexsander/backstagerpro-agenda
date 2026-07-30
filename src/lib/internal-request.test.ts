import { describe, expect, it } from "vitest";
import { authorizeInternalRequest } from "../../supabase/functions/_shared/internal-request";

const internalSecret = "v".repeat(64);

describe("internal scheduled request security", () => {
  it("fails closed when the server secret is missing or weak", () => {
    expect(authorizeInternalRequest(undefined, internalSecret)).toBe(
      "misconfigured",
    );
    expect(authorizeInternalRequest("too-short", "too-short")).toBe(
      "misconfigured",
    );
  });

  it("rejects public calls without the internal header", () => {
    expect(authorizeInternalRequest(internalSecret, null)).toBe("unauthorized");
    expect(authorizeInternalRequest(internalSecret, "")).toBe("unauthorized");
  });

  it("rejects an incorrect secret and accepts only the exact value", () => {
    expect(
      authorizeInternalRequest(internalSecret, `${internalSecret}x`),
    ).toBe("unauthorized");
    expect(authorizeInternalRequest(internalSecret, "x".repeat(64))).toBe(
      "unauthorized",
    );
    expect(authorizeInternalRequest(internalSecret, internalSecret)).toBe(
      "authorized",
    );
  });
});
