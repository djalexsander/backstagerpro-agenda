import {
  translateSupabaseError,
  type SafeSupabaseError,
} from "./supabase-error";
import { CUSTODY_ERROR_MESSAGES } from "./checkin-checkout-errors";

// registrar_leitura_scanner_remoto delegates the actual custody movement to
// registrar_checkout_material/registrar_checkin_material (see
// supabase/migrations/20260818090000_scanner_remoto_realtime.sql), so their
// CI*/ST* codes can still surface from this module's RPCs unchanged -
// CUSTODY_ERROR_MESSAGES is reused rather than duplicated. SR* codes below
// are specific to the Scanner Remoto session layer itself (raised directly
// by iniciar_sessao_scanner_remoto/registrar_leitura_scanner_remoto/
// encerrar_sessao_scanner_remoto in that same migration).
export const SCANNER_REMOTO_ERROR_MESSAGES = {
  ...CUSTODY_ERROR_MESSAGES,
  SR001: "Sessão de scanner remoto não encontrada.",
  SR002: "Esta sessão de scanner remoto já foi encerrada.",
  SR003: "Revise os dados obrigatórios da sessão.",
  SR004: "Código lido ou identificador da operação inválido.",
} as const;

export function translateScannerRemotoError(
  error: unknown,
  fallbackMessage = "Não foi possível concluir a operação do scanner remoto.",
): SafeSupabaseError {
  return translateSupabaseError(error, {
    codeMessages: SCANNER_REMOTO_ERROR_MESSAGES,
    uniqueConstraintMessages: {
      scanner_remoto_sessoes_empresa_client_unique: "Esta sessão já foi iniciada.",
      scanner_remoto_leituras_empresa_client_unique: "Esta leitura já foi processada.",
      material_custodias_individual_active_uidx:
        "Este material individual já possui check-out ativo.",
      material_custodias_empresa_client_unique: "Este check-out já foi processado.",
      material_custodia_eventos_empresa_client_unique:
        "Este retorno já foi processado.",
    },
    fallbackMessage,
  });
}
