// ============================================================================
// Importador da agenda do Gestão de Eventos Pro -> Backstage Pro
// ============================================================================
//
// Este módulo lê o arquivo JSON exportado pela origem, valida-o e produz uma
// PRÉVIA normalizada para conferência. A gravação em si é uma RPC transacional
// (importar_agenda_eventos) chamada pelo serviço; ver
// src/lib/agenda-import-service.ts e a migration 20260827110000/20260827120000.
//
// Tudo aqui são funções PURAS e testáveis - nenhuma dependência de React,
// Supabase, rede ou DOM. O parsing/validação, a normalização/mapeamento e a
// UI do diálogo ficam em arquivos separados (ver
// src/components/agenda/ImportAgendaDialog.tsx).
//
// Mapeamento de campos (origem -> destino Backstage.events). Desde a migration
// 20260827120000 cada informação tem a SUA coluna própria (editável depois):
//   name                -> name              (obrigatório)
//   date                -> date              (obrigatório, YYYY-MM-DD)
//   artist/city/venue   -> idem (podem ser null; nunca vira placeholder)
//   state               -> state             (UF; coluna própria)
//   status              -> status (Confirmado/Pendente/Cancelado ->
//                          confirmado/pendente/cancelado; outro valor = inválido)
//   show_time           -> show_time (PostgreSQL time; "HH:MM" -> "HH:MM:00")
//   setup_time          -> setup_time        (texto livre; coluna própria)
//   staff_notes         -> staff_notes       (coluna própria)
//   contratante_*       -> contratante_nome/cidade/telefone (colunas próprias)
//   departure_date/time -> logistics_departure (timestamptz "ingênuo"
//                          YYYY-MM-DDTHH:MM:SS quando há data+hora; regra igual
//                          à do EventForm). Só-data fica numa linha de
//                          observations (único dado sem coluna equivalente).
//   notes               -> observations      (SOMENTE a observação geral)
//   source_event_id     -> event_import_origins (rastreabilidade/dedupe)

export const AGENDA_IMPORT_FORMAT = "gestao-eventos-backstage";
export const AGENDA_IMPORT_VERSION = 1;
export const AGENDA_IMPORT_COMPATIBLE_SOURCES = ["Gestão de Eventos Pro"] as const;

/**
 * `source` legível do arquivo -> `source_system` interno (genérico, estável,
 * pensado para a rastreabilidade bidirecional futura: 'gestao_eventos_pro',
 * 'backstage_pro', …). É a chave de deduplicação junto com source_event_id.
 */
const SOURCE_SYSTEM_BY_SOURCE: Record<string, string> = {
  "Gestão de Eventos Pro": "gestao_eventos_pro",
};

export function resolveSourceSystem(source: string): string | null {
  return SOURCE_SYSTEM_BY_SOURCE[source.trim()] ?? null;
}

export type ImportEventStatus = "confirmado" | "pendente" | "cancelado";

const STATUS_MAP: Record<string, ImportEventStatus> = {
  Confirmado: "confirmado",
  Pendente: "pendente",
  Cancelado: "cancelado",
};

// ----------------------------------------------------------------------------
// Tipos da prévia
// ----------------------------------------------------------------------------

export type LogisticsDepartureKind = "none" | "date_and_time" | "date_only" | "time_only";

export interface LogisticsDeparturePreview {
  kind: LogisticsDepartureKind;
  /** YYYY-MM-DD ou null */
  departureDate: string | null;
  /** HH:MM:SS normalizado ou null */
  departureTime: string | null;
  /** texto legível para a prévia (null quando kind === "none") */
  display: string | null;
  /**
   * Valor "ingênuo" (sem fuso) para events.logistics_departure quando há data
   * E hora: "YYYY-MM-DDTHH:MM:SS". Mesma forma que o EventForm manda do input
   * datetime-local. null nos demais casos.
   */
  timestampValue: string | null;
  /**
   * Linha a preservar em events.observations SOMENTE no caso 'date_only' (data
   * sem hora) - único dado de saída sem coluna própria.
   * "Saída logística prevista: 28/08/2026" | null.
   */
  observationsLine: string | null;
  /** aviso quando a combinação está incompleta/inconsistente */
  warning: string | null;
}

export interface NormalizedImportEvent {
  /** índice do evento no array original (0-based) - só para referência na UI */
  index: number;
  sourceEventId: string | null;
  name: string | null;
  date: string | null;
  artist: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  /** "HH:MM:SS" normalizado, ou null */
  showTime: string | null;
  /** texto livre da origem, preservado como veio (entra em observations) */
  setupTime: string | null;
  /** null quando o status recebido é desconhecido */
  status: ImportEventStatus | null;
  /** valor cru do status recebido (para exibir quando inválido) */
  statusReceived: string | null;
  notes: string | null;
  staffNotes: string | null;
  contratanteNome: string | null;
  contratanteCidade: string | null;
  contratanteTelefone: string | null;
  logisticsDeparture: LogisticsDeparturePreview;
  /** "Cidade - UF" quando ambos existem; senão a cidade; senão null */
  cityStateLabel: string | null;
  /** proposta de observations para o Backstage (string pronta) */
  observationsProposal: string;
  valid: boolean;
  errors: string[];
  /** avisos que não invalidam o evento */
  warnings: string[];
}

export interface AgendaImportSummary {
  source: string;
  /** source_system interno resolvido (ex.: "gestao_eventos_pro") */
  sourceSystem: string;
  exportedAt: string | null;
  periodStart: string;
  periodEnd: string;
  totalCount: number;
  validCount: number;
  invalidCount: number;
}

/** Forma enviada à RPC `importar_agenda_eventos` (1 item do array jsonb). */
export interface ImportPayloadEvent {
  source_event_id: string;
  name: string;
  date: string;
  artist: string | null;
  /** SOMENTE a cidade; a UF vai em `state`. */
  city: string | null;
  venue: string | null;
  show_time: string | null;
  status: ImportEventStatus;
  /** campos com coluna própria em events (migration 20260827120000) */
  state: string | null;
  setup_time: string | null;
  staff_notes: string | null;
  contratante_nome: string | null;
  contratante_cidade: string | null;
  contratante_telefone: string | null;
  /** "YYYY-MM-DDTHH:MM:SS" (data+hora de saída) ou null */
  logistics_departure: string | null;
  /** só a observação geral (`notes`), + a exceção da saída só-data */
  observations: string | null;
}

export interface AgendaImportPreview {
  summary: AgendaImportSummary;
  events: NormalizedImportEvent[];
}

export interface AgendaImportParseSuccess {
  ok: true;
  preview: AgendaImportPreview;
}

export interface AgendaImportParseFailure {
  ok: false;
  error: string;
}

export type AgendaImportParseResult = AgendaImportParseSuccess | AgendaImportParseFailure;

// ----------------------------------------------------------------------------
// Helpers puros (exportados para teste)
// ----------------------------------------------------------------------------

/** null / undefined / ausente / "" / só espaços -> null; senão trim. */
export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Aceita YYYY-MM-DD que também seja uma data de calendário real. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Sem timezone: compara componentes locais.
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

export type NormalizedStatus =
  | { value: ImportEventStatus }
  | { invalid: true; received: string };

export function normalizeImportStatus(value: unknown): NormalizedStatus {
  const raw = typeof value === "string" ? value.trim() : "";
  const mapped = STATUS_MAP[raw];
  if (mapped) return { value: mapped };
  return { invalid: true, received: raw === "" ? "(ausente)" : raw };
}

export type NormalizedTime =
  | { value: string | null }
  | { invalid: true; received: string };

/**
 * PostgreSQL `time`:
 *   null / "" -> null
 *   "HH:MM" válido -> "HH:MM:00"
 *   "HH:MM:SS" válido -> preservado
 *   qualquer outra coisa -> inválido
 * Nunca converte timezone.
 */
export function normalizeShowTime(value: unknown): NormalizedTime {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== "string") return { invalid: true, received: String(value) };
  const raw = value.trim();
  if (raw === "") return { value: null };

  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return { invalid: true, received: raw };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return { invalid: true, received: raw };

  const hh = match[1];
  const mm = match[2];
  const ss = match[3] ?? "00";
  return { value: `${hh}:${mm}:${ss}` };
}

/** "Cidade - UF" quando ambos; senão só a cidade; senão null. */
export function formatCityState(city: string | null, state: string | null): string | null {
  if (city && state) return `${city} - ${state}`;
  return city ?? null;
}

interface DepartureInput {
  departureDate: string | null;
  departureTimeRaw: unknown;
}

/**
 * Descreve a saída logística da origem. Para 'date_and_time' produz o valor
 * "ingênuo" YYYY-MM-DDTHH:MM:SS que vai direto para events.logistics_departure
 * (mesma regra do EventForm - ver auditoria no relatório). 'date_only'
 * preserva a data numa linha de observations (único caso sem coluna).
 */
export function describeLogisticsDeparture({
  departureDate,
  departureTimeRaw,
}: DepartureInput): LogisticsDeparturePreview {
  const hasDate = departureDate !== null && isIsoDate(departureDate);
  const dateInvalid = departureDate !== null && !hasDate;

  const time = normalizeShowTime(departureTimeRaw);
  const timeValue = "value" in time ? time.value : null;
  const timeInvalid = "invalid" in time;

  const displayDate = hasDate ? formatIsoDateBr(departureDate as string) : null;
  const displayTime = timeValue ? timeValue.slice(0, 5) : null;

  if (dateInvalid) {
    return {
      kind: "none",
      departureDate: null,
      departureTime: null,
      display: null,
      timestampValue: null,
      observationsLine: null,
      warning: `Data de saída em formato inválido: "${departureDate}"`,
    };
  }

  if (hasDate && timeValue) {
    return {
      kind: "date_and_time",
      departureDate,
      departureTime: timeValue,
      display: `${displayDate} às ${displayTime}`,
      timestampValue: `${departureDate}T${timeValue}`,
      observationsLine: null,
      warning: null,
    };
  }

  if (hasDate && !timeValue) {
    return {
      kind: "date_only",
      departureDate,
      departureTime: null,
      display: displayDate,
      timestampValue: null,
      observationsLine: `Saída logística prevista: ${displayDate}`,
      warning: timeInvalid
        ? `Horário de saída em formato inválido ("${(time as { received: string }).received}") - ignorado`
        : "Sem horário de saída informado",
    };
  }

  if (!hasDate && timeValue) {
    return {
      kind: "time_only",
      departureDate: null,
      departureTime: timeValue,
      display: null,
      timestampValue: null,
      observationsLine: null,
      warning: `Horário de saída (${displayTime}) sem data - inconsistente, será ignorado`,
    };
  }

  return {
    kind: "none",
    departureDate: null,
    departureTime: null,
    display: null,
    timestampValue: null,
    observationsLine: null,
    warning: null,
  };
}

/**
 * `events.observations` da importação = SOMENTE a observação geral (`notes`).
 * setup_time / staff_notes / state / contratante_* têm colunas próprias agora
 * (migration 20260827120000) e são mapeados direto - nunca copiados aqui.
 *
 * `extraLines` cobre o único dado sem coluna equivalente: uma saída logística
 * que veio só com data (sem hora), preservada como uma linha ao final.
 */
export function buildImportObservations(notes: string | null, extraLines: string[] = []): string {
  const seen = new Set<string>();
  const keyOf = (value: string) => value.trim().toLowerCase();
  const parts: string[] = [];

  if (notes) {
    parts.push(notes);
    seen.add(keyOf(notes));
  }

  const extras = extraLines
    .map((line) => line.trim())
    .filter((line) => line !== "" && !seen.has(keyOf(line)));
  if (extras.length > 0) parts.push(extras.join("\n"));

  return parts.join("\n\n").trim();
}

/** Bytes -> "1,2 KB" etc. (pt-BR). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${units[unitIndex]}`;
}

function formatIsoDateBr(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

// ----------------------------------------------------------------------------
// Validação do envelope + normalização por evento
// ----------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valida um evento cru e devolve a forma normalizada da prévia. */
export function normalizeImportEvent(raw: unknown, index: number): NormalizedImportEvent {
  const errors: string[] = [];
  const warnings: string[] = [];
  const source = isPlainObject(raw) ? raw : {};

  const sourceEventId = normalizeOptionalText(source.source_event_id);
  const name = normalizeOptionalText(source.name);
  const dateRaw = normalizeOptionalText(source.date);

  if (!sourceEventId) errors.push("source_event_id ausente ou vazio");
  if (!name) errors.push("name ausente ou vazio");

  let date: string | null = null;
  if (!dateRaw) {
    errors.push("date ausente");
  } else if (!isIsoDate(dateRaw)) {
    errors.push(`date inválida (esperado YYYY-MM-DD): "${dateRaw}"`);
  } else {
    date = dateRaw;
  }

  const artist = normalizeOptionalText(source.artist);
  const city = normalizeOptionalText(source.city);
  const state = normalizeOptionalText(source.state);
  const venue = normalizeOptionalText(source.venue);
  const setupTime = normalizeOptionalText(source.setup_time);
  const notes = normalizeOptionalText(source.notes);
  const staffNotes = normalizeOptionalText(source.staff_notes);
  const contratanteNome = normalizeOptionalText(source.contratante_nome);
  const contratanteCidade = normalizeOptionalText(source.contratante_cidade);
  const contratanteTelefone = normalizeOptionalText(source.contratante_telefone);

  const status = normalizeImportStatus(source.status);
  let statusValue: ImportEventStatus | null = null;
  let statusReceived: string | null = null;
  if ("value" in status) {
    statusValue = status.value;
  } else {
    statusReceived = status.received;
    errors.push(`status desconhecido: "${status.received}" (esperado Confirmado, Pendente ou Cancelado)`);
  }

  const showTime = normalizeShowTime(source.show_time);
  let showTimeValue: string | null = null;
  if ("value" in showTime) {
    showTimeValue = showTime.value;
  } else {
    errors.push(`show_time em formato inválido: "${showTime.received}" (esperado HH:MM ou HH:MM:SS)`);
  }

  const departureDate = normalizeOptionalText(source.departure_date);
  const logisticsDeparture = describeLogisticsDeparture({
    departureDate,
    departureTimeRaw: source.departure_time,
  });
  if (logisticsDeparture.warning) warnings.push(logisticsDeparture.warning);

  const observationsProposal = buildImportObservations(
    notes,
    logisticsDeparture.observationsLine ? [logisticsDeparture.observationsLine] : [],
  );

  return {
    index,
    sourceEventId,
    name,
    date,
    artist,
    city,
    state,
    venue,
    showTime: showTimeValue,
    setupTime,
    status: statusValue,
    statusReceived,
    notes,
    staffNotes,
    contratanteNome,
    contratanteCidade,
    contratanteTelefone,
    logisticsDeparture,
    cityStateLabel: formatCityState(city, state),
    observationsProposal,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Ponto de entrada: recebe o CONTEÚDO do arquivo (texto) e devolve a prévia
 * ou um erro claro. Nunca lança.
 */
export function parseAgendaImportContent(rawContent: string): AgendaImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, error: "O arquivo não contém um JSON válido." };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "Estrutura inválida: a raiz do arquivo deveria ser um objeto." };
  }

  if (parsed.format !== AGENDA_IMPORT_FORMAT) {
    return {
      ok: false,
      error: `Formato de arquivo não reconhecido. Esperado "${AGENDA_IMPORT_FORMAT}", recebido ${JSON.stringify(parsed.format ?? null)}.`,
    };
  }

  if (parsed.version !== AGENDA_IMPORT_VERSION) {
    return {
      ok: false,
      error: `Versão de formato incompatível. Esperado ${AGENDA_IMPORT_VERSION}, recebido ${JSON.stringify(parsed.version ?? null)}.`,
    };
  }

  const source = typeof parsed.source === "string" ? parsed.source.trim() : "";
  if (!(AGENDA_IMPORT_COMPATIBLE_SOURCES as readonly string[]).includes(source)) {
    return {
      ok: false,
      error: `Origem não compatível. Esperado "${AGENDA_IMPORT_COMPATIBLE_SOURCES.join('" ou "')}", recebido ${JSON.stringify(parsed.source ?? null)}.`,
    };
  }

  const period = parsed.period;
  if (!isPlainObject(period) || !isIsoDate(period.start) || !isIsoDate(period.end)) {
    return {
      ok: false,
      error: "Período do export inválido: 'period.start' e 'period.end' precisam ser datas YYYY-MM-DD.",
    };
  }

  if (typeof parsed.event_count !== "number" || !Number.isInteger(parsed.event_count) || parsed.event_count < 0) {
    return { ok: false, error: "'event_count' precisa ser um número inteiro não negativo." };
  }

  if (!Array.isArray(parsed.events)) {
    return { ok: false, error: "'events' precisa ser uma lista." };
  }

  if (parsed.event_count !== parsed.events.length) {
    return {
      ok: false,
      error: `Contagem inconsistente: 'event_count' é ${parsed.event_count} mas a lista tem ${parsed.events.length} evento(s).`,
    };
  }

  const events = parsed.events.map((rawEvent, index) => normalizeImportEvent(rawEvent, index));
  const validCount = events.filter((event) => event.valid).length;

  return {
    ok: true,
    preview: {
      summary: {
        source,
        // `source` já foi validado contra AGENDA_IMPORT_COMPATIBLE_SOURCES acima,
        // então resolveSourceSystem nunca é null aqui.
        sourceSystem: resolveSourceSystem(source) ?? "",
        exportedAt: normalizeOptionalText(parsed.exported_at),
        periodStart: period.start,
        periodEnd: period.end,
        totalCount: events.length,
        validCount,
        invalidCount: events.length - validCount,
      },
      events,
    },
  };
}

// ----------------------------------------------------------------------------
// Mapeamento para a RPC de importação (só eventos VÁLIDOS)
// ----------------------------------------------------------------------------

/**
 * Converte um evento normalizado (que precisa estar `valid`) no item enviado à
 * RPC `importar_agenda_eventos`. Mapeamento direto para colunas próprias:
 *  - name/date obrigatórios;
 *  - artist/city/venue/show_time/state/setup_time/staff_notes/contratante_*:
 *    valor ou null (nunca placeholder; "" -> null pelo normalizeOptionalText);
 *  - `city` recebe SOMENTE a cidade; a UF vai em `state`;
 *  - status já convertido (confirmado/pendente/cancelado);
 *  - logistics_departure: "YYYY-MM-DDTHH:MM:SS" quando há data+hora de saída,
 *    senão null (regra igual à do EventForm - ver relatório);
 *  - observations = só a observação geral (`notes`), + a linha da saída
 *    só-data quando aplicável; "" -> null.
 * num_days e event_days (Dia 1) são responsabilidade da RPC.
 */
export function toImportPayloadEvent(event: NormalizedImportEvent): ImportPayloadEvent {
  if (!event.valid || !event.sourceEventId || !event.name || !event.date || !event.status) {
    throw new Error("toImportPayloadEvent só aceita eventos válidos.");
  }
  return {
    source_event_id: event.sourceEventId,
    name: event.name,
    date: event.date,
    artist: event.artist,
    city: event.city,
    venue: event.venue,
    show_time: event.showTime,
    status: event.status,
    state: event.state,
    setup_time: event.setupTime,
    staff_notes: event.staffNotes,
    contratante_nome: event.contratanteNome,
    contratante_cidade: event.contratanteCidade,
    contratante_telefone: event.contratanteTelefone,
    logistics_departure: event.logisticsDeparture.timestampValue,
    observations: event.observationsProposal === "" ? null : event.observationsProposal,
  };
}
