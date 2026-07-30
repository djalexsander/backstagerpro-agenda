import { supabase } from "@/integrations/supabase/client";
import type {
  MaterialPhoto,
  MaterialPhotoWithUrl,
} from "./material-types";
import {
  buildMaterialPhotoPath,
  validateMaterialPhoto,
} from "./material-photo-security";

const MATERIAL_PHOTO_BUCKET = "material-photos";

export async function uploadMaterialPhoto({
  empresaId,
  materialId,
  file,
  main = false,
}: {
  empresaId: string;
  materialId: string;
  file: File;
  main?: boolean;
}): Promise<MaterialPhoto> {
  validateMaterialPhoto(file);
  const nonce = `${Date.now()}_${crypto.randomUUID().replace(/-/g, "")}`;
  const path = buildMaterialPhotoPath({
    empresaId,
    materialId,
    fileName: file.name,
    nonce,
  });

  const { error: uploadError } = await supabase.storage
    .from(MATERIAL_PHOTO_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error: metadataError } = await supabase
    .from("materiais_fotos")
    .insert({
      empresa_id: empresaId,
      material_id: materialId,
      storage_path: path,
      nome_arquivo: file.name,
      tipo_arquivo: file.type,
      tamanho_arquivo: file.size,
      foto_principal: main,
    })
    .select("*")
    .single();

  if (metadataError || !data) {
    await supabase.storage.from(MATERIAL_PHOTO_BUCKET).remove([path]);
    throw metadataError || new Error("Metadados da foto não foram criados");
  }

  return data;
}

export async function removeMaterialPhoto({
  empresaId,
  materialId,
  photoId,
  storagePath,
}: {
  empresaId: string;
  materialId: string;
  photoId: string;
  storagePath: string;
}): Promise<void> {
  const { data, error: metadataError } = await supabase
    .from("materiais_fotos")
    .delete()
    .eq("id", photoId)
    .eq("empresa_id", empresaId)
    .eq("material_id", materialId)
    .select("id")
    .maybeSingle();
  if (metadataError) throw metadataError;
  if (!data) throw new Error("Foto não encontrada");

  const { error: storageError } = await supabase.storage
    .from(MATERIAL_PHOTO_BUCKET)
    .remove([storagePath]);
  if (storageError) {
    console.warn("Unable to remove orphaned material photo:", storageError);
  }
}

export async function setMainMaterialPhoto({
  empresaId,
  materialId,
  photoId,
}: {
  empresaId: string;
  materialId: string;
  photoId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("materiais_fotos")
    .update({ foto_principal: true })
    .eq("id", photoId)
    .eq("empresa_id", empresaId)
    .eq("material_id", materialId);
  if (error) throw error;
}

export async function withMaterialPhotoUrls(
  photos: MaterialPhoto[],
): Promise<MaterialPhotoWithUrl[]> {
  return Promise.all(
    photos.map(async (photo) => {
      const { data, error } = await supabase.storage
        .from(MATERIAL_PHOTO_BUCKET)
        .createSignedUrl(photo.storage_path, 3600);
      if (error) return photo;
      return { ...photo, signedUrl: data.signedUrl };
    }),
  );
}

