import { describe, expect, it } from "vitest";
import { findPendingMaterialByCode, summarizeEventCustody } from "./event-custody-domain";
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

describe("summarizeEventCustody", () => {
  it("sums totals and buckets a fully open material as pending", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", quantidade_retirada: 3, quantidade_devolvida: 0, quantidade_pendente: 3, status: "aberta" }),
    ]);
    expect(summary.totalRetirado).toBe(3);
    expect(summary.totalDevolvido).toBe(0);
    expect(summary.totalPendente).toBe(3);
    expect(summary.materiaisPendentes).toHaveLength(1);
    expect(summary.materiaisDevolvidos).toHaveLength(0);
  });

  it("buckets a fully returned material as devolvido, not pendente", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
    ]);
    expect(summary.materiaisPendentes).toHaveLength(0);
    expect(summary.materiaisDevolvidos).toHaveLength(1);
    expect(summary.materiaisDevolvidos[0].quantidadeRetirada).toBe(2);
  });

  it("aggregates multiple custody rows for the same material across separate checkouts", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
      operation({ id: "op2", material_id: "m1", quantidade_retirada: 3, quantidade_devolvida: 1, quantidade_pendente: 2, status: "parcial" }),
    ]);
    expect(summary.totalRetirado).toBe(5);
    expect(summary.totalDevolvido).toBe(3);
    expect(summary.totalPendente).toBe(2);
    // one material with net pending quantity -> counted as pending, not split into two rows
    expect(summary.materiaisPendentes).toHaveLength(1);
    expect(summary.materiaisPendentes[0].materialId).toBe("m1");
    expect(summary.materiaisDevolvidos).toHaveLength(0);
  });

  it("keeps distinct materials as separate rows", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_nome: "Mesa de Som", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
      operation({ id: "op2", material_id: "m2", material_nome: "Caixa de Som", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
    ]);
    expect(summary.materiaisPendentes.map((item) => item.materialId)).toEqual(["m1"]);
    expect(summary.materiaisDevolvidos.map((item) => item.materialId)).toEqual(["m2"]);
  });

  it("ignores cancelled checkouts entirely - they were reversed, never really pending", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "cancelada" }),
    ]);
    expect(summary.totalRetirado).toBe(0);
    expect(summary.totalPendente).toBe(0);
    expect(summary.materiaisPendentes).toHaveLength(0);
    expect(summary.materiaisDevolvidos).toHaveLength(0);
  });

  it("returns an empty summary for no operations", () => {
    const summary = summarizeEventCustody([]);
    expect(summary).toEqual({
      totalRetirado: 0,
      totalDevolvido: 0,
      totalPendente: 0,
      materiaisPendentes: [],
      materiaisDevolvidos: [],
    });
  });

  describe("custodiasAbertas (resolves which custody a check-in action targets)", () => {
    it("carries the single open custody for a material with only one checkout", () => {
      const summary = summarizeEventCustody([
        operation({ id: "op1", material_id: "m1", quantidade_retirada: 3, quantidade_devolvida: 0, quantidade_pendente: 3, status: "aberta" }),
      ]);
      expect(summary.materiaisPendentes[0].custodiasAbertas).toHaveLength(1);
      expect(summary.materiaisPendentes[0].custodiasAbertas[0].id).toBe("op1");
    });

    it("orders multiple open custodies for the same material oldest-first", () => {
      const summary = summarizeEventCustody([
        operation({ id: "op-newer", material_id: "m1", retirada_em: "2026-08-16T10:00:00Z", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
        operation({ id: "op-older", material_id: "m1", retirada_em: "2026-08-14T10:00:00Z", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
      ]);
      expect(summary.materiaisPendentes[0].custodiasAbertas.map((item) => item.id)).toEqual([
        "op-older",
        "op-newer",
      ]);
    });

    it("excludes an already fully-returned custody row from custodiasAbertas even when a sibling row for the same material is still pending", () => {
      const summary = summarizeEventCustody([
        operation({ id: "op-done", material_id: "m1", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
        operation({ id: "op-pending", material_id: "m1", quantidade_retirada: 3, quantidade_devolvida: 1, quantidade_pendente: 2, status: "parcial" }),
      ]);
      expect(summary.materiaisPendentes[0].custodiasAbertas.map((item) => item.id)).toEqual([
        "op-pending",
      ]);
    });

    it("leaves custodiasAbertas empty for a fully returned material - nothing left to check in", () => {
      const summary = summarizeEventCustody([
        operation({ id: "op1", material_id: "m1", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
      ]);
      expect(summary.materiaisDevolvidos[0].custodiasAbertas).toEqual([]);
    });
  });
});

describe("findPendingMaterialByCode", () => {
  it("matches by the material's internal code (material_codigo)", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_codigo: "MESA-001", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "MESA-001")?.materialId).toBe("m1");
  });

  it("matches by the custody's material_identificador fallback (patrimônio/série/barcode/uuid)", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_codigo: "MESA-001", material_identificador: "PAT-900", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "PAT-900")?.materialId).toBe("m1");
  });

  it("matches a QR by identificador_unico even when material_identificador holds a different value (patrimônio/série/barcode)", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_identificador: "PAT-900", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    const identificadorUnicoPorMaterial = new Map([["m1", "15b13cd1-6921-49a4-b67d-54c1b0e39acc"]]);
    expect(
      findPendingMaterialByCode(
        summary.materiaisPendentes,
        "BACKSTAGE-PRO:MATERIAL:15b13cd1-6921-49a4-b67d-54c1b0e39acc",
        identificadorUnicoPorMaterial,
      )?.materialId,
    ).toBe("m1");
  });

  it("does not match a QR belonging to a different material's identificador_unico", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
      operation({ id: "op2", material_id: "m2", material_nome: "Caixa de Som", material_codigo: "CAIXA-001", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    const identificadorUnicoPorMaterial = new Map([
      ["m1", "15b13cd1-6921-49a4-b67d-54c1b0e39acc"],
      ["m2", "aaaaaaaa-6921-49a4-b67d-54c1b0e39acc"],
    ]);
    const found = findPendingMaterialByCode(
      summary.materiaisPendentes,
      "BACKSTAGE-PRO:MATERIAL:aaaaaaaa-6921-49a4-b67d-54c1b0e39acc",
      identificadorUnicoPorMaterial,
    );
    expect(found?.materialId).toBe("m2");
    expect(found?.materialId).not.toBe("m1");
  });

  it("is case-insensitive and trims keyboard-scanner whitespace", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_codigo: "MESA-001", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "\tmesa-001\r\n")?.materialId).toBe("m1");
  });

  it("returns undefined for an empty or unmatched code", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_codigo: "MESA-001", quantidade_retirada: 1, quantidade_devolvida: 0, quantidade_pendente: 1, status: "aberta" }),
    ]);
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "")).toBeUndefined();
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "NAO-EXISTE")).toBeUndefined();
  });

  it("does not match a fully returned material - it has no pending row to search", () => {
    const summary = summarizeEventCustody([
      operation({ id: "op1", material_id: "m1", material_codigo: "MESA-001", quantidade_retirada: 2, quantidade_devolvida: 2, quantidade_pendente: 0, status: "concluida" }),
    ]);
    expect(findPendingMaterialByCode(summary.materiaisPendentes, "MESA-001")).toBeUndefined();
  });
});
