import { describe, expect, it } from "vitest";
import {
  canShowMaterialsNavigation,
  getMaterialPermissions,
} from "@/lib/material-permissions";

describe("material module permissions", () => {
  it("blocks every operation when the company does not own the module", () => {
    expect(
      getMaterialPermissions({
        role: "admin_empresa",
        moduleEnabled: false,
      }),
    ).toEqual({
      visualizar: false,
      criar: false,
      editar: false,
      inativar: false,
      gerenciarCategorias: false,
      gerenciarFotos: false,
      alterarStatus: false,
      gerarIdentificadores: false,
    });
  });

  it("allows a company user to view but not mutate licensed materials", () => {
    const permissions = getMaterialPermissions({
      role: "usuario",
      moduleEnabled: true,
    });

    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.editar).toBe(false);
    expect(permissions.gerenciarFotos).toBe(false);
    expect(permissions.gerarIdentificadores).toBe(false);
  });

  it("allows a writable company administrator to manage the module", () => {
    expect(
      getMaterialPermissions({
        role: "admin_empresa",
        moduleEnabled: true,
      }),
    ).toEqual({
      visualizar: true,
      criar: true,
      editar: true,
      inativar: true,
      gerenciarCategorias: true,
      gerenciarFotos: true,
      alterarStatus: true,
      gerarIdentificadores: true,
    });
  });

  it("keeps a blocked company administrator in read-only mode", () => {
    const permissions = getMaterialPermissions({
      role: "admin_empresa",
      moduleEnabled: true,
      companyReadOnly: true,
    });

    expect(permissions.visualizar).toBe(true);
    expect(permissions.criar).toBe(false);
    expect(permissions.inativar).toBe(false);
    expect(permissions.alterarStatus).toBe(false);
    expect(permissions.gerarIdentificadores).toBe(false);
  });

  it("preserves global master access independently of company entitlement", () => {
    expect(
      getMaterialPermissions({
        role: "master_admin",
        moduleEnabled: false,
        companyReadOnly: true,
      }).gerarIdentificadores,
    ).toBe(true);
  });

  it("hides module navigation without entitlement and preserves master access", () => {
    expect(
      canShowMaterialsNavigation({
        isMasterAdmin: false,
        moduleEnabled: false,
      }),
    ).toBe(false);
    expect(
      canShowMaterialsNavigation({
        isMasterAdmin: false,
        moduleEnabled: true,
      }),
    ).toBe(true);
    expect(
      canShowMaterialsNavigation({
        isMasterAdmin: true,
        moduleEnabled: false,
      }),
    ).toBe(true);
  });
});
