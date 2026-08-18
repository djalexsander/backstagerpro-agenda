import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBackupPayload, type BackupData } from "./backup-utils";

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from },
}));

import { createBackup, restoreBackup } from "./backup-service";

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

describe("createBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const OPERATIONAL_CORE_TABLES = [
    "categorias_materiais",
    "materiais",
    "estoque_localizacoes",
    "estoque_saldos",
    "estoque_movimentacoes",
    "material_custodias",
    "material_custodia_eventos",
    "material_locacoes",
    "material_locacao_itens",
    "material_locacao_eventos",
    "manutencao_ordens",
    "manutencao_ordem_insumos",
    "manutencao_ordem_eventos",
    "financeiro_lancamentos",
    "financeiro_parcelas",
    "financeiro_recebimentos",
  ] as const;

  function operationalCoreRows(): Record<string, unknown[]> {
    return Object.fromEntries(
      OPERATIONAL_CORE_TABLES.map((table) => [
        table,
        [{ id: `${table}-1`, empresa_id: empresaId }],
      ]),
    );
  }

  /**
   * gatherBackupData (P1-10B/RLS-gap fix) now delegates entirely to the
   * gather_company_backup_data SECURITY DEFINER RPC instead of ~20 direct
   * `.from(table).select()` calls, so these tests mock `rpc`, not `from`.
   */
  function fullRpcRows(): Record<string, unknown[]> {
    return {
      eventos: [{ id: "event-1", empresa_id: empresaId, name: "Show" }],
      event_days: [{ id: "day-1", event_id: "event-1", empresa_id: empresaId }],
      event_files: [],
      financials: [],
      event_funcionarios: [
        { id: "link-1", event_id: "event-1", funcionario_id: "employee-1", empresa_id: empresaId },
      ],
      event_checklist_items: [{ id: "check-1", event_id: "event-1", empresa_id: empresaId }],
      clientes: [{ id: "client-1", empresa_id: empresaId, nome: "Cliente 1" }],
      funcionarios: [{ id: "employee-1", empresa_id: empresaId, nome: "Funcionário 1" }],
      document_templates: [{ id: "template-1", empresa_id: empresaId, nome: "Contrato" }],
      generated_documents: [
        { id: "doc-event", empresa_id: empresaId, event_id: "event-1" },
        { id: "doc-company", empresa_id: empresaId, event_id: null },
      ],
      ...operationalCoreRows(),
    };
  }

  it("gathers every collection (P1-10/P1-10B) through the gather_company_backup_data RPC, not client-side reads", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "backups") return { insert };
      throw new Error(`unexpected supabase.from("${table}") call - gatherBackupData must not read tables directly`);
    });
    rpc.mockImplementation((fn: string) => {
      if (fn === "gather_company_backup_data") {
        return Promise.resolve({ data: fullRpcRows(), error: null });
      }
      throw new Error(`unexpected rpc call: ${fn}`);
    });

    await createBackup(empresaId, "manual", "admin_empresa");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("gather_company_backup_data", {
      _empresa_id: empresaId,
      _date_start: null,
      _date_end: null,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const insertedPayload = (
      insert.mock.calls[0][0] as { payload: { data: BackupData } }
    ).payload.data;

    expect(insertedPayload.eventos).toHaveLength(1);
    expect(insertedPayload.clientes).toHaveLength(1);
    expect(insertedPayload.funcionarios).toHaveLength(1);
    expect(insertedPayload.event_funcionarios).toHaveLength(1);
    expect(insertedPayload.event_checklist_items).toHaveLength(1);
    expect(insertedPayload.document_templates).toHaveLength(1);
    expect(insertedPayload.generated_documents).toHaveLength(2);
    // P1-10B: the sixteen operational-core collections flow through the
    // same single RPC response, independent of the events/financials path.
    for (const table of OPERATIONAL_CORE_TABLES) {
      expect(insertedPayload[table], `insertedPayload.${table}`).toHaveLength(1);
    }
  });

  it("passes the requested date range through to the RPC for a period backup", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => (table === "backups" ? { insert } : undefined));
    rpc.mockResolvedValue({ data: fullRpcRows(), error: null });

    await createBackup(empresaId, "manual", "admin_empresa", "2026-01-01", "2026-01-31");

    expect(rpc).toHaveBeenCalledWith("gather_company_backup_data", {
      _empresa_id: empresaId,
      _date_start: "2026-01-01",
      _date_end: "2026-01-31",
    });
  });

  it("surfaces an RPC failure instead of silently producing an incomplete backup", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("permission denied") });

    await expect(createBackup(empresaId, "manual", "admin_empresa")).rejects.toThrow(
      "permission denied",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("does not invent event-scoped collections when the RPC reports zero events in range", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => (table === "backups" ? { insert } : undefined));
    rpc.mockResolvedValue({
      data: {
        eventos: [], event_days: [], event_files: [], financials: [],
        event_funcionarios: [], event_checklist_items: [],
        clientes: [], funcionarios: [], document_templates: [], generated_documents: [],
        ...Object.fromEntries(OPERATIONAL_CORE_TABLES.map((t) => [t, []])),
      },
      error: null,
    });

    await createBackup(empresaId, "manual", "admin_empresa");

    const insertedPayload = (
      insert.mock.calls[0][0] as { payload: { data: BackupData } }
    ).payload.data;
    expect(insertedPayload.event_funcionarios).toEqual([]);
    expect(insertedPayload.event_checklist_items).toEqual([]);
    for (const table of OPERATIONAL_CORE_TABLES) {
      expect(insertedPayload[table], `insertedPayload.${table}`).toEqual([]);
    }
    expect(insertedPayload.clientes).toEqual([]);
  });
});
