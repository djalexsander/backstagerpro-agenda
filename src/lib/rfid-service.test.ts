import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { finishReadSession, recordReadSessionEpcs, startReadSession } from "./rfid-service";

describe("rfid session persistence RPC boundaries", () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { id: "session-1" }, error: null }));

  it("persists expected material ids when the session starts", async () => {
    await startReadSession({
      tipo: "conferencia_livre",
      expectedMaterialIds: ["material-1", "material-2"],
      dispositivoLabel: "Reader local",
    });

    expect(rpc).toHaveBeenCalledWith("rfid_start_read_session", {
      _tipo: "conferencia_livre",
      _referencia_tipo: null,
      _referencia_id: null,
      _dispositivo_label: "Reader local",
      _expected_material_ids: ["material-1", "material-2"],
    });
  });

  it("persists EPC observations through the session-scoped RPC", async () => {
    await recordReadSessionEpcs("session-1", ["AABBCCDD", "11223344"]);

    expect(rpc).toHaveBeenCalledWith("rfid_record_read_session_epcs", {
      _session_id: "session-1",
      _epcs: ["AABBCCDD", "11223344"],
    });
  });

  it("sends no client-calculated counts or result when finalizing", async () => {
    await finishReadSession({ sessionId: "session-1", status: "concluida" });

    expect(rpc).toHaveBeenCalledWith("rfid_finish_read_session", {
      _session_id: "session-1",
      _status: "concluida",
    });
  });
});
