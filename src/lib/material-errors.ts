import {
  translateSupabaseError,
  type SafeSupabaseError,
} from "./supabase-error";

export const MATERIAL_UNIQUE_CONSTRAINT_MESSAGES = {
  materiais_empresa_codigo_uidx:
    "Já existe um material com este código interno nesta empresa.",
  materiais_empresa_patrimonio_uidx:
    "Já existe um material com este número de patrimônio nesta empresa.",
  materiais_empresa_serie_uidx:
    "Já existe um material com este número de série nesta empresa.",
  materiais_empresa_codigo_barras_uidx:
    "Já existe um material com este código de barras nesta empresa.",
  categorias_materiais_empresa_nome_uidx:
    "Já existe uma categoria com este nome nesta empresa.",
} as const;

export function translateMaterialPersistenceError(
  error: unknown,
  fallbackMessage: string,
): SafeSupabaseError {
  return translateSupabaseError(error, {
    uniqueConstraintMessages: MATERIAL_UNIQUE_CONSTRAINT_MESSAGES,
    fallbackMessage,
  });
}

export class MaterialIdentificationPendingError extends Error {
  readonly materialId: string;
  readonly originalError: unknown;

  constructor(
    materialId: string,
    originalError: unknown,
    identification = "QR Code",
  ) {
    super(
      `O material foi salvo, mas o ${identification} não pôde ser gerado. A identificação ficou pendente e pode ser concluída nos detalhes.`,
    );
    this.name = "MaterialIdentificationPendingError";
    this.materialId = materialId;
    this.originalError = originalError;
  }
}
