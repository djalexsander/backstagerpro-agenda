import { describe, expect, it } from "vitest";
import {
  buildImportObservations,
  describeLogisticsDeparture,
  formatBytes,
  formatCityState,
  isIsoDate,
  normalizeImportEvent,
  normalizeImportStatus,
  normalizeOptionalText,
  normalizeShowTime,
  parseAgendaImportContent,
  resolveSourceSystem,
  toImportPayloadEvent,
  type AgendaImportPreview,
} from "./agenda-import";
import { buildExportFile, buildRawEvent, realExportFileJson } from "./agenda-import.fixtures";

function parseOk(json: string): AgendaImportPreview {
  const result = parseAgendaImportContent(json);
  if (result.ok === false) throw new Error(`esperava ok, veio erro: ${result.error}`);
  return result.preview;
}

describe("agenda-import - helpers", () => {
  it("normalizeOptionalText: null/ausente/vazio/espaços -> null; senão trim", () => {
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
    expect(normalizeOptionalText("")).toBeNull();
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(normalizeOptionalText(42)).toBeNull();
    expect(normalizeOptionalText("  Recife ")).toBe("Recife");
  });

  it("isIsoDate: aceita só YYYY-MM-DD de calendário real", () => {
    expect(isIsoDate("2026-08-27")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false); // 2026 não é bissexto
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("27/08/2026")).toBe(false);
    expect(isIsoDate("2026-8-7")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("formatCityState: 'Cidade - UF' quando ambos", () => {
    expect(formatCityState("Recife", "PE")).toBe("Recife - PE");
    expect(formatCityState("Recife", null)).toBe("Recife");
    expect(formatCityState(null, "PE")).toBeNull();
    expect(formatCityState(null, null)).toBeNull();
  });

  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2,0 KB");
    expect(formatBytes(1536 * 1024)).toBe("1,5 MB");
  });
});

describe("agenda-import - status (itens 14-17)", () => {
  it("Confirmado -> confirmado", () => {
    expect(normalizeImportStatus("Confirmado")).toEqual({ value: "confirmado" });
  });
  it("Pendente -> pendente", () => {
    expect(normalizeImportStatus("Pendente")).toEqual({ value: "pendente" });
  });
  it("Cancelado -> cancelado", () => {
    expect(normalizeImportStatus("Cancelado")).toEqual({ value: "cancelado" });
  });
  it("valor desconhecido -> inválido preservando o recebido", () => {
    expect(normalizeImportStatus("Adiado")).toEqual({ invalid: true, received: "Adiado" });
    expect(normalizeImportStatus("confirmado")).toEqual({ invalid: true, received: "confirmado" });
    expect(normalizeImportStatus(null)).toEqual({ invalid: true, received: "(ausente)" });
  });
});

describe("agenda-import - show_time (itens 18-20)", () => {
  it("null / '' -> null", () => {
    expect(normalizeShowTime(null)).toEqual({ value: null });
    expect(normalizeShowTime(undefined)).toEqual({ value: null });
    expect(normalizeShowTime("  ")).toEqual({ value: null });
  });
  it("HH:MM -> HH:MM:00", () => {
    expect(normalizeShowTime("21:00")).toEqual({ value: "21:00:00" });
    expect(normalizeShowTime("09:05")).toEqual({ value: "09:05:00" });
  });
  it("HH:MM:SS -> preservado", () => {
    expect(normalizeShowTime("21:00:30")).toEqual({ value: "21:00:30" });
  });
  it("formato inválido -> invalid", () => {
    expect(normalizeShowTime("21h")).toMatchObject({ invalid: true, received: "21h" });
    expect(normalizeShowTime("9:00")).toMatchObject({ invalid: true });
    expect(normalizeShowTime("25:00")).toMatchObject({ invalid: true });
    expect(normalizeShowTime("21:60")).toMatchObject({ invalid: true });
  });
});

describe("agenda-import - logistics_departure (itens 21-23 + timestamp ingênuo)", () => {
  it("data + hora -> date_and_time, timestampValue naive, sem linha em observations", () => {
    const preview = describeLogisticsDeparture({ departureDate: "2026-08-28", departureTimeRaw: "12:00" });
    expect(preview).toEqual({
      kind: "date_and_time",
      departureDate: "2026-08-28",
      departureTime: "12:00:00",
      display: "28/08/2026 às 12:00",
      timestampValue: "2026-08-28T12:00:00",
      observationsLine: null,
      warning: null,
    });
  });
  it("só data -> date_only: timestampValue null, linha para observations", () => {
    const preview = describeLogisticsDeparture({ departureDate: "2026-08-28", departureTimeRaw: null });
    expect(preview.kind).toBe("date_only");
    expect(preview.timestampValue).toBeNull();
    expect(preview.observationsLine).toBe("Saída logística prevista: 28/08/2026");
    expect(preview.warning).toMatch(/sem horário/i);
  });
  it("só hora (sem data) -> time_only, nada persistido, inconsistência", () => {
    const preview = describeLogisticsDeparture({ departureDate: null, departureTimeRaw: "12:00" });
    expect(preview.kind).toBe("time_only");
    expect(preview.timestampValue).toBeNull();
    expect(preview.observationsLine).toBeNull();
    expect(preview.warning).toMatch(/sem data|inconsist/i);
  });
  it("nada -> none", () => {
    expect(describeLogisticsDeparture({ departureDate: null, departureTimeRaw: null })).toMatchObject({
      kind: "none",
      timestampValue: null,
      observationsLine: null,
      warning: null,
    });
  });
});

describe("agenda-import - observations = só notes (item 13, 14)", () => {
  it("observations recebe só o notes original", () => {
    expect(buildImportObservations("Portão de carga pelos fundos.")).toBe("Portão de carga pelos fundos.");
  });
  it("sem notes e sem extras -> string vazia", () => {
    expect(buildImportObservations(null)).toBe("");
  });
  it("linha extra (saída só-data) é acrescentada após o notes, sem duplicar", () => {
    expect(buildImportObservations("Obs.", ["Saída logística prevista: 18/08/2026"])).toBe(
      "Obs.\n\nSaída logística prevista: 18/08/2026",
    );
    expect(buildImportObservations("Saída logística prevista: 18/08/2026", ["Saída logística prevista: 18/08/2026"])).toBe(
      "Saída logística prevista: 18/08/2026",
    );
  });
  it("nunca a palavra 'null', nunca linha em branco tripla", () => {
    const t = buildImportObservations("Nota geral.", ["Saída logística prevista: 18/08/2026"]);
    expect(t).not.toContain("null");
    expect(t).not.toMatch(/\n\n\n/);
  });
});

describe("agenda-import - envelope (itens 1-6, 27)", () => {
  it("1. JSON válido -> ok com resumo e eventos", () => {
    const preview = parseOk(buildExportFile([buildRawEvent()]));
    expect(preview.summary.totalCount).toBe(1);
    expect(preview.summary.validCount).toBe(1);
    expect(preview.summary.invalidCount).toBe(0);
    expect(preview.summary.source).toBe("Gestão de Eventos Pro");
    expect(preview.summary.periodStart).toBe("2026-08-01");
  });

  it("2. JSON inválido -> erro claro", () => {
    const result = parseAgendaImportContent("{ isso não é json }");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/json válido/i) });
  });

  it("2b. raiz não-objeto -> erro", () => {
    expect(parseAgendaImportContent("[]")).toMatchObject({ ok: false });
    expect(parseAgendaImportContent("42")).toMatchObject({ ok: false });
  });

  it("3. format incorreto -> erro", () => {
    const json = buildExportFile([buildRawEvent()], { format: "outro-formato" });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/formato/i) });
  });

  it("4. version incorreta -> erro", () => {
    const json = buildExportFile([buildRawEvent()], { version: 2 });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/vers[ãa]o/i) });
  });

  it("source incompatível -> erro", () => {
    const json = buildExportFile([buildRawEvent()], { source: "Outro Sistema" });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/origem/i) });
  });

  it("period inválido -> erro", () => {
    const json = buildExportFile([buildRawEvent()], { period: { start: "01/08/2026", end: "2026-08-28" } });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/per[íi]odo/i) });
  });

  it("5. event_count divergente -> erro", () => {
    const json = buildExportFile([buildRawEvent()], { event_count: 5 });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/contagem inconsistente/i) });
  });

  it("6. events não array -> erro", () => {
    const json = buildExportFile([], { events: "nope", event_count: 0 });
    expect(parseAgendaImportContent(json)).toEqual({ ok: false, error: expect.stringMatching(/'events'.*lista/i) });
  });

  it("27. event_count == events.length -> ok", () => {
    const preview = parseOk(buildExportFile([buildRawEvent({ source_event_id: "a" }), buildRawEvent({ source_event_id: "b" })]));
    expect(preview.summary.totalCount).toBe(2);
  });
});

describe("agenda-import - por evento (itens 3, 7-13, 17, 20)", () => {
  it("7. sem source_event_id -> inválido", () => {
    const e = normalizeImportEvent(buildRawEvent({ source_event_id: null }), 0);
    expect(e.valid).toBe(false);
    expect(e.errors.join(" ")).toMatch(/source_event_id/);
  });

  it("8. sem name -> inválido", () => {
    const e = normalizeImportEvent(buildRawEvent({ name: "  " }), 0);
    expect(e.valid).toBe(false);
    expect(e.errors.join(" ")).toMatch(/name/);
  });

  it("9. sem date -> inválido", () => {
    expect(normalizeImportEvent(buildRawEvent({ date: null }), 0).valid).toBe(false);
    expect(normalizeImportEvent(buildRawEvent({ date: "2026-99-99" }), 0).valid).toBe(false);
  });

  it("10-13. artist/city/venue null, '' ou ausentes -> null e evento válido", () => {
    const withNulls = normalizeImportEvent(buildRawEvent({ artist: null, city: "", venue: undefined }), 0);
    expect(withNulls.artist).toBeNull();
    expect(withNulls.city).toBeNull();
    expect(withNulls.venue).toBeNull();
    expect(withNulls.valid).toBe(true);

    const { artist: _a, city: _c, venue: _v, ...semCampos } = buildRawEvent();
    const missing = normalizeImportEvent(semCampos, 0);
    expect([missing.artist, missing.city, missing.venue]).toEqual([null, null, null]);
    expect(missing.valid).toBe(true);
  });

  it("14-16. status mapeado", () => {
    expect(normalizeImportEvent(buildRawEvent({ status: "Confirmado" }), 0).status).toBe("confirmado");
    expect(normalizeImportEvent(buildRawEvent({ status: "Pendente" }), 0).status).toBe("pendente");
    expect(normalizeImportEvent(buildRawEvent({ status: "Cancelado" }), 0).status).toBe("cancelado");
  });

  it("17. status desconhecido -> inválido, status null, valor recebido preservado", () => {
    const e = normalizeImportEvent(buildRawEvent({ status: "Adiado" }), 0);
    expect(e.valid).toBe(false);
    expect(e.status).toBeNull();
    expect(e.statusReceived).toBe("Adiado");
    expect(e.errors.join(" ")).toMatch(/Adiado/);
  });

  it("18-19. show_time HH:MM e HH:MM:SS", () => {
    expect(normalizeImportEvent(buildRawEvent({ show_time: "21:00" }), 0).showTime).toBe("21:00:00");
    expect(normalizeImportEvent(buildRawEvent({ show_time: "21:00:45" }), 0).showTime).toBe("21:00:45");
    expect(normalizeImportEvent(buildRawEvent({ show_time: null }), 0).showTime).toBeNull();
  });

  it("20. show_time inválido -> evento inválido", () => {
    const e = normalizeImportEvent(buildRawEvent({ show_time: "oito da noite" }), 0);
    expect(e.valid).toBe(false);
    expect(e.errors.join(" ")).toMatch(/show_time/);
  });

  it("21-23. departure na estrutura do evento", () => {
    expect(normalizeImportEvent(buildRawEvent({ departure_date: "2026-09-11", departure_time: "08:30" }), 0).logisticsDeparture.kind).toBe("date_and_time");
    expect(normalizeImportEvent(buildRawEvent({ departure_date: "2026-09-11", departure_time: null }), 0).logisticsDeparture.kind).toBe("date_only");
    expect(normalizeImportEvent(buildRawEvent({ departure_date: null, departure_time: "08:30" }), 0).logisticsDeparture.kind).toBe("time_only");
  });

  it("13/14. observations do evento normalizado = só notes (nunca cópia dos campos próprios)", () => {
    const e = normalizeImportEvent(
      buildRawEvent({
        notes: "Obs original.",
        setup_time: "15:00",
        staff_notes: "Instrução para equipe.",
        state: "PB",
        contratante_nome: "Produtora XYZ",
        contratante_cidade: "João Pessoa",
        contratante_telefone: "(83) 98888-7777",
        departure_date: "2026-09-11",
        departure_time: "08:00",
      }),
      0,
    );
    expect(e.observationsProposal).toBe("Obs original.");
    expect(e.observationsProposal).not.toContain("Montagem");
    expect(e.observationsProposal).not.toContain("Contratante");
    expect(e.observationsProposal).not.toContain("UF do evento");
    expect(e.observationsProposal).not.toContain("Saída");
  });

  it("saída só-data: a data preservada em observations (único caso sem coluna)", () => {
    const e = normalizeImportEvent(
      buildRawEvent({ notes: "Nota.", departure_date: "2026-09-11", departure_time: null }),
      0,
    );
    expect(e.observationsProposal).toBe("Nota.\n\nSaída logística prevista: 11/09/2026");
    expect(e.logisticsDeparture.timestampValue).toBeNull();
  });

  it("25. contratante null -> vai como null no campo próprio, não em observations", () => {
    const e = normalizeImportEvent(
      buildRawEvent({
        notes: "Obs.",
        setup_time: null, staff_notes: null, state: null,
        departure_date: null, departure_time: null,
        contratante_nome: null, contratante_cidade: null, contratante_telefone: null,
      }),
      0,
    );
    expect(e.observationsProposal).toBe("Obs.");
    expect(e.contratanteNome).toBeNull();
  });

  it("26. strings vazias nunca viram a palavra 'null'", () => {
    const e = normalizeImportEvent(
      buildRawEvent({
        artist: "", city: "", venue: "", notes: "", staff_notes: "", setup_time: "",
        state: "", departure_date: "", departure_time: "",
        contratante_nome: "", contratante_cidade: "", contratante_telefone: "",
      }),
      0,
    );
    expect(e.artist).toBeNull();
    expect(e.city).toBeNull();
    expect(e.venue).toBeNull();
    expect(e.observationsProposal).toBe("");
    expect(JSON.stringify(e)).not.toContain('"null"');
  });

  it("8/CITY-STATE. cityStateLabel = 'Cidade - UF'", () => {
    expect(normalizeImportEvent(buildRawEvent({ city: "Recife", state: "PE" }), 0).cityStateLabel).toBe("Recife - PE");
    expect(normalizeImportEvent(buildRawEvent({ city: "Recife", state: null }), 0).cityStateLabel).toBe("Recife");
  });
});

describe("agenda-import - arquivo real (item 13)", () => {
  it("aceita o export real de 2026-08-01 a 2026-08-28 como válido", () => {
    const preview = parseOk(realExportFileJson);
    expect(preview.summary.validCount).toBe(1);
    expect(preview.summary.invalidCount).toBe(0);

    const [e] = preview.events;
    expect(e.name).toBe("Aniversário da Cidade");
    expect(e.date).toBe("2026-08-27");
    expect(e.venue).toBeNull(); // venue vazio -> null
    expect(e.showTime).toBeNull(); // show_time null
    expect(e.setupTime).toBeNull(); // setup_time null
    expect(e.status).toBe("confirmado");
    expect(e.cityStateLabel).toBe("Campina Grande - PB");
    expect(e.logisticsDeparture.kind).toBe("date_and_time"); // departure_date + "12:00"
  });

  it("arquivo real: saída logística vira timestampValue naive (data+hora)", () => {
    const [e] = parseOk(realExportFileJson).events;
    expect(e.logisticsDeparture.kind).toBe("date_and_time");
    expect(e.logisticsDeparture.timestampValue).toBe("2026-08-28T12:00:00");
    expect(e.logisticsDeparture.observationsLine).toBeNull();
  });

  it("arquivo real: observations proposta = SÓ o notes original", () => {
    const [e] = parseOk(realExportFileJson).events;
    expect(e.observationsProposal).toBe("Portão de carga pelos fundos. Falar com o produtor local.");
  });

  it("arquivo real: payload leva state/contratante/logistics_departure em campos próprios", () => {
    const payload = toImportPayloadEvent(parseOk(realExportFileJson).events[0]);
    expect(payload).toMatchObject({
      state: "PB",
      contratante_nome: "Prefeitura Municipal / Produtora XYZ",
      contratante_cidade: "João Pessoa",
      contratante_telefone: "(83) 98888-7777",
      staff_notes: "Van sai do hotel às 10h.",
      setup_time: null,
      logistics_departure: "2026-08-28T12:00:00",
      observations: "Portão de carga pelos fundos. Falar com o produtor local.",
    });
    expect(payload.observations).not.toContain("Contratante");
    expect(payload.observations).not.toContain("UF");
  });
});

describe("agenda-import - Fase 2: source_system + payload da RPC (itens 4-9, 11-16)", () => {
  it("resolveSourceSystem normaliza a origem legada", () => {
    expect(resolveSourceSystem("Gestão de Eventos Pro")).toBe("gestao_eventos_pro");
    expect(resolveSourceSystem("  Gestão de Eventos Pro ")).toBe("gestao_eventos_pro");
    expect(resolveSourceSystem("Outro")).toBeNull();
  });

  it("summary.sourceSystem vem resolvido no parse", () => {
    const preview = parseOk(buildExportFile([buildRawEvent()]));
    expect(preview.summary.sourceSystem).toBe("gestao_eventos_pro");
  });

  it("toImportPayloadEvent: campos próprios direto, observations = só notes (itens 5, 7-14)", () => {
    const preview = parseOk(
      buildExportFile([
        buildRawEvent({
          source_event_id: "SRC-ABC",
          name: "  Festival  ",
          date: "2026-09-10",
          artist: "  Banda X  ",
          city: "Recife",
          state: "PE",
          venue: "",
          show_time: "21:00",
          status: "Confirmado",
          notes: "Nota.",
          setup_time: "14:00",
          staff_notes: "Levar cabo XLR.",
          contratante_nome: "Produtora ABC",
          contratante_cidade: "Olinda",
          contratante_telefone: "(81) 90000-0000",
          departure_date: "2026-09-11",
          departure_time: "08:00",
        }),
      ]),
    );
    const payload = toImportPayloadEvent(preview.events[0]);
    expect(payload).toEqual({
      source_event_id: "SRC-ABC",
      name: "Festival",
      date: "2026-09-10",
      artist: "Banda X",
      city: "Recife", // item 8: SOMENTE city
      venue: null, // "" -> null
      show_time: "21:00:00", // item 13
      status: "confirmado", // item 14
      state: "PE", // item 7
      setup_time: "14:00", // item 8 (texto, como veio)
      staff_notes: "Levar cabo XLR.", // item 9
      contratante_nome: "Produtora ABC", // item 10
      contratante_cidade: "Olinda", // item 11
      contratante_telefone: "(81) 90000-0000", // item 12
      logistics_departure: "2026-09-11T08:00:00", // regra do EventForm
      observations: "Nota.", // item 13/14: só o notes, nada copiado
    });
  });

  it("toImportPayloadEvent: campos vazios -> NULL (item 15)", () => {
    const preview = parseOk(
      buildExportFile([
        buildRawEvent({
          artist: null, city: "", venue: undefined, show_time: "",
          notes: "", staff_notes: "", setup_time: "", state: "  ", contratante_nome: "",
          contratante_cidade: "", contratante_telefone: "", departure_date: "", departure_time: "",
        }),
      ]),
    );
    const payload = toImportPayloadEvent(preview.events[0]);
    for (const key of [
      "artist", "city", "venue", "show_time", "state", "setup_time", "staff_notes",
      "contratante_nome", "contratante_cidade", "contratante_telefone", "logistics_departure", "observations",
    ] as const) {
      expect(payload[key], key).toBeNull();
    }
  });

  it("toImportPayloadEvent recusa evento inválido", () => {
    const preview = parseOk(buildExportFile([buildRawEvent({ status: "Adiado" })]));
    expect(() => toImportPayloadEvent(preview.events[0])).toThrow(/válidos/i);
  });
});

describe("agenda-import - pureza (item 28, parte lib)", () => {
  it("parseAgendaImportContent é determinística e não lança", () => {
    const json = realExportFileJson;
    const a = parseAgendaImportContent(json);
    const b = parseAgendaImportContent(json);
    expect(a).toEqual(b);
    expect(() => parseAgendaImportContent("qualquer lixo aqui")).not.toThrow();
  });
});
