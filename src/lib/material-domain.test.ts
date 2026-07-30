import { describe, expect, it } from "vitest";
import {
  materialFormToPayload,
  parseBrazilianDecimal,
  validateMaterialForm,
} from "./material-domain";
import { EMPTY_MATERIAL_FORM } from "./material-types";

function form(overrides = {}) {
  return {
    ...EMPTY_MATERIAL_FORM,
    codigo_interno: "MAT-001",
    nome: "Mesa digital",
    categoria_id: "category-id",
    ...overrides,
  };
}

describe("material domain rules", () => {
  it("accepts an individual item without an editable balance", () => {
    expect(validateMaterialForm(form())).toEqual({});
    expect(materialFormToPayload(form())).not.toHaveProperty("quantidade");
    expect(materialFormToPayload(form())).not.toHaveProperty("localizacao");
  });

  it("accepts a quantity-controlled item", () => {
    expect(
      validateMaterialForm(
        form({ tipo_controle: "quantidade", estoque_minimo: "25" }),
      ),
    ).toEqual({});
  });

  it("rejects an invalid minimum stock", () => {
    expect(validateMaterialForm(form({ estoque_minimo: "2.5" })).estoque_minimo).toMatch(
      /inteiro/i,
    );
  });

  it("rejects negative minimum stock and invalid monetary values", () => {
    const errors = validateMaterialForm(
      form({ estoque_minimo: "-1", valor_reposicao: "-10,00" }),
    );
    expect(errors.estoque_minimo).toMatch(/não negativo/i);
    expect(errors.valor_reposicao).toMatch(/valor monetário/i);
  });

  it("requires justification for a manual operational status", () => {
    const previous = { status_operacional: "disponivel" as const };
    expect(
      validateMaterialForm(
        form({ status_operacional: "avariado" }),
        previous,
      ).justificativa_status,
    ).toMatch(/justificativa/i);
    expect(
      validateMaterialForm(
        form({
          status_operacional: "avariado",
          justificativa_status: "Carcaça danificada",
        }),
        previous,
      ),
    ).toEqual({});
  });

  it("normalizes Brazilian money without sending a floating-point amount", () => {
    expect(parseBrazilianDecimal("R$ 1.234,56")).toBe("1234.56");
    expect(parseBrazilianDecimal("99,9")).toBe("99.90");
    expect(parseBrazilianDecimal("")).toBeNull();
  });

  it("normalizes an optional Code 128 barcode in the mutable payload", () => {
    const payload = materialFormToPayload(
      form({
        codigo_barras: "  BSP-A1B2C3  ",
        tipo_identificacao: "codigo_barras",
      }),
    );

    expect(payload.codigo_barras).toBe("BSP-A1B2C3");
    expect(payload.tipo_identificacao).toBe("codigo_barras");
    expect(payload).not.toHaveProperty("identificador_unico");
    expect(payload).not.toHaveProperty("conteudo_qr_code");
  });

  it("requires a barcode when it is selected as an identification type", () => {
    expect(
      validateMaterialForm(
        form({
          codigo_barras: "",
          tipo_identificacao: "ambos",
        }),
      ).codigo_barras,
    ).toMatch(/informe o código de barras/i);
  });

  it("reports required fields without mutating the form", () => {
    const values = { ...EMPTY_MATERIAL_FORM };
    const errors = validateMaterialForm(values);
    expect(errors).toMatchObject({
      codigo_interno: expect.any(String),
      nome: expect.any(String),
      categoria_id: expect.any(String),
    });
    expect(values).toEqual(EMPTY_MATERIAL_FORM);
  });
});
