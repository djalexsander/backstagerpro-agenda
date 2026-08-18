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

/**
 * Minimal stand-in for the chainable Supabase query builder: every filter
 * method returns the same object, and the object itself resolves (via
 * `then`) to `{ data, error: null }` the way the real PostgrestFilterBuilder
 * does when awaited directly.
 */
function makeQueryResult(data: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "gte", "lte", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(onFulfilled);
  return builder;
}

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

  it("gathers every 1.1 company entity into the payload, not just events/financials (P1-10)", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const tableRows: Record<string, unknown[]> = {
      events: [{ id: "event-1", empresa_id: empresaId, name: "Show" }],
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
    };
    let generatedDocumentsCalls = 0;

    from.mockImplementation((table: string) => {
      if (table === "backups") return { insert };
      if (table === "generated_documents") {
        generatedDocumentsCalls += 1;
        // gatherBackupData queries this table twice: once scoped to the
        // events already in the backup, once for company-level documents
        // with no event_id. Each call must only see its own slice.
        return makeQueryResult(
          generatedDocumentsCalls === 1
            ? [{ id: "doc-event", empresa_id: empresaId, event_id: "event-1" }]
            : [{ id: "doc-company", empresa_id: empresaId, event_id: null }],
        );
      }
      return makeQueryResult(tableRows[table] ?? []);
    });

    await createBackup(empresaId, "manual", "admin_empresa");

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
    // Merged from both generated_documents queries (event-scoped + company-level).
    expect(insertedPayload.generated_documents).toHaveLength(2);
    expect(insertedPayload.generated_documents?.map((doc) => doc.id).sort()).toEqual([
      "doc-company",
      "doc-event",
    ]);
  });

  it("does not query event-scoped 1.1 collections when the company has no events in range", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "backups") return { insert };
      return makeQueryResult([]);
    });

    await createBackup(empresaId, "manual", "admin_empresa");

    const insertedPayload = (
      insert.mock.calls[0][0] as { payload: { data: BackupData } }
    ).payload.data;
    expect(insertedPayload.event_funcionarios).toEqual([]);
    expect(insertedPayload.event_checklist_items).toEqual([]);
    // clientes/funcionarios/document_templates are company-wide, not
    // event-scoped, so they are still fetched even with zero events.
    expect(insertedPayload.clientes).toEqual([]);
  });
});
