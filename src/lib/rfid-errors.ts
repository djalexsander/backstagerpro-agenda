import { translateSupabaseError, type SafeSupabaseError } from "./supabase-error";

// Códigos não definidos aqui - são levantados via `RAISE ... USING ERRCODE`
// pelas funções SQL criadas em
// supabase/migrations/20260814090000_rfid_uhf_foundation.sql
// (rfid_link_or_replace_tag, rfid_deactivate_tag, rfid_resolve_epcs,
// rfid_start_read_session, rfid_finish_read_session,
// rfid_list_material_tags). Se uma RPC passar a levantar um código novo,
// cai em `fallbackMessage` até a tradução ser adicionada aqui.
export const RFID_ERROR_MESSAGES = {
  RF001: "EPC inválido. Use de 8 a 64 caracteres hexadecimais.",
  RF002: "Somente materiais de controle individual podem receber tag RFID.",
  RF004: "Use vincular/trocar tag para reativar.",
  RF005: "Esta tag já está inativa.",
  RF006: "Tipo e identificador da referência devem ser informados juntos.",
  RF007: "Status final inválido.",
  RF008: "Esta sessão já foi encerrada.",
  "42501": "Você não tem permissão para esta operação.",
} as const;

export function translateRfidError(
  error: unknown,
  fallbackMessage = "Não foi possível concluir a operação de RFID.",
): SafeSupabaseError {
  return translateSupabaseError(error, {
    codeMessages: RFID_ERROR_MESSAGES,
    uniqueConstraintMessages: {
      rfid_tags_empresa_epc_ativa_uidx:
        "Esta tag já está vinculada a outro material ativo.",
      rfid_tags_material_ativa_uidx:
        "Este material já possui uma tag ativa.",
    },
    fallbackMessage,
  });
}
