import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { removeEventFile } from "./event-file-service";
import type { AppRole } from "./user-role";

export type EventDayDraft = Pick<
  Tables<"event_days">,
  "day_number" | "date" | "artist" | "show_time" | "observations"
> & { id?: string };

export type ExistingEventDay = Pick<
  Tables<"event_days">,
  "id" | "day_number" | "date" | "artist" | "show_time" | "observations"
>;

export interface EventDayReconciliationPlan {
  updates: Array<{ index: number; id: string; day: EventDayDraft }>;
  inserts: Array<{ index: number; day: EventDayDraft }>;
  removals: ExistingEventDay[];
}

export function planEventDayReconciliation(
  existingDays: readonly ExistingEventDay[],
  desiredDays: readonly EventDayDraft[],
): EventDayReconciliationPlan {
  const existingById = new Map(existingDays.map((day) => [day.id, day]));
  const retainedIds = new Set<string>();
  const updates: EventDayReconciliationPlan["updates"] = [];
  const inserts: EventDayReconciliationPlan["inserts"] = [];

  desiredDays.forEach((day, index) => {
    if (!day.id) {
      inserts.push({ index, day });
      return;
    }

    if (!existingById.has(day.id)) {
      throw new Error("Dia existente não pertence ao evento em edição");
    }
    if (retainedIds.has(day.id)) {
      throw new Error("O mesmo dia do evento foi enviado mais de uma vez");
    }

    retainedIds.add(day.id);
    updates.push({ index, id: day.id, day });
  });

  return {
    updates,
    inserts,
    removals: existingDays.filter((day) => !retainedIds.has(day.id)),
  };
}

function dayPayload({ id: _id, ...day }: EventDayDraft, eventId: string, empresaId: string) {
  return {
    event_id: eventId,
    empresa_id: empresaId,
    day_number: day.day_number,
    date: day.date || null,
    artist: day.artist || "",
    show_time: day.show_time || null,
    observations: day.observations || null,
  };
}

export async function reconcileEventDays({
  eventId,
  empresaId,
  existingDays,
  desiredDays,
  role,
  confirmLinkedFileRemoval,
}: {
  eventId: string;
  empresaId: string;
  existingDays: readonly ExistingEventDay[];
  desiredDays: readonly EventDayDraft[];
  role: AppRole | null;
  confirmLinkedFileRemoval?: (
    linkedFileCount: number,
    removedDayCount: number,
  ) => boolean | Promise<boolean>;
}): Promise<Array<{ id: string }>> {
  const plan = planEventDayReconciliation(existingDays, desiredDays);
  const removedIds = plan.removals.map((day) => day.id);

  let linkedFiles: Array<Pick<Tables<"event_files">, "id" | "file_path">> = [];
  if (removedIds.length > 0) {
    const { data, error } = await supabase
      .from("event_files")
      .select("id, file_path")
      .eq("event_id", eventId)
      .in("event_day_id", removedIds);
    if (error) throw error;
    linkedFiles = data ?? [];

    if (linkedFiles.length > 0) {
      const confirmed = await confirmLinkedFileRemoval?.(
        linkedFiles.length,
        removedIds.length,
      );
      if (!confirmed) {
        throw new Error(
          "Remoção cancelada: há riders vinculados aos dias removidos.",
        );
      }
    }
  }

  const persisted = new Array<{ id: string }>(desiredDays.length);

  for (const update of plan.updates) {
    const { data, error } = await supabase
      .from("event_days")
      .update(dayPayload(update.day, eventId, empresaId))
      .eq("id", update.id)
      .eq("event_id", eventId)
      .select("id")
      .single();
    if (error) throw error;
    persisted[update.index] = data;
  }

  for (const insertion of plan.inserts) {
    const { data, error } = await supabase
      .from("event_days")
      .insert(dayPayload(insertion.day, eventId, empresaId))
      .select("id")
      .single();
    if (error) throw error;
    persisted[insertion.index] = data;
  }

  // The FK cascades metadata deletion, but not the private Storage object.
  // Remove both explicitly after confirmation so rider loss is intentional
  // and physical objects are not silently orphaned.
  for (const file of linkedFiles) {
    await removeEventFile({
      eventId,
      fileId: file.id,
      filePath: file.file_path,
      role,
    });
  }

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("event_days")
      .delete()
      .eq("event_id", eventId)
      .in("id", removedIds);
    if (error) throw error;
  }

  return persisted;
}
