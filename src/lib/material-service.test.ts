import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "./material-types";
import { EMPTY_MATERIAL_FORM } from "./material-types";
import { MaterialIdentificationPendingError } from "./material-errors";

const mocks = vi.hoisted(() => ({
  insertPayload: null as unknown,
  updatePayload: null as unknown,
  insertResult: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
  updateResult: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: (payload: unknown) => {
        mocks.insertPayload = payload;
        return {
          select: () => ({
            single: () => Promise.resolve(mocks.insertResult),
          }),
        };
      },
      update: (payload: unknown) => {
        mocks.updatePayload = payload;
        const builder = {
          eq: () => builder,
          select: () => ({
            single: () => Promise.resolve(mocks.updateResult),
          }),
        };
        return builder;
      },
    })),
    rpc: mocks.rpc,
  },
}));

import { replaceMaterialBarcode, saveMaterial } from "./material-service";

const empresaId = "31000000-0000-4000-8000-000000000001";
const materialId = "33000000-0000-4000-8000-000000000001";
const identifier = "550e8400-e29b-41d4-a716-446655440000";
const qrContent = `BACKSTAGE-PRO:MATERIAL:${identifier}`;

function row(overrides: Partial<Material> = {}): Material {
  return {
    id: materialId,
    empresa_id: empresaId,
    categoria_id: "32000000-0000-4000-8000-000000000001",
    codigo_interno: "MAT-001",
    identificador_unico: identifier,
    codigo_barras: null,
    tipo_identificacao: "qr_code",
    conteudo_qr_code: null,
    identificacao_gerada_em: null,
    identificacao_gerada_por: null,
    status_identificacao: "nao_gerada",
    nome: "Mesa digital",
    descricao: null,
    marca: null,
    modelo: null,
    numero_serie: null,
    numero_patrimonio: null,
    tipo_controle: "individual",
    quantidade: 0,
    estoque_minimo: 0,
    quantidade_legada_etapa1: 1,
    unidade_medida: "unidade",
    localizacao: null,
    valor_aquisicao: null,
    valor_reposicao: null,
    valor_locacao_padrao: null,
    data_aquisicao: null,
    fornecedor: null,
    observacoes: null,
    status_operacional: "disponivel",
    justificativa_status: null,
    ativo: true,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

function values(
  overrides: Partial<typeof EMPTY_MATERIAL_FORM> = {},
): typeof EMPTY_MATERIAL_FORM {
  return {
    ...EMPTY_MATERIAL_FORM,
    codigo_interno: "MAT-001",
    nome: "Mesa digital",
    categoria_id: "32000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

describe("material save identification flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertPayload = null;
    mocks.updatePayload = null;
    mocks.insertResult = { data: row(), error: null };
    mocks.updateResult = { data: row(), error: null };
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "generate_material_barcode" ? "0000000018" : qrContent,
        error: null,
      }),
    );
  });

  it("saves a normalized manually entered barcode", async () => {
    mocks.insertResult.data = row({
      codigo_barras: "BSP-MANUAL-001",
      tipo_identificacao: "codigo_barras",
      status_identificacao: "ativa",
    });

    const saved = await saveMaterial({
      empresaId,
      values: values({
        codigo_barras: "  BSP-MANUAL-001  ",
        tipo_identificacao: "codigo_barras",
      }),
      generateQrCode: false,
    });

    expect(mocks.insertPayload).toMatchObject({
      codigo_barras: "BSP-MANUAL-001",
      tipo_identificacao: "codigo_barras",
    });
    expect(saved.codigo_barras).toBe("BSP-MANUAL-001");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requests automatic barcode generation only after persistence", async () => {
    const saved = await saveMaterial({
      empresaId,
      values: values({
        codigo_barras: "",
        tipo_identificacao: "codigo_barras",
      }),
      generateQrCode: false,
      generateBarcode: true,
    });

    expect(mocks.insertPayload).toMatchObject({
      codigo_barras: null,
      tipo_identificacao: "qr_code",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("generate_material_barcode", {
      _material_id: materialId,
    });
    expect(saved.codigo_barras).toBe("0000000018");
    expect(saved.tipo_identificacao).toBe("codigo_barras");
  });

  it("requests an atomic server-side replacement for an existing barcode", async () => {
    mocks.rpc.mockResolvedValue({ data: "0000000026", error: null });

    await expect(replaceMaterialBarcode(materialId)).resolves.toBe("0000000026");
    expect(mocks.rpc).toHaveBeenCalledWith("replace_material_barcode", {
      _material_id: materialId,
    });
  });

  it("returns the database UUID and canonical QR content on creation", async () => {
    const saved = await saveMaterial({
      empresaId,
      values: values({ tipo_identificacao: "qr_code" }),
      generateQrCode: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("generate_material_qr_code", {
      _material_id: materialId,
    });
    expect(saved.identificador_unico).toBe(identifier);
    expect(saved.conteudo_qr_code).toBe(qrContent);
    expect(saved.status_identificacao).toBe("ativa");
  });

  it("creates QR and barcode together in the same save action", async () => {
    const saved = await saveMaterial({
      empresaId,
      values: values({
        codigo_barras: "",
        tipo_identificacao: "ambos",
      }),
      generateQrCode: true,
      generateBarcode: true,
    });

    expect(saved.codigo_barras).toBe("0000000018");
    expect(saved.conteudo_qr_code).toBe(qrContent);
    expect(saved.tipo_identificacao).toBe("ambos");
  });

  it("reports a pending identification when barcode generation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "barcode failure" },
    });

    const promise = saveMaterial({
      empresaId,
      values: values({ tipo_identificacao: "codigo_barras" }),
      generateQrCode: false,
      generateBarcode: true,
    });

    await expect(promise).rejects.toMatchObject({
      name: "MaterialIdentificationPendingError",
      materialId,
      message: expect.stringMatching(/código de barras/i),
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not regenerate or mutate UUID and QR content on edit", async () => {
    mocks.updateResult.data = row({
      nome: "Mesa digital editada",
      conteudo_qr_code: qrContent,
      status_identificacao: "ativa",
    });

    const saved = await saveMaterial({
      empresaId,
      id: materialId,
      values: values({ nome: "Mesa digital editada" }),
      generateQrCode: true,
    });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updatePayload).not.toHaveProperty("identificador_unico");
    expect(mocks.updatePayload).not.toHaveProperty("conteudo_qr_code");
    expect(saved.identificador_unico).toBe(identifier);
    expect(saved.conteudo_qr_code).toBe(qrContent);
  });

  it("reports a pending identification when QR generation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "technical database failure" },
    });

    const promise = saveMaterial({
      empresaId,
      values: values({ tipo_identificacao: "qr_code" }),
      generateQrCode: true,
    });

    await expect(promise).rejects.toMatchObject({
      name: "MaterialIdentificationPendingError",
      materialId,
    });
    await expect(promise).rejects.not.toThrow("technical database failure");
    await expect(promise).rejects.toBeInstanceOf(
      MaterialIdentificationPendingError,
    );
    expect(consoleError).toHaveBeenCalled();
  });
});
