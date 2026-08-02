import {
  translateSupabaseError,
  type SafeSupabaseError,
} from "./supabase-error";

export const CUSTODY_ERROR_MESSAGES = {
  CI001: "A quantidade devolvida supera a quantidade pendente.",
  CI002: "Material individual deve usar quantidade um.",
  CI004: "Revise os dados informados para a operação.",
  CI005: "Material, localização, responsável ou custódia não encontrado.",
  CI006: "A localização selecionada está inativa.",
  CI008: "O material está inativo ou indisponível para check-out.",
  CI009: "O módulo ou uma dependência não está ativo para esta empresa.",
  CI010: "A empresa está em modo somente leitura.",
  CI011: "Selecione a empresa antes de operar.",
  CI012: "Este material individual já possui check-out ativo.",
  CI013: "Esta operação já foi enviada com dados diferentes.",
  CI014: "A operação não possui quantidade pendente para retorno.",
  CI015: "Somente check-out sem devoluções pode ser cancelado.",
  CI019: "O histórico de custódia é imutável.",
  CI020: "O vínculo com o movimento de estoque é inválido.",
  ST001: "Saldo insuficiente na localização de origem.",
  ST006: "Localização inativa não pode receber materiais.",
  ST013: "A chave idempotente já foi usada com dados diferentes.",
  "42501": "Você não tem permissão para esta operação.",
} as const;

export function translateCustodyError(
  error: unknown,
  fallbackMessage = "Não foi possível concluir a operação de custódia.",
): SafeSupabaseError {
  return translateSupabaseError(error, {
    codeMessages: CUSTODY_ERROR_MESSAGES,
    uniqueConstraintMessages: {
      material_custodias_individual_active_uidx:
        "Este material individual já possui check-out ativo.",
      material_custodias_empresa_client_unique:
        "Este check-out já foi processado.",
      material_custodia_eventos_empresa_client_unique:
        "Este retorno ou cancelamento já foi processado.",
    },
    fallbackMessage,
  });
}
