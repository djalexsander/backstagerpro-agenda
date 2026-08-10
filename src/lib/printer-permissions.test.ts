import { describe, expect, it } from "vitest";
import { getPrinterPermissions } from "./printer-permissions";

describe("printer permissions", () => {
  it("lets a plain 'usuario' view (and therefore print with) the configured format, but not change it", () => {
    const permissions = getPrinterPermissions({ role: "usuario" });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.configurar).toBe(false);
  });

  it("lets admin_empresa view and configure", () => {
    const permissions = getPrinterPermissions({ role: "admin_empresa" });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.configurar).toBe(true);
  });

  it("lets master_admin view and configure", () => {
    const permissions = getPrinterPermissions({ role: "master_admin" });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.configurar).toBe(true);
  });

  it("requires a selected company", () => {
    const permissions = getPrinterPermissions({ role: "admin_empresa", companySelected: false });
    expect(permissions.visualizar).toBe(false);
    expect(permissions.configurar).toBe(false);
  });

  it("denies an unrecognized/null role", () => {
    const permissions = getPrinterPermissions({ role: null });
    expect(permissions.visualizar).toBe(false);
  });
});
