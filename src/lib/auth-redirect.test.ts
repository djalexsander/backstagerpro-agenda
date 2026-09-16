import { describe, expect, it } from "vitest";
import { getAuthRedirectOrigin, getAuthRedirectUrl } from "./auth-redirect";

describe("auth redirect URLs", () => {
  it("keeps frontend auth redirects on localhost", () => {
    const location = { origin: "http://localhost:8080" } as Location;

    expect(getAuthRedirectOrigin(location)).toBe("http://localhost:8080");
    expect(getAuthRedirectUrl("/reset-password", location)).toBe(
      "http://localhost:8080/reset-password",
    );
  });

  it("keeps frontend auth redirects on the production origin", () => {
    const location = {
      origin: "https://backstagepro-agenda.alexproapps.com.br",
    } as Location;

    expect(getAuthRedirectOrigin(location)).toBe(
      "https://backstagepro-agenda.alexproapps.com.br",
    );
    expect(getAuthRedirectUrl("/primeiro-acesso", location)).toBe(
      "https://backstagepro-agenda.alexproapps.com.br/primeiro-acesso",
    );
  });
});
