import {
  translateSupabaseError,
  type SafeSupabaseError,
} from "./supabase-error";

export const STOCK_ERROR_MESSAGES = {
  ST001: "Saldo insuficiente na localização de origem.",
  ST002: "Um material individual só pode ter saldo total zero ou um.",
  ST003: "O item individual já está armazenado em outra localização.",
  ST004: "Revise os dados informados para a movimentação.",
  ST005: "Material ou localização não encontrado.",
  ST006: "Localização inativa não pode receber materiais.",
  ST007: "Origem e destino devem ser diferentes.",
  ST008: "Material inativo não pode receber novas movimentações.",
  ST009: "O módulo Controle de Estoque não está ativo para esta empresa.",
  ST010: "A empresa está em modo somente leitura.",
  ST011: "Você não tem permissão para esta operação.",
  ST012: "O saldo inicial deste material já foi registrado.",
  ST013: "Esta operação já foi enviada com dados diferentes.",
  ST014: "Esta movimentação já foi estornada.",
  ST015: "A movimentação não pode ser estornada.",
  ST016: "A hierarquia de localizações não pode conter ciclos.",
  ST017: "Localização em uso não pode ser excluída; inative-a.",
  ST018: "O saldo só pode ser alterado por uma movimentação de estoque.",
  ST019: "O histórico de estoque é imutável.",
  ST020: "Foi detectada divergência no saldo. Contate o suporte.",
  "42501": "Você não tem permissão para esta operação.",
} as const;

export const STOCK_UNIQUE_CONSTRAINT_MESSAGES = {
  estoque_localizacoes_empresa_codigo_uidx:
    "Já existe uma localização com este código nesta empresa.",
  estoque_localizacoes_empresa_nome_uidx:
    "Já existe uma localização com este nome nesta empresa.",
  estoque_movimentacoes_empresa_client_unique:
    "Esta operação já foi processada.",
  estoque_movimentacoes_initial_balance_uidx:
    "O saldo inicial deste material já foi registrado.",
  estoque_movimentacoes_original_estorno_uidx:
    "Esta movimentação já foi estornada.",
} as const;

export function translateStockError(
  error: unknown,
  fallbackMessage =
    "Não foi possível concluir a operação de estoque. Tente novamente.",
): SafeSupabaseError {
  return translateSupabaseError(error, {
    codeMessages: STOCK_ERROR_MESSAGES,
    uniqueConstraintMessages: STOCK_UNIQUE_CONSTRAINT_MESSAGES,
    fallbackMessage,
  });
}
