// Fixtures do importador da agenda (FASE 1). Mantidos como STRING para exercitar
// o parser exatamente como ele recebe o conteúdo de um arquivo real.

/**
 * Representa o arquivo real "agenda-backstage-2026-08-01-a-2026-08-28.json"
 * gerado pelo Gestão de Eventos Pro. O único evento tem:
 *  - venue vazio ("")
 *  - show_time null / setup_time null
 *  - departure_date preenchida + departure_time "12:00"
 *  - status "Confirmado"
 *  - contratante preenchido
 */
export const realExportFileJson = JSON.stringify(
  {
    format: "gestao-eventos-backstage",
    version: 1,
    source: "Gestão de Eventos Pro",
    exported_at: "2026-08-28T13:45:10.000Z",
    period: { start: "2026-08-01", end: "2026-08-28" },
    event_count: 1,
    events: [
      {
        source_event_id: "3f2a1c9e-6b04-4e77-9d21-0a1b2c3d4e5f",
        name: "Aniversário da Cidade",
        date: "2026-08-27",
        artist: "Banda Aurora",
        city: "Campina Grande",
        state: "PB",
        venue: "",
        show_time: null,
        setup_time: null,
        departure_date: "2026-08-28",
        departure_time: "12:00",
        status: "Confirmado",
        notes: "Portão de carga pelos fundos. Falar com o produtor local.",
        staff_notes: "Van sai do hotel às 10h.",
        contratante_nome: "Prefeitura Municipal / Produtora XYZ",
        contratante_cidade: "João Pessoa",
        contratante_telefone: "(83) 98888-7777",
      },
    ],
  },
  null,
  2,
);

interface BuildEventOverrides {
  [key: string]: unknown;
}

/** Um evento cru "completo e válido" com overrides opcionais. */
export function buildRawEvent(overrides: BuildEventOverrides = {}): Record<string, unknown> {
  return {
    source_event_id: "evt-1",
    name: "Show de Teste",
    date: "2026-09-10",
    artist: "Artista Teste",
    city: "Recife",
    state: "PE",
    venue: "Teatro Central",
    show_time: "21:00",
    setup_time: "15:00",
    departure_date: "2026-09-11",
    departure_time: "08:30",
    status: "Confirmado",
    notes: "Observação original do evento.",
    staff_notes: "Levar cabo XLR reserva.",
    contratante_nome: "Produtora ABC",
    contratante_cidade: "Olinda",
    contratante_telefone: "(81) 90000-0000",
    ...overrides,
  };
}

/** Envelope válido a partir de uma lista de eventos crus. */
export function buildExportFile(
  events: Array<Record<string, unknown>>,
  envelopeOverrides: BuildEventOverrides = {},
): string {
  return JSON.stringify({
    format: "gestao-eventos-backstage",
    version: 1,
    source: "Gestão de Eventos Pro",
    exported_at: "2026-08-28T10:00:00.000Z",
    period: { start: "2026-08-01", end: "2026-09-30" },
    event_count: events.length,
    events,
    ...envelopeOverrides,
  });
}
