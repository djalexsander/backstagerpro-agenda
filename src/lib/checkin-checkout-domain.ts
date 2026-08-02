import { MATERIAL_QR_PREFIX } from "./material-identification";
import type {
  CheckinInput,
  CheckoutInput,
  CustodyCondition,
  CustodyMaterialSearchResult,
  CustodyPurpose,
  CustodyStatus,
} from "./checkin-checkout-types";

export const CUSTODY_CONDITION_LABELS: Record<CustodyCondition, string> = {
  bom: "Bom",
  com_avaria: "Com avaria",
  danificado: "Danificado",
  manutencao_necessaria: "Manutenção necessária",
  incompleto: "Incompleto",
};

export const CUSTODY_PURPOSE_LABELS: Record<CustodyPurpose, string> = {
  uso_interno: "Uso interno",
  funcionario: "Funcionário",
  evento: "Evento",
  cliente: "Cliente",
  locacao: "Locação futura",
  manutencao: "Manutenção",
  transferencia_operacional: "Transferência operacional",
  outro: "Outro",
};

export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = {
  aberta: "Em custódia",
  parcial: "Retorno parcial",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export function normalizeCustodyScan(value: string): string {
  return value.replace(/[\r\n\t]+/g, "").trim();
}

export function custodyIdentifierCandidates(
  material: CustodyMaterialSearchResult,
): string[] {
  return [
    material.id,
    material.identificador_unico,
    material.conteudo_qr_code,
    material.codigo_barras,
    material.codigo_interno,
    material.numero_patrimonio,
    material.numero_serie,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLocaleLowerCase("pt-BR"));
}

export function materialMatchesCustodyIdentifier(
  material: CustodyMaterialSearchResult,
  input: string,
): boolean {
  const normalized = normalizeCustodyScan(input).toLocaleLowerCase("pt-BR");
  if (!normalized) return false;
  const candidates = custodyIdentifierCandidates(material);
  if (candidates.includes(normalized)) return true;
  if (normalized.startsWith(MATERIAL_QR_PREFIX.toLocaleLowerCase("pt-BR"))) {
    return candidates.includes(normalized.slice(MATERIAL_QR_PREFIX.length));
  }
  return material.nome.toLocaleLowerCase("pt-BR").includes(normalized);
}

export function getCustodyMaterialActions(
  material: CustodyMaterialSearchResult,
) {
  const available = material.saldos.reduce(
    (total, balance) => total + (balance.localizacao_ativa ? balance.quantidade : 0),
    0,
  );
  const pending = material.custodias_abertas.reduce(
    (total, custody) => total + custody.quantidade_pendente,
    0,
  );
  const operational = material.ativo && material.status_operacional === "disponivel";
  return {
    available,
    pending,
    canCheckout: operational && available > 0,
    canCheckin: pending > 0,
  };
}

export function deriveCustodyStatus(
  checkedOut: number,
  returned: number,
): Extract<CustodyStatus, "aberta" | "parcial" | "concluida"> {
  if (returned <= 0) return "aberta";
  if (returned < checkedOut) return "parcial";
  return "concluida";
}

export function validateCheckout(
  input: CheckoutInput,
  material: CustodyMaterialSearchResult,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const selectedBalance = material.saldos.find(
    (balance) => balance.localizacao_id === input.originLocationId,
  );
  if (!material.ativo || material.status_operacional !== "disponivel") {
    errors.materialId = "O material não está operacionalmente disponível.";
  }
  if (!input.originLocationId) errors.originLocationId = "Selecione a origem.";
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    errors.quantity = "Informe uma quantidade inteira maior que zero.";
  } else if (material.tipo_controle === "individual" && input.quantity !== 1) {
    errors.quantity = "Material individual deve sair com quantidade um.";
  } else if (!selectedBalance || input.quantity > selectedBalance.quantidade) {
    errors.quantity = "A quantidade supera o saldo disponível na origem.";
  }
  if (!selectedBalance?.localizacao_ativa) {
    errors.originLocationId = "A localização de origem está inativa.";
  }
  if (!input.responsibleId) errors.responsibleId = "Selecione o responsável.";
  if (!input.purpose) errors.purpose = "Selecione a finalidade.";
  if (!input.condition) errors.condition = "Informe a condição de saída.";
  if (
    input.expectedReturn &&
    input.effectiveAt &&
    new Date(input.expectedReturn) < new Date(input.effectiveAt)
  ) {
    errors.expectedReturn = "A previsão deve ser posterior à retirada.";
  }
  return errors;
}

export function validateCheckin(
  input: CheckinInput,
  pendingQuantity: number,
  individual: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.custodyId) errors.custodyId = "Operação de custódia inválida.";
  if (!input.destinationLocationId) {
    errors.destinationLocationId = "Selecione a localização de retorno.";
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    errors.quantity = "Informe uma quantidade inteira maior que zero.";
  } else if (input.quantity > pendingQuantity) {
    errors.quantity = "A devolução supera a quantidade pendente.";
  } else if (individual && input.quantity !== 1) {
    errors.quantity = "Material individual deve retornar com quantidade um.";
  }
  if (!input.returnCondition) {
    errors.returnCondition = "Informe a condição no retorno.";
  }
  return errors;
}
