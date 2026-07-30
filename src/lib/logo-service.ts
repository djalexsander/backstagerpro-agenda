import { supabase } from "@/integrations/supabase/client";
import {
  assertCanManageCompanyLogo,
  buildCompanyLogoPath,
  buildPlatformLogoPath,
  validateLogoFile,
} from "./logo-security";
import type { AppRole } from "./user-role";

const companyLogoExtensions = ["png", "jpg", "jpeg", "webp", "svg"] as const;

export async function uploadCompanyLogo({
  companyId,
  actorCompanyId,
  file,
  role,
}: {
  companyId: string;
  actorCompanyId: string | null;
  file: File;
  role: AppRole | null;
}): Promise<string> {
  assertCanManageCompanyLogo({
    role,
    actorCompanyId,
    targetCompanyId: companyId,
  });
  const mimeType = validateLogoFile(file);
  const path = buildCompanyLogoPath(companyId, mimeType);

  const { error } = await supabase.storage.from("logos").upload(path, file, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(`Erro ao fazer upload da logo: ${error.message}`);

  const { data } = supabase.storage.from("logos").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function removeCompanyLogo({
  companyId,
  actorCompanyId,
  role,
}: {
  companyId: string;
  actorCompanyId: string | null;
  role: AppRole | null;
}): Promise<void> {
  assertCanManageCompanyLogo({
    role,
    actorCompanyId,
    targetCompanyId: companyId,
  });
  const paths = companyLogoExtensions.map(
    (extension) => `${companyId}/logo.${extension}`,
  );
  const { error } = await supabase.storage.from("logos").remove(paths);
  if (error) throw error;
}

export async function uploadPlatformLogo({
  file,
  role,
}: {
  file: File;
  role: AppRole | null;
}): Promise<string> {
  if (role !== "master_admin") {
    throw new Error("Apenas o master pode alterar a logo da plataforma");
  }
  const mimeType = validateLogoFile(file);
  const path = buildPlatformLogoPath(mimeType);
  const { error } = await supabase.storage.from("logos").upload(path, file, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("logos").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
