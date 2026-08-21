import { describe, expect, it } from "vitest";
import { summarizeEventCustody } from "./event-custody-domain";
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
});
