import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBackupPayload, type BackupData } from "./backup-utils";

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from },
}));

import { restoreBackup } from "./backup-service";

const empresaId = "123e4567-e89b-42d3-a456-426614174000";
const backupData = {
  eventos: [],
  event_days: [],
  event_files: [],
  financials: [],
} satisfies BackupData;

describe("restoreBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates the whole destructive restore to one transactional RPC", async () => {
    rpc.mockResolvedValue({ data: { restored: true }, error: null });
    const payload = buildBackupPayload(empresaId, "manual", backupData);

    await restoreBackup(empresaId, payload, "admin_empresa");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("restore_company_backup", {
      _empresa_id: empresaId,
      _payload: payload,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure without attempting client-side mutations", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("restore aborted") });
    const payload = buildBackupPayload(empresaId, "manual", backupData);

    await expect(
      restoreBackup(empresaId, payload, "admin_empresa"),
    ).rejects.toThrow("Falha ao restaurar backup: restore aborted");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
