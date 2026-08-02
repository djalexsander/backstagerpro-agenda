import type { RentalDetail, RentalStatus } from "./material-rental-types";

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  rascunho: "Rascunho",
  reservada: "Reservada",
  pronta_retirada: "Pronta para retirada",
  em_andamento: "Em andamento",
  parcialmente_devolvida: "Parcialmente devolvida",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const transitions: Record<RentalStatus, RentalStatus[]> = {
  rascunho: ["reservada", "cancelada"],
  reservada: ["pronta_retirada", "em_andamento", "cancelada"],
  pronta_retirada: ["em_andamento", "cancelada"],
  em_andamento: ["parcialmente_devolvida", "concluida"],
  parcialmente_devolvida: ["em_andamento", "concluida"],
  concluida: [],
  cancelada: [],
};

export function canTransitionRental(from: RentalStatus, to: RentalStatus) {
  return transitions[from].includes(to);
}

export function calculateRentalSubtotal(
  quantity: number,
  billingUnits: number,
  unitPrice: number,
  discount: number,
) {
  if (quantity <= 0 || billingUnits <= 0 || unitPrice < 0 || discount < 0) {
    throw new Error("Valores da locação inválidos.");
  }
  const gross = quantity * billingUnits * unitPrice;
  if (discount > gross) throw new Error("O desconto não pode superar o valor bruto.");
  return Math.round((gross - discount + Number.EPSILON) * 100) / 100;
}

export function rentalIntervalsOverlap(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function isRentalOverdue(
  expectedReturn: Date,
  quantityWithCustomer: number,
  now = new Date(),
) {
  return quantityWithCustomer > 0 && expectedReturn < now;
}

export function getRentalActions(rental: Pick<RentalDetail, "status" | "itens" | "custodias">) {
  const contracted = rental.itens.reduce((total, item) => total + item.quantidade_contratada, 0);
  const pendingWithdrawal = rental.itens.reduce(
    (total, item) => total + item.quantidade_pendente_retirada,
    0,
  );
  const withCustomer = rental.itens.reduce(
    (total, item) => total + item.quantidade_com_cliente,
    0,
  );
  const hasPhysicalHistory = rental.custodias.length > 0;
  return {
    canEdit: rental.status === "rascunho",
    canConfirm: rental.status === "rascunho" && contracted > 0,
    canMarkReady: rental.status === "reservada",
    canCheckout:
      ["reservada", "pronta_retirada", "em_andamento", "parcialmente_devolvida"].includes(
        rental.status,
      ) && pendingWithdrawal > 0,
    canCheckin:
      ["em_andamento", "parcialmente_devolvida"].includes(rental.status) &&
      withCustomer > 0,
    canCancel:
      ["rascunho", "reservada", "pronta_retirada"].includes(rental.status) &&
      !hasPhysicalHistory,
    canConclude:
      ["em_andamento", "parcialmente_devolvida"].includes(rental.status) &&
      contracted > 0 &&
      pendingWithdrawal === 0 &&
      withCustomer === 0,
  };
}

export function normalizeRentalSearch(value: string) {
  return value.replace(/[\r\n\t]/g, "").trim();
}
