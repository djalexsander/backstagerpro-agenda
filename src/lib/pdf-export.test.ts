import { describe, expect, it } from "vitest";
import { computeConsolidatedFinancialResult } from "./pdf-export";
import type { FinancialMaintenanceSection, FinancialRentalsSection } from "./pdf-export";
import type { MaintenanceExpenseEntry, ReceivableEntry } from "./financial-ledger-types";

function makeRentals(valorRecebido: number): FinancialRentalsSection {
  return {
    summary: { valorContratado: 0, valorRecebido, valorAReceber: 0, valorVencido: 0, valorPendenteRegularizacao: 0 },
    entries: [] as ReceivableEntry[],
  };
}

function makeMaintenance(valorTotal: number): FinancialMaintenanceSection {
  return { valorTotal, entries: [] as MaintenanceExpenseEntry[] };
}

describe("computeConsolidatedFinancialResult", () => {
  it("reflects only event totals when neither locações nor manutenções are included", () => {
    expect(computeConsolidatedFinancialResult(1000, 400)).toEqual({
      receita: 1000,
      despesa: 400,
      resultado: 600,
    });
  });

  it("adds locações' valor_recebido to receita and leaves despesa untouched", () => {
    expect(computeConsolidatedFinancialResult(1000, 400, makeRentals(2500))).toEqual({
      receita: 3500,
      despesa: 400,
      resultado: 3100,
    });
  });

  it("adds manutenções' valorTotal to despesa and leaves receita untouched - no double counting with locações", () => {
    expect(computeConsolidatedFinancialResult(1000, 400, makeRentals(2500), makeMaintenance(300))).toEqual({
      receita: 3500,
      despesa: 700,
      resultado: 2800,
    });
  });

  it("counts manutenções exactly once even with zero events and zero locações", () => {
    expect(computeConsolidatedFinancialResult(0, 0, undefined, makeMaintenance(850))).toEqual({
      receita: 0,
      despesa: 850,
      resultado: -850,
    });
  });

  it("can produce a negative resultado when despesas (including manutenções) exceed receita", () => {
    const result = computeConsolidatedFinancialResult(500, 200, makeRentals(100), makeMaintenance(900));
    expect(result.receita).toBe(600);
    expect(result.despesa).toBe(1100);
    expect(result.resultado).toBe(-500);
  });
});
