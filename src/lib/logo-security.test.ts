import { describe, expect, it } from "vitest";
import {
  LOGO_MAX_BYTES,
  assertCanManageCompanyLogo,
  buildCompanyLogoPath,
  buildPlatformLogoPath,
  canManageCompanyLogo,
  validateLogoFile,
} from "./logo-security";

const companyA = "123e4567-e89b-42d3-a456-426614174000";
const companyB = "223e4567-e89b-42d3-a456-426614174000";

describe("company logo security", () => {
  it("allows a company admin only in the active company", () => {
    expect(
      canManageCompanyLogo({
        role: "admin_empresa",
        actorCompanyId: companyA,
        targetCompanyId: companyA,
      }),
    ).toBe(true);
    expect(
      canManageCompanyLogo({
        role: "admin_empresa",
        actorCompanyId: companyA,
        targetCompanyId: companyB,
      }),
    ).toBe(false);
    expect(() =>
      assertCanManageCompanyLogo({
        role: "usuario",
        actorCompanyId: companyA,
        targetCompanyId: companyA,
      }),
    ).toThrow(/sem permissão/i);
  });

  it("allows a master to manage a valid company path", () => {
    expect(
      canManageCompanyLogo({
        role: "master_admin",
        actorCompanyId: null,
        targetCompanyId: companyB,
      }),
    ).toBe(true);
    expect(
      canManageCompanyLogo({
        role: "master_admin",
        actorCompanyId: null,
        targetCompanyId: "../company",
      }),
    ).toBe(false);
  });

  it("validates raster image type, extension and size", () => {
    expect(
      validateLogoFile({
        name: "logo.jpeg",
        type: "image/jpeg",
        size: 1024,
      }),
    ).toBe("image/jpeg");
    expect(() =>
      validateLogoFile({
        name: "logo.svg",
        type: "image/svg+xml",
        size: 1024,
      }),
    ).toThrow(/PNG, JPEG ou WebP/i);
    expect(() =>
      validateLogoFile({
        name: "logo.png",
        type: "image/png",
        size: LOGO_MAX_BYTES + 1,
      }),
    ).toThrow(/2 MB/i);
  });

  it("builds fixed company and isolated platform paths", () => {
    expect(buildCompanyLogoPath(companyA, "image/png")).toBe(
      `${companyA}/logo.png`,
    );
    expect(buildPlatformLogoPath("image/webp", 123)).toBe(
      "platform-logo-123.webp",
    );
  });
});
