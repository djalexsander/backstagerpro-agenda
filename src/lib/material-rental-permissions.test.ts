import { describe, expect, it } from "vitest";
import { canShowRentalNavigation, getRentalPermissions } from "./material-rental-permissions";

describe("material rental visual permissions", () => {
  it("allows common users to read but not mutate", () => {
    const permissions = getRentalPermissions({ role: "usuario", moduleEnabled: true, companyReadOnly: false });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.retirar).toBe(false);
    expect(permissions.visualizarValores).toBe(true);
  });

  it("allows tenant administrators to perform the Stage 4 operations", () => {
    const permissions = getRentalPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: false });
    expect(permissions).toMatchObject({ criar: true, editar: true, reservar: true, retirar: true, devolver: true, cancelar: true });
  });

  it("blocks writes in read-only companies", () => {
    const permissions = getRentalPermissions({ role: "admin_empresa", moduleEnabled: true, companyReadOnly: true });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.devolver).toBe(false);
  });

  it("fails closed without module or selected company", () => {
    expect(getRentalPermissions({ role: "master_admin", moduleEnabled: false, companyReadOnly: false }).visualizar).toBe(false);
    expect(getRentalPermissions({ role: "master_admin", moduleEnabled: true, companyReadOnly: false, companySelected: false }).visualizar).toBe(false);
  });

  it("unlocks criar/retirar with an explicit create grant and editar/reservar/devolver with edit", () => {
    expect(
      getRentalPermissions({
        role: "usuario", moduleEnabled: true, companyReadOnly: false,
        granular: { canCreate: true, canEdit: false, canDelete: false },
      }),
    ).toMatchObject({ criar: true, retirar: true, editar: false, reservar: false, devolver: false, cancelar: false });
    expect(
      getRentalPermissions({
        role: "usuario", moduleEnabled: true, companyReadOnly: false,
        granular: { canCreate: false, canEdit: true, canDelete: false },
      }),
    ).toMatchObject({ criar: false, retirar: false, editar: true, reservar: true, devolver: true, cancelar: false });
    expect(
      getRentalPermissions({
        role: "usuario", moduleEnabled: true, companyReadOnly: false,
        granular: { canCreate: false, canEdit: false, canDelete: true },
      }).cancelar,
    ).toBe(true);
  });

  it("still blocks a granted usuario when the company is read-only", () => {
    const permissions = getRentalPermissions({
      role: "usuario", moduleEnabled: true, companyReadOnly: true,
      granular: { canCreate: true, canEdit: true, canDelete: true },
    });
    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.cancelar).toBe(false);
  });

  it("keeps Master navigation discoverable while requiring explicit context in-page", () => {
    expect(canShowRentalNavigation({ isMasterAdmin: true, moduleEnabled: false })).toBe(true);
    expect(canShowRentalNavigation({ isMasterAdmin: false, moduleEnabled: false })).toBe(false);
  });
});
