import type { RentalListItem } from "./material-rental-types";

export interface RentalOperationalQueue {
  pendingWithdrawal: RentalListItem[];
  pendingReturn: RentalListItem[];
  inProgress: RentalListItem[];
  overdue: RentalListItem[];
}

/**
 * Agrupamento por status/atrasada, os únicos campos confiáveis em
 * RentalListItem para triagem (quantidade_retirada/devolvida/com_cliente são
 * somas de quantidade, não comparáveis a quantidade_itens, que é contagem de
 * itens - por isso a fila usa status, e o painel de operação de cada locação
 * é quem calcula pendências exatas via getRentalActions, que exige os itens
 * completos). "atrasada" (calculado no servidor) tem prioridade sobre o
 * status: uma locação em_andamento atrasada aparece só em overdue, não
 * duplicada em inProgress.
 */
export function computeRentalOperationalQueue(rentals: RentalListItem[]): RentalOperationalQueue {
  const queue: RentalOperationalQueue = {
    pendingWithdrawal: [],
    pendingReturn: [],
    inProgress: [],
    overdue: [],
  };

  for (const rental of rentals) {
    if (rental.atrasada) {
      queue.overdue.push(rental);
      continue;
    }
    switch (rental.status) {
      case "reservada":
      case "pronta_retirada":
        queue.pendingWithdrawal.push(rental);
        break;
      case "parcialmente_devolvida":
        queue.pendingReturn.push(rental);
        break;
      case "em_andamento":
        queue.inProgress.push(rental);
        break;
      default:
        // rascunho/concluida/cancelada: sem ação operacional pendente.
        break;
    }
  }

  return queue;
}
