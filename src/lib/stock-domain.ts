import type {
  StockAdjustmentInput,
  StockMovementInput,
  StockMovementType,
} from "./stock-types";

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  entrada: "Entrada",
  saida: "Saída",
  transferencia: "Transferência",
  ajuste_positivo: "Ajuste positivo",
  ajuste_negativo: "Ajuste negativo",
  saldo_inicial: "Saldo inicial",
  estorno: "Estorno",
};

export const STOCK_LOCATION_TYPE_LABELS = {
  deposito: "Depósito",
  almoxarifado: "Almoxarifado",
  sala: "Sala",
  veiculo: "Veículo",
  estrutura: "Estrutura",
  area_tecnica: "Área técnica",
  outra: "Outra",
} as const;

export function validateStockMovement(
  input: StockMovementInput,
  individual: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.materialId) errors.materialId = "Selecione o material.";
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    errors.quantity = "Informe uma quantidade inteira maior que zero.";
  }
  if (individual && input.quantity !== 1) {
    errors.quantity = "Movimentações de itens individuais devem usar uma unidade.";
  }
  if (
    (input.type === "entrada" || input.type === "saida") &&
    !input.reason?.trim()
  ) {
    errors.reason = "Informe o motivo da movimentação.";
  }
  if (
    (input.type === "entrada" || input.type === "saldo_inicial") &&
    !input.destinationLocationId
  ) {
    errors.destinationLocationId = "Selecione a localização de destino.";
  }
  if (input.type === "saida" && !input.originLocationId) {
    errors.originLocationId = "Selecione a localização de origem.";
  }
  if (input.type === "transferencia") {
    if (!input.originLocationId) {
      errors.originLocationId = "Selecione a localização de origem.";
    }
    if (!input.destinationLocationId) {
      errors.destinationLocationId = "Selecione a localização de destino.";
    }
    if (
      input.originLocationId &&
      input.originLocationId === input.destinationLocationId
    ) {
      errors.destinationLocationId = "Origem e destino devem ser diferentes.";
    }
  }
  return errors;
}

export function validateStockAdjustment(
  input: StockAdjustmentInput,
  individual: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.materialId) errors.materialId = "Selecione o material.";
  if (!input.locationId) errors.locationId = "Selecione a localização.";
  if (
    !Number.isInteger(input.physicalQuantity) ||
    input.physicalQuantity < 0
  ) {
    errors.physicalQuantity =
      "Informe uma quantidade física inteira e não negativa.";
  }
  if (individual && ![0, 1].includes(input.physicalQuantity)) {
    errors.physicalQuantity = "O saldo físico individual deve ser zero ou um.";
  }
  if (!input.justification.trim()) {
    errors.justification = "Informe a justificativa do ajuste.";
  }
  if (!input.reason.trim()) {
    errors.reason = "Informe o motivo do ajuste.";
  }
  return errors;
}

export function stockBalanceStatus(
  quantity: number,
  minimum: number,
): "sem_saldo" | "abaixo_minimo" | "normal" {
  if (quantity === 0) return "sem_saldo";
  if (quantity <= minimum) return "abaixo_minimo";
  return "normal";
}
