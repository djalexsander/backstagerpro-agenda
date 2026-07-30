import { supabase } from "@/integrations/supabase/client";
import type {
  Material,
  MaterialCategory,
  MaterialFormValues,
  MaterialWithRelations,
} from "./material-types";
import { materialFormToPayload } from "./material-domain";
import {
  MaterialIdentificationPendingError,
  translateMaterialPersistenceError,
} from "./material-errors";

function throwPersistenceError(
  error: unknown,
  context: string,
  fallbackMessage: string,
): never {
  const translated = translateMaterialPersistenceError(error, fallbackMessage);

  if (!translated.handled) {
    console.error(`[material-service] ${context}`, error);
  }

  throw translated;
}

export async function listMaterialCategories(
  empresaId: string,
): Promise<MaterialCategory[]> {
  const { data, error } = await supabase
    .from("categorias_materiais")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true });
  if (error) throw error;
  return data;
}

export async function saveMaterialCategory({
  empresaId,
  id,
  nome,
  descricao,
}: {
  empresaId: string;
  id?: string;
  nome: string;
  descricao?: string;
}): Promise<void> {
  const payload = {
    empresa_id: empresaId,
    nome: nome.trim(),
    descricao: descricao?.trim() || null,
  };

  if (id) {
    const { error } = await supabase
      .from("categorias_materiais")
      .update(payload)
      .eq("id", id)
      .eq("empresa_id", empresaId);
    if (error) {
      throwPersistenceError(
        error,
        "Falha inesperada ao atualizar categoria",
        "Não foi possível atualizar a categoria. Tente novamente.",
      );
    }
    return;
  }

  const { error } = await supabase
    .from("categorias_materiais")
    .insert(payload);
  if (error) {
    throwPersistenceError(
      error,
      "Falha inesperada ao criar categoria",
      "Não foi possível criar a categoria. Tente novamente.",
    );
  }
}

export async function setMaterialCategoryActive({
  empresaId,
  id,
  active,
}: {
  empresaId: string;
  id: string;
  active: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from("categorias_materiais")
    .update({ ativo: active })
    .eq("id", id)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function deleteUnusedMaterialCategory({
  empresaId,
  id,
}: {
  empresaId: string;
  id: string;
}): Promise<void> {
  const { error } = await supabase
    .from("categorias_materiais")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function listMaterials(
  empresaId: string,
): Promise<MaterialWithRelations[]> {
  const { data, error } = await supabase
    .from("materiais")
    .select(
      `
        *,
        categoria:categorias_materiais(*),
        fotos:materiais_fotos(*)
      `,
    )
    .eq("empresa_id", empresaId)
    .order("nome", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((material) => ({
    ...material,
    categoria: material.categoria ?? null,
    fotos: [...(material.fotos ?? [])].sort((left, right) => {
      if (left.foto_principal !== right.foto_principal) {
        return left.foto_principal ? -1 : 1;
      }
      return left.created_at.localeCompare(right.created_at);
    }),
  })) as MaterialWithRelations[];
}

export async function saveMaterial({
  empresaId,
  values,
  id,
  generateQrCode,
}: {
  empresaId: string;
  values: MaterialFormValues;
  id?: string;
  generateQrCode?: boolean;
}): Promise<Material> {
  const payload = {
    empresa_id: empresaId,
    ...materialFormToPayload(values),
  };

  if (id) {
    const { empresa_id: _ignoredCompanyId, ...updatePayload } = payload;
    const { data, error } = await supabase
      .from("materiais")
      .update(updatePayload as never)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();
    if (error) {
      throwPersistenceError(
        error,
        "Falha inesperada ao atualizar material",
        "Não foi possível atualizar o material. Tente novamente.",
      );
    }
    return data;
  }

  const { data, error } = await supabase
    .from("materiais")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) {
    throwPersistenceError(
      error,
      "Falha inesperada ao criar material",
      "Não foi possível criar o material. Tente novamente.",
    );
  }
  const shouldGenerateQrCode =
    generateQrCode ?? values.tipo_identificacao !== "codigo_barras";
  if (!shouldGenerateQrCode) return data;

  try {
    const qrContent = await generateMaterialQrCode(data.id);
    return {
      ...data,
      conteudo_qr_code: qrContent,
      status_identificacao: "ativa",
      tipo_identificacao: data.codigo_barras ? "ambos" : "qr_code",
    };
  } catch (qrError) {
    // A tabela não concede DELETE ao cliente, portanto remover o registro
    // recém-criado não é uma compensação segura disponível. O trigger mantém
    // o QR nulo; o frontend recarrega e abre o material como "QR pendente",
    // sem apresentar a operação como integralmente concluída.
    throw new MaterialIdentificationPendingError(data.id, qrError);
  }
}

export async function setMaterialActive({
  empresaId,
  id,
  active,
}: {
  empresaId: string;
  id: string;
  active: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from("materiais")
    .update({ ativo: active })
    .eq("id", id)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function generateMaterialQrCode(
  materialId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("generate_material_qr_code", {
    _material_id: materialId,
  });
  if (error) {
    throwPersistenceError(
      error,
      "Falha inesperada ao gerar QR Code",
      "Não foi possível gerar o QR Code. Tente novamente.",
    );
  }
  return data;
}

export async function generateMaterialBarcode(
  materialId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("generate_material_barcode", {
    _material_id: materialId,
  });
  if (error) {
    throwPersistenceError(
      error,
      "Falha inesperada ao gerar código de barras",
      "Não foi possível gerar o código de barras. Tente novamente.",
    );
  }
  return data;
}
