import { describe, expect, it } from "vitest";
import { computeRentalOperationalQueue } from "./rental-operations-domain";
import type { RentalListItem, RentalStatus } from "./material-rental-types";

function rental(overrides: Partial<RentalListItem> & { id: string; status: RentalStatus }): RentalListItem {
  return {
    empresa_id: "empresa-1",
    cliente_id: "cliente-1",
    numero: "LOC-2026-000001",
    retirada_prevista_em: "2026-08-18T10:00:00.000Z",
    devolucao_prevista_em: "2026-08-20T10:00:00.000Z",
    responsavel_nome: "Fulano",
    valor_total: 100,
    cliente_nome: "Fulano",
    cliente_nome_fantasia: null,
    quantidade_itens: 1,
    quantidade_retirada: 0,
    quantidade_devolvida: 0,
    quantidade_com_cliente: 0,
    atrasada: false,
    ...overrides,
  };
}

describe("computeRentalOperationalQueue", () => {
  it("returns empty buckets for an empty list", () => {
    const queue = computeRentalOperationalQueue([]);
    expect(queue).toEqual({ pendingWithdrawal: [], pendingReturn: [], inProgress: [], overdue: [] });
  });

  it("buckets 'reservada' and 'pronta_retirada' as pendingWithdrawal", () => {
    const a = rental({ id: "a", status: "reservada" });
    const b = rental({ id: "b", status: "pronta_retirada" });
    const queue = computeRentalOperationalQueue([a, b]);
    expect(queue.pendingWithdrawal).toEqual([a, b]);
    expect(queue.pendingReturn).toEqual([]);
    expect(queue.inProgress).toEqual([]);
    expect(queue.overdue).toEqual([]);
  });

  it("buckets 'parcialmente_devolvida' as pendingReturn", () => {
    const item = rental({ id: "a", status: "parcialmente_devolvida" });
    const queue = computeRentalOperationalQueue([item]);
    expect(queue.pendingReturn).toEqual([item]);
  });

  it("buckets 'em_andamento' as inProgress", () => {
    const item = rental({ id: "a", status: "em_andamento" });
    const queue = computeRentalOperationalQueue([item]);
    expect(queue.inProgress).toEqual([item]);
  });

  it("excludes 'rascunho', 'concluida' and 'cancelada' from every bucket", () => {
    const items = [
      rental({ id: "a", status: "rascunho" }),
      rental({ id: "b", status: "concluida" }),
      rental({ id: "c", status: "cancelada" }),
    ];
    const queue = computeRentalOperationalQueue(items);
    expect(queue).toEqual({ pendingWithdrawal: [], pendingReturn: [], inProgress: [], overdue: [] });
  });

  it("routes an overdue rental to overdue regardless of status, never duplicating it elsewhere", () => {
    const item = rental({ id: "a", status: "em_andamento", atrasada: true });
    const queue = computeRentalOperationalQueue([item]);
    expect(queue.overdue).toEqual([item]);
    expect(queue.inProgress).toEqual([]);
  });

  it("keeps a mixed list correctly bucketed and preserves input order within a bucket", () => {
    const withdrawal1 = rental({ id: "w1", status: "reservada" });
    const withdrawal2 = rental({ id: "w2", status: "pronta_retirada" });
    const inProgress = rental({ id: "p1", status: "em_andamento" });
    const pendingReturn = rental({ id: "r1", status: "parcialmente_devolvida" });
    const overdue = rental({ id: "o1", status: "em_andamento", atrasada: true });
    const draft = rental({ id: "d1", status: "rascunho" });

    const queue = computeRentalOperationalQueue([withdrawal1, inProgress, withdrawal2, pendingReturn, overdue, draft]);

    expect(queue.pendingWithdrawal).toEqual([withdrawal1, withdrawal2]);
    expect(queue.inProgress).toEqual([inProgress]);
    expect(queue.pendingReturn).toEqual([pendingReturn]);
    expect(queue.overdue).toEqual([overdue]);
  });
});
