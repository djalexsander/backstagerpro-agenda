export interface InstallmentSplit {
  numero: number;
  valor: number;
}

/**
 * Splits a total into `count` installments whose sum is always exactly
 * `total` (works in integer cents to avoid floating point drift). The
 * remainder from integer division is spread one cent at a time across the
 * first installments, so no single installment absorbs a disproportionate
 * adjustment - e.g. 100 / 3 -> [33.34, 33.33, 33.33].
 */
export function splitInstallments(total: number, count: number): InstallmentSplit[] {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Informe um valor total válido para parcelar.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Informe um número de parcelas válido.");
  }
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, index) => ({
    numero: index + 1,
    valor: (baseCents + (index < remainderCents ? 1 : 0)) / 100,
  }));
}
