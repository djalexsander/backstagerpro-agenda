import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  getMaintenanceExpensesSummary,
  getRentalsFinancialSummary,
  listClientReceivableEntries,
  listMaintenanceExpenses,
  registerRentalReceipt,
  reverseRentalReceipt,
} from "./financial-ledger-service";

describe("financial-ledger-service", () => {
  beforeEach(() => rpc.mockReset());

  it("passes the installment id through to the canonical RPC when registering a receipt against a parcela", async () => {
    rpc.mockResolvedValue({ data: { id: "lancamento" }, error: null });
    await registerRentalReceipt("company", {
      rentalId: "rental", amount: 100, clientUuid: "req", installmentId: "parcela-1",
    });
    expect(rpc).toHaveBeenCalledWith("registrar_recebimento_locacao", expect.objectContaining({
      _locacao_id: "rental", _valor: 100, _parcela_id: "parcela-1",
    }));
  });

  it("omits the installment id for an à vista receipt", async () => {
    rpc.mockResolvedValue({ data: { id: "lancamento" }, error: null });
    await registerRentalReceipt("company", { rentalId: "rental", amount: 100, clientUuid: "req" });
    expect(rpc).toHaveBeenCalledWith("registrar_recebimento_locacao", expect.objectContaining({ _parcela_id: undefined }));
  });

  it("maps a known reversal error code to a Portuguese message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "FN018", message: "raw" } });
    await expect(
      reverseRentalReceipt("company", { receiptId: "receipt", justification: "erro de digitação", clientUuid: "req" }),
    ).rejects.toThrow("saldo estornável");
  });

  it("sends the reversal request with justification and optional partial amount", async () => {
    rpc.mockResolvedValue({ data: { id: "lancamento" }, error: null });
    await reverseRentalReceipt("company", {
      receiptId: "receipt", justification: "devolução parcial", clientUuid: "req", amount: 40,
    });
    expect(rpc).toHaveBeenCalledWith("estornar_recebimento_locacao", expect.objectContaining({
      _recebimento_id: "receipt", _justificativa: "devolução parcial", _valor: 40,
    }));
  });

  it("maps the aggregate rentals summary RPC into a typed, zero-defaulted object", async () => {
    rpc.mockResolvedValue({
      data: [{ valor_contratado: 1000, valor_recebido: 400, valor_a_receber: 600, valor_vencido: 100, valor_pendente_regularizacao: 0 }],
      error: null,
    });
    const summary = await getRentalsFinancialSummary("company");
    expect(summary).toEqual({
      valorContratado: 1000, valorRecebido: 400, valorAReceber: 600, valorVencido: 100, valorPendenteRegularizacao: 0,
    });
  });

  it("defaults every field to zero when the aggregate RPC returns no row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const summary = await getRentalsFinancialSummary("company");
    expect(summary).toEqual({
      valorContratado: 0, valorRecebido: 0, valorAReceber: 0, valorVencido: 0, valorPendenteRegularizacao: 0,
    });
  });

  it("searches receivables by the client's own name and narrows to that exact client id, open titles only", async () => {
    const row = (overrides: Record<string, unknown>) => ({
      item: {
        id: "x", cliente_id: "client-1", forma_cobranca: "avista", valor_original: 100, valor_recebido: 0,
        valor_estornado: 0, status: "pendente", ...overrides,
      },
      total_count: 3,
    });
    rpc.mockResolvedValue({
      data: [
        row({ id: "same-name-other-client", cliente_id: "client-2" }),
        row({ id: "recebido-ja-quitado", status: "recebido" }),
        row({ id: "match", cliente_id: "client-1", status: "parcial" }),
      ],
      error: null,
    });
    const entries = await listClientReceivableEntries("company", "client-1", "Ana Produções");
    expect(rpc).toHaveBeenCalledWith("listar_contas_receber", expect.objectContaining({
      _empresa_id: "company", _busca: "Ana Produções", _pagina: 1, _por_pagina: 100,
    }));
    expect(entries.map((entry) => entry.id)).toEqual(["match"]);
  });

  it("lists the Manutenções category (despesas) with pagination and an optional search term", async () => {
    rpc.mockResolvedValue({
      data: [{ item: { id: "lanc-1", ordem_numero: "MAN-2026-000001", valor_original: 160 }, total_count: 1 }],
      error: null,
    });
    const result = await listMaintenanceExpenses("company", 1, 10, "MAN-2026");
    expect(rpc).toHaveBeenCalledWith("listar_despesas_manutencao", {
      _empresa_id: "company", _pagina: 1, _por_pagina: 10, _busca: "MAN-2026",
    });
    expect(result).toEqual({ items: [{ id: "lanc-1", ordem_numero: "MAN-2026-000001", valor_original: 160 }], total: 1 });
  });

  it("maps the maintenance expenses summary RPC into a typed, zero-defaulted object", async () => {
    rpc.mockResolvedValue({ data: [{ valor_total: 160, quantidade_ordens: 1 }], error: null });
    const summary = await getMaintenanceExpensesSummary("company");
    expect(summary).toEqual({ valorTotal: 160, quantidadeOrdens: 1 });
  });

  it("defaults the maintenance expenses summary to zero when the RPC returns no row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const summary = await getMaintenanceExpensesSummary("company");
    expect(summary).toEqual({ valorTotal: 0, quantidadeOrdens: 0 });
  });
});
