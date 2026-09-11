import { describe, expect, it } from "vitest";
import { findPendingMaterialByCode, type EventCustodyMaterialSummary } from "./event-custody-domain";
import type { CustodyOperationView } from "./checkin-checkout-types";

function operation(overrides: Partial<CustodyOperationView>): CustodyOperationView {
  return {
    id: "op1",
    empresa_id: "empresa1",
    material_id: "m1",
    material_nome: "Mesa de Som",
    material_codigo: "MESA-001",
    material_identificador: null,
    foto_path: null,
    tipo_controle: "quantidade",
    quantidade_retirada: 1,
    quantidade_devolvida: 0,
    quantidade_baixada: 0,
    quantidade_pendente: 1,
    localizacao_origem_id: "loc1",
    localizacao_origem_nome: "Depósito",
    retirada_em: "2026-08-14T18:42:00Z",
    previsao_retorno: null,
    executado_por: "user1",
    executor_nome: "Alex",
    responsavel_tipo: "funcionario",
    responsavel_usuario_id: null,
    responsavel_funcionario_id: "f1",
    responsavel_nome: "João",
    finalidade: "evento",
    referencia_tipo: "evento",
    referencia_id: "e1",
    observacao_saida: null,
    condicao_saida: "bom",
    status: "aberta",
    movimento_saida_id: "mov1",
    encerrada_em: null,
    created_at: "2026-08-14T18:42:00Z",
    updated_at: "2026-08-14T18:42:00Z",
    ...overrides,
  };
}

function materialSummary(overrides: Partial<EventCustodyMaterialSummary>): EventCustodyMaterialSummary {
  return {
    materialId: "m1",
    materialNome: "Mesa de Som",
    materialCodigo: "MESA-001",
    quantidadeRetirada: 1,
    quantidadeDevolvida: 0,
    quantidadePendente: 1,
    custodiasAbertas: [operation({})],
    ...overrides,
  };
}

describe("findPendingMaterialByCode", () => {
  it("matches by the material's internal code (material_codigo)", () => {
    const pendentes = [materialSummary({})];
    expect(findPendingMaterialByCode(pendentes, "MESA-001")?.materialId).toBe("m1");
  });

  it("matches by the custody's material_identificador fallback (patrimônio/série/barcode/uuid)", () => {
    const pendentes = [
      materialSummary({
        custodiasAbertas: [operation({ material_identificador: "PAT-900" })],
      }),
    ];
    expect(findPendingMaterialByCode(pendentes, "PAT-900")?.materialId).toBe("m1");
  });

  it("matches a QR by identificador_unico even when material_identificador holds a different value (patrimônio/série/barcode)", () => {
    const pendentes = [
      materialSummary({
        custodiasAbertas: [operation({ material_identificador: "PAT-900" })],
      }),
    ];
    const identificadorUnicoPorMaterial = new Map([["m1", "15b13cd1-6921-49a4-b67d-54c1b0e39acc"]]);
    expect(
      findPendingMaterialByCode(
        pendentes,
        "BACKSTAGE-PRO:MATERIAL:15b13cd1-6921-49a4-b67d-54c1b0e39acc",
        identificadorUnicoPorMaterial,
      )?.materialId,
    ).toBe("m1");
  });

  it("does not match a QR belonging to a different material's identificador_unico", () => {
    const pendentes = [
      materialSummary({}),
      materialSummary({
        materialId: "m2",
        materialNome: "Caixa de Som",
        materialCodigo: "CAIXA-001",
        custodiasAbertas: [operation({ id: "op2", material_id: "m2", material_nome: "Caixa de Som", material_codigo: "CAIXA-001" })],
      }),
    ];
    const identificadorUnicoPorMaterial = new Map([
      ["m1", "15b13cd1-6921-49a4-b67d-54c1b0e39acc"],
      ["m2", "aaaaaaaa-6921-49a4-b67d-54c1b0e39acc"],
    ]);
    const found = findPendingMaterialByCode(
      pendentes,
      "BACKSTAGE-PRO:MATERIAL:aaaaaaaa-6921-49a4-b67d-54c1b0e39acc",
      identificadorUnicoPorMaterial,
    );
    expect(found?.materialId).toBe("m2");
    expect(found?.materialId).not.toBe("m1");
  });

  it("is case-insensitive and trims keyboard-scanner whitespace", () => {
    const pendentes = [materialSummary({})];
    expect(findPendingMaterialByCode(pendentes, "\tmesa-001\r\n")?.materialId).toBe("m1");
  });

  it("returns undefined for an empty or unmatched code", () => {
    const pendentes = [materialSummary({})];
    expect(findPendingMaterialByCode(pendentes, "")).toBeUndefined();
    expect(findPendingMaterialByCode(pendentes, "NAO-EXISTE")).toBeUndefined();
  });

  it("returns undefined when there are no pending materials to search (fully returned material never appears in this array)", () => {
    expect(findPendingMaterialByCode([], "MESA-001")).toBeUndefined();
  });
});
