import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchAlreadyImportedSourceEventIds, importAgendaEvents } from "./agenda-import-service";
import type { ImportPayloadEvent } from "./agenda-import";

const payload = (id: string): ImportPayloadEvent => ({
  source_event_id: id,
  name: `Evento ${id}`,
  date: "2026-09-10",
  artist: null,
  city: null,
  venue: null,
  show_time: null,
  status: "confirmado",
  state: null,
  setup_time: null,
  staff_notes: null,
  contratante_nome: null,
  contratante_cidade: null,
  contratante_telefone: null,
  logistics_departure: null,
  observations: null,
});

afterEach(() => rpc.mockReset());

describe("agenda-import-service", () => {
  describe("fetchAlreadyImportedSourceEventIds", () => {
    it("chama a RPC de leitura com source_system + ids e devolve um Set", async () => {
      rpc.mockResolvedValue({ data: [{ source_event_id: "a" }, { source_event_id: "c" }], error: null });
      const result = await fetchAlreadyImportedSourceEventIds("gestao_eventos_pro", ["a", "b", "c"]);
      expect(rpc).toHaveBeenCalledWith("listar_eventos_agenda_ja_importados", {
        _source_system: "gestao_eventos_pro",
        _source_event_ids: ["a", "b", "c"],
      });
      expect(result).toEqual(new Set(["a", "c"]));
    });

    it("não chama a RPC quando a lista está vazia", async () => {
      const result = await fetchAlreadyImportedSourceEventIds("gestao_eventos_pro", []);
      expect(rpc).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });

    it("propaga o erro da RPC", async () => {
      rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(fetchAlreadyImportedSourceEventIds("gestao_eventos_pro", ["a"])).rejects.toThrow("boom");
    });
  });

  describe("importAgendaEvents", () => {
    it("chama a RPC transacional e devolve as contagens (item 20)", async () => {
      rpc.mockResolvedValue({ data: { imported: 8, skipped: 2 }, error: null });
      const result = await importAgendaEvents("gestao_eventos_pro", [payload("1"), payload("2")]);
      expect(rpc).toHaveBeenCalledWith("importar_agenda_eventos", {
        _source_system: "gestao_eventos_pro",
        _eventos: [payload("1"), payload("2")],
      });
      expect(result).toEqual({ imported: 8, skipped: 2 });
    });

    it("propaga o erro da RPC (rollback do lote no servidor)", async () => {
      rpc.mockResolvedValue({ data: null, error: { message: "Data invalida no evento src-2" } });
      await expect(importAgendaEvents("gestao_eventos_pro", [payload("1")])).rejects.toThrow(/Data invalida/);
    });

    it("nunca faz supabase.from(...).insert(...) - só a RPC", async () => {
      rpc.mockResolvedValue({ data: { imported: 1, skipped: 0 }, error: null });
      await importAgendaEvents("gestao_eventos_pro", [payload("1")]);
      // o módulo do serviço nem importa `from`; a única superfície é rpc()
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("importar_agenda_eventos", expect.any(Object));
    });
  });
});
