import { describe, expect, it, vi } from "vitest";
import { clearRecoveredAuthParams, getAuthParamsFromLocation } from "./PrimeiroAcesso";

describe("PrimeiroAcesso auth recovery helpers", () => {
  it("parses recovery parameters from the URL hash and search string", () => {
    const location = {
      href: "https://app.example.com/primeiro-acesso#type=recovery&access_token=abc&refresh_token=def",
      hash: "#type=recovery&access_token=abc&refresh_token=def",
      search: "",
    } as Location;

    expect(getAuthParamsFromLocation(location)).toMatchObject({
      hasRecoveryTokens: true,
      accessToken: "abc",
      refreshToken: "def",
      type: "recovery",
    });
  });

  it("removes recovery parameters from the URL after consuming them", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const location = {
      href: "https://app.example.com/primeiro-acesso?code=123&type=recovery#access_token=abc",
      hash: "#access_token=abc",
      search: "?code=123&type=recovery",
    } as Location;

    clearRecoveredAuthParams(location);

    expect(replaceStateSpy).toHaveBeenCalled();
    const [state, title, url] = replaceStateSpy.mock.calls[0];
    expect(state).toBe(window.history.state);
    expect(title).toBe("");
    expect(url).toBe("https://app.example.com/primeiro-acesso");
  });
});
