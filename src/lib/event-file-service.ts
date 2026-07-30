import { supabase } from "@/integrations/supabase/client";
import type {
  Database,
  Tables,
  TablesInsert,
} from "@/integrations/supabase/types";
import {
  assertEventFileAdministrator,
  buildEventFilePath,
  validateEventPdf,
  type EventFileKind,
} from "./event-file-security";
import type { AppRole } from "./user-role";

type EventFileType = Database["public"]["Enums"]["file_type"];
type ExistingEventFile = Pick<Tables<"event_files">, "id" | "file_path">;

export async function uploadEventFile({
  eventId,
  eventDayId,
  empresaId,
  file,
  fileType,
  kind,
  role,
  replacement,
}: {
  eventId: string;
  eventDayId?: string | null;
  empresaId: string;
  file: File;
  fileType: EventFileType;
  kind: EventFileKind;
  role: AppRole | null;
  replacement?: ExistingEventFile;
}): Promise<Tables<"event_files">> {
  assertEventFileAdministrator(role);
  validateEventPdf(file);

  const path = buildEventFilePath({
    eventId,
    eventDayId: eventDayId ?? undefined,
    kind,
    fileName: file.name,
  });
  const { error: uploadError } = await supabase.storage
    .from("event-files")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const metadata: TablesInsert<"event_files"> = {
    event_id: eventId,
    event_day_id: eventDayId ?? null,
    empresa_id: empresaId,
    file_type: fileType,
    file_path: path,
    file_name: file.name,
  };
  const { data: created, error: metadataError } = await supabase
    .from("event_files")
    .insert(metadata)
    .select("*")
    .single();

  if (metadataError || !created) {
    await supabase.storage.from("event-files").remove([path]);
    throw metadataError || new Error("Metadados do arquivo não foram criados");
  }

  if (replacement) {
    const { error: deleteMetadataError } = await supabase
      .from("event_files")
      .delete()
      .eq("id", replacement.id)
      .eq("event_id", eventId);
    if (deleteMetadataError) throw deleteMetadataError;

    const { error: deleteObjectError } = await supabase.storage
      .from("event-files")
      .remove([replacement.file_path]);
    if (deleteObjectError) {
      // The metadata is already gone, so the old object is no longer readable.
      console.warn("Unable to remove replaced event file object:", deleteObjectError);
    }
  }

  return created;
}

export async function removeEventFile({
  eventId,
  fileId,
  filePath,
  role,
}: {
  eventId: string;
  fileId: string;
  filePath: string;
  role: AppRole | null;
}): Promise<void> {
  assertEventFileAdministrator(role);

  // Removing metadata first makes the private object unreadable immediately,
  // even if physical cleanup in Storage later fails.
  const { data: deleted, error: metadataError } = await supabase
    .from("event_files")
    .delete()
    .eq("id", fileId)
    .eq("event_id", eventId)
    .select("id")
    .maybeSingle();
  if (metadataError) throw metadataError;
  if (!deleted) throw new Error("Arquivo do evento não encontrado");

  const { error: objectError } = await supabase.storage
    .from("event-files")
    .remove([filePath]);
  if (objectError) {
    // RLS reads require metadata, so this orphan cannot be downloaded.
    console.warn("Unable to remove event file object:", objectError);
  }
}
