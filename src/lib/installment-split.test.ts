import { describe, expect, it } from "vitest";
import { splitInstallments } from "./installment-split";

describe("splitInstallments", () => {
  it("splits R$100 into 3 installments that sum to exactly R$100 (not 99.99 or 100.01)", () => {
    const parcelas = splitInstallments(100, 3);
    const soma = parcelas.reduce((sum, p) => sum + p.valor, 0);
    expect(Math.round(soma * 100)).toBe(10000);
    expect(parcelas).toEqual([
      { numero: 1, valor: 33.34 },
      { numero: 2, valor: 33.33 },
      { numero: 3, valor: 33.33 },
    ]);
  });

  it("splits evenly when the total divides cleanly", () => {
    expect(splitInstallments(300, 3)).toEqual([
      { numero: 1, valor: 100 },
      { numero: 2, valor: 100 },
      { numero: 3, valor: 100 },
    ]);
  });

  it("always sums exactly to the original total across a range of awkward splits", () => {
    for (const [total, count] of [[10, 3], [1, 7], [999.99, 4], [0.03, 3], [1234.56, 11]] as const) {
      const parcelas = splitInstallments(total, count);
      const somaCentavos = parcelas.reduce((sum, p) => sum + Math.round(p.valor * 100), 0);
      expect(somaCentavos).toBe(Math.round(total * 100));
      expect(parcelas).toHaveLength(count);
    }
  });

  it("rejects a non-positive total", () => {
    expect(() => splitInstallments(0, 3)).toThrow();
    expect(() => splitInstallments(-10, 3)).toThrow();
  });

  it("rejects fewer than 1 installment", () => {
    expect(() => splitInstallments(100, 0)).toThrow();
  });

  it("supports a single installment (equivalent to à vista)", () => {
    expect(splitInstallments(250.5, 1)).toEqual([{ numero: 1, valor: 250.5 }]);
  });
});
