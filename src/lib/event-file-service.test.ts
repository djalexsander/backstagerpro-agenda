import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  insertSingle: vi.fn(),
  deleteFilters: [] as Array<Array<[string, unknown]>>,
  deleteAwaitResult: { error: null as Error | null },
  deleteMaybeSingle: vi.fn(),
}));

function createDeleteBuilder() {
  const filters: Array<[string, unknown]> = [];
  mocks.deleteFilters.push(filters);

  const builder = {
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle: mocks.deleteMaybeSingle,
    then<TResult1 = { error: Error | null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { error: Error | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(mocks.deleteAwaitResult).then(
        onfulfilled,
        onrejected,
      );
    },
  };

  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        remove: mocks.remove,
      })),
    },
    from: vi.fn(() => ({
      insert: (payload: unknown) => {
        mocks.insert(payload);
        return {
          select: () => ({
            single: mocks.insertSingle,
          }),
        };
      },
      delete: createDeleteBuilder,
    })),
  },
}));

import { removeEventFile, uploadEventFile } from "./event-file-service";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
const empresaId = "223e4567-e89b-42d3-a456-426614174000";

function pdfFile() {
  return new File(["pdf"], "Rider Principal.pdf", {
    type: "application/pdf",
  });
}

describe("event file service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteFilters.length = 0;
    mocks.deleteAwaitResult = { error: null };
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.insertSingle.mockResolvedValue({
      data: {
        id: "file-new",
        event_id: eventId,
        empresa_id: empresaId,
        file_path: `${eventId}/material_123_Rider_Principal.pdf`,
        file_name: "Rider Principal.pdf",
        file_type: "material_list",
      },
      error: null,
    });
    mocks.deleteMaybeSingle.mockResolvedValue({
      data: { id: "file-old" },
      error: null,
    });
    vi.spyOn(Date, "now").mockReturnValue(123);
  });

  it("rejects a common user before touching Storage or metadata", async () => {
    await expect(
      uploadEventFile({
        eventId,
        empresaId,
        file: pdfFile(),
        fileType: "material_list",
        kind: "material",
        role: "usuario",
      }),
    ).rejects.toThrow(/administradores/i);

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("uploads a PDF and persists tenant-scoped metadata", async () => {
    const created = await uploadEventFile({
      eventId,
      empresaId,
      file: pdfFile(),
      fileType: "material_list",
      kind: "material",
      role: "admin_empresa",
    });

    expect(mocks.upload).toHaveBeenCalledWith(
      `${eventId}/material_123_Rider_Principal.pdf`,
      expect.any(File),
      expect.objectContaining({
        contentType: "application/pdf",
        upsert: false,
      }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: eventId,
        empresa_id: empresaId,
        file_type: "material_list",
      }),
    );
    expect(created.id).toBe("file-new");
  });

  it("removes a newly uploaded object when metadata creation fails", async () => {
    mocks.insertSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("metadata denied"),
    });

    await expect(
      uploadEventFile({
        eventId,
        empresaId,
        file: pdfFile(),
        fileType: "material_list",
        kind: "material",
        role: "admin_empresa",
      }),
    ).rejects.toThrow("metadata denied");

    expect(mocks.remove).toHaveBeenCalledWith([
      `${eventId}/material_123_Rider_Principal.pdf`,
    ]);
  });

  it("scopes replacement deletion to both file and event", async () => {
    await uploadEventFile({
      eventId,
      empresaId,
      file: pdfFile(),
      fileType: "event_rider",
      kind: "rider",
      role: "admin_empresa",
      replacement: {
        id: "file-old",
        file_path: `${eventId}/rider_old.pdf`,
      },
    });

    expect(mocks.deleteFilters[0]).toEqual([
      ["id", "file-old"],
      ["event_id", eventId],
    ]);
    expect(mocks.remove).toHaveBeenCalledWith([
      `${eventId}/rider_old.pdf`,
    ]);
  });

  it("deletes metadata first and tolerates orphan cleanup failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.remove.mockResolvedValueOnce({ error: new Error("storage offline") });

    await expect(
      removeEventFile({
        eventId,
        fileId: "file-old",
        filePath: `${eventId}/old.pdf`,
        role: "admin_empresa",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.deleteFilters[0]).toEqual([
      ["id", "file-old"],
      ["event_id", eventId],
    ]);
    expect(warning).toHaveBeenCalled();
  });
});
