import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  deleteBobinaProfile,
  duplicateBobinaProfile,
  listBobinaProfiles,
  resolveBobinaProfile,
  saveBobinaProfile,
  setDefaultBobinaProfile,
} from "./bobina-profile-service";
import type { BobinaProfile, SaveBobinaProfileInput } from "./bobina-profile-types";

function profile(overrides: Partial<BobinaProfile> = {}): BobinaProfile {
  return {
    id: "profile-1", empresa_id: "company-1", nome: "50x30 - 2 colunas",
    largura_etiqueta_mm: 50, altura_etiqueta_mm: 30, colunas: 2,
    espacamento_horizontal_mm: 3, espacamento_vertical_mm: 2,
    margem_esquerda_mm: 2, margem_direita_mm: 2, margem_superior_mm: 2, margem_inferior_mm: 2,
    orientacao: "retrato", largura_midia_mm: 110, offset_horizontal_mm: 0, offset_vertical_mm: 0,
    dpi: "automatico", dpi_personalizado: null, padrao: true, ativo: true, updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function formInput(overrides: Partial<SaveBobinaProfileInput> = {}): SaveBobinaProfileInput {
  return {
    nome: "50x30 - 2 colunas", larguraEtiquetaMm: 50, alturaEtiquetaMm: 30, colunas: 2,
    espacamentoHorizontalMm: 3, espacamentoVerticalMm: 2,
    margemEsquerdaMm: 2, margemDireitaMm: 2, margemSuperiorMm: 2, margemInferiorMm: 2,
    orientacao: "retrato", larguraMidiaMm: 110, offsetHorizontalMm: 0, offsetVerticalMm: 0,
    dpi: "automatico", dpiPersonalizado: null, padrao: true,
    ...overrides,
  };
}

describe("bobina-profile-service RPC calls", () => {
  beforeEach(() => rpc.mockReset());

  it("lists profiles for the given company via the canonical RPC", async () => {
    rpc.mockResolvedValue({ data: [profile()], error: null });
    const result = await listBobinaProfiles("company-1");
    expect(rpc).toHaveBeenCalledWith("listar_perfis_bobina", { _empresa_id: "company-1" });
    expect(result).toEqual([profile()]);
  });

  it("saves a new profile with every field mapped to its snake_case RPC param", async () => {
    rpc.mockResolvedValue({ data: profile(), error: null });
    await saveBobinaProfile("company-1", formInput());
    expect(rpc).toHaveBeenCalledWith("salvar_perfil_bobina", expect.objectContaining({
      _empresa_id: "company-1",
      _nome: "50x30 - 2 colunas",
      _largura_etiqueta_mm: 50,
      _altura_etiqueta_mm: 30,
      _colunas: 2,
      _espacamento_horizontal_mm: 3,
      _espacamento_vertical_mm: 2,
      _margem_esquerda_mm: 2,
      _margem_direita_mm: 2,
      _margem_superior_mm: 2,
      _margem_inferior_mm: 2,
      _orientacao: "retrato",
      _largura_midia_mm: 110,
      _offset_horizontal_mm: 0,
      _offset_vertical_mm: 0,
      _dpi: "automatico",
      _padrao: true,
    }));
  });

  it("forwards the id and expected_updated_at when editing an existing profile", async () => {
    rpc.mockResolvedValue({ data: profile(), error: null });
    await saveBobinaProfile("company-1", formInput({ id: "profile-1", expectedUpdatedAt: "2026-01-01T00:00:00Z" }));
    expect(rpc).toHaveBeenCalledWith("salvar_perfil_bobina", expect.objectContaining({
      _perfil_id: "profile-1", _expected_updated_at: "2026-01-01T00:00:00Z",
    }));
  });

  it("duplicates a profile, forwarding an explicit new name when given", async () => {
    rpc.mockResolvedValue({ data: profile({ id: "profile-2", nome: "Cópia" }), error: null });
    await duplicateBobinaProfile("company-1", "profile-1", "Cópia");
    expect(rpc).toHaveBeenCalledWith("duplicar_perfil_bobina", {
      _empresa_id: "company-1", _perfil_id: "profile-1", _novo_nome: "Cópia",
    });
  });

  it("duplicates a profile without a name, letting the RPC default it", async () => {
    rpc.mockResolvedValue({ data: profile({ id: "profile-2" }), error: null });
    await duplicateBobinaProfile("company-1", "profile-1");
    expect(rpc).toHaveBeenCalledWith("duplicar_perfil_bobina", {
      _empresa_id: "company-1", _perfil_id: "profile-1", _novo_nome: undefined,
    });
  });

  it("deletes (soft) a profile via the canonical RPC", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await deleteBobinaProfile("company-1", "profile-1");
    expect(rpc).toHaveBeenCalledWith("excluir_perfil_bobina", { _empresa_id: "company-1", _perfil_id: "profile-1" });
  });

  it("sets a profile as the company default", async () => {
    rpc.mockResolvedValue({ data: profile(), error: null });
    await setDefaultBobinaProfile("company-1", "profile-1");
    expect(rpc).toHaveBeenCalledWith("definir_perfil_bobina_padrao", { _empresa_id: "company-1", _perfil_id: "profile-1" });
  });

  it("maps the BB001 error code to a Portuguese message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "BB001", message: "raw" } });
    await expect(listBobinaProfiles("company-1")).rejects.toThrow("Selecione a empresa.");
  });

  it("passes through the server's own descriptive message for other BB0xx codes (e.g. width-exceeded)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "BB006", message: "As dimensões configuradas ultrapassam a largura da bobina (necessário 104.0 mm, disponível 90.0 mm)." },
    });
    await expect(saveBobinaProfile("company-1", formInput())).rejects.toThrow(/necessário 104.0 mm, disponível 90.0 mm/);
  });

  it("falls back to a generic message when the RPC gives neither a known code nor text", async () => {
    rpc.mockResolvedValue({ data: null, error: {} });
    await expect(listBobinaProfiles("company-1")).rejects.toThrow("Falha na operação de perfil de bobina.");
  });
});

describe("resolveBobinaProfile", () => {
  const profiles = [profile({ id: "a" }), profile({ id: "b", padrao: false })];

  it("is null when no id is given", () => {
    expect(resolveBobinaProfile(profiles, null)).toBeNull();
    expect(resolveBobinaProfile(profiles, undefined)).toBeNull();
  });

  it("is null when the id doesn't match any active profile (e.g. a soft-deleted one)", () => {
    expect(resolveBobinaProfile(profiles, "missing")).toBeNull();
  });

  it("finds the matching profile by id", () => {
    expect(resolveBobinaProfile(profiles, "b")).toEqual(profile({ id: "b", padrao: false }));
  });
});
