import type { AppRole } from "./user-role";

export const EVENT_FILE_MAX_BYTES = 20 * 1024 * 1024;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventFileKind = "day" | "material" | "rider";

export function canReadEventFiles(
  role: AppRole | string | null | undefined,
): boolean {
  return (
    role === "usuario" ||
    role === "admin_empresa" ||
    role === "master_admin"
  );
}

export function canManageEventFiles(
  role: AppRole | string | null | undefined,
): boolean {
  return role === "admin_empresa" || role === "master_admin";
}

export function assertEventFileAdministrator(
  role: AppRole | string | null | undefined,
): void {
  if (!canManageEventFiles(role)) {
    throw new Error("Apenas administradores podem alterar arquivos de eventos");
  }
}

export function validateEventPdf(
  file: Pick<File, "name" | "size" | "type">,
): void {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("O arquivo do evento deve estar no formato PDF");
  }
  if (file.size <= 0) {
    throw new Error("O arquivo do evento está vazio");
  }
  if (file.size > EVENT_FILE_MAX_BYTES) {
    throw new Error("O arquivo do evento excede o limite de 20 MB");
  }
  if (file.type && file.type !== "application/pdf") {
    throw new Error("O tipo do arquivo do evento não é permitido");
  }
}

function safePdfName(fileName: string): string {
  const baseName = fileName
    .replace(/\.pdf$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 100);

  return `${baseName || "arquivo"}.pdf`;
}

export function buildEventFilePath({
  eventId,
  kind,
  fileName,
  eventDayId,
  timestamp = Date.now(),
}: {
  eventId: string;
  kind: EventFileKind;
  fileName: string;
  eventDayId?: string;
  timestamp?: number;
}): string {
  if (!uuidPattern.test(eventId)) {
    throw new Error("Evento inválido para upload");
  }
  if (kind === "day" && (!eventDayId || !uuidPattern.test(eventDayId))) {
    throw new Error("Dia do evento inválido para upload");
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Identificador temporal inválido");
  }

  const prefix = kind === "day" ? `day_${eventDayId}` : kind;
  return `${eventId}/${prefix}_${timestamp}_${safePdfName(fileName)}`;
}
