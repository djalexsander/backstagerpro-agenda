import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  upload: vi.fn(),
  remove: vi.fn(),
  insertPayload: null as unknown,
  insertSingle: vi.fn(),
  updatePayload: null as unknown,
  filters: [] as Array<[string, unknown]>,
  deleteMaybeSingle: vi.fn(),
}));

function filterBuilder() {
  const builder = {
    eq(column: string, value: unknown) {
      mocks.filters.push([column, value]);
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle: mocks.deleteMaybeSingle,
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: (...args: unknown[]) => {
          mocks.calls.push("storage-upload");
          return mocks.upload(...args);
        },
        remove: (...args: unknown[]) => {
          mocks.calls.push("storage-remove");
          return mocks.remove(...args);
        },
      })),
    },
    from: vi.fn(() => ({
      insert: (payload: unknown) => {
        mocks.calls.push("metadata-insert");
        mocks.insertPayload = payload;
        return { select: () => ({ single: mocks.insertSingle }) };
      },
      delete: () => {
        mocks.calls.push("metadata-delete");
        return filterBuilder();
      },
      update: (payload: unknown) => {
        mocks.calls.push("metadata-update");
        mocks.updatePayload = payload;
        return filterBuilder();
      },
    })),
  },
}));

import {
  removeMaterialPhoto,
  setMainMaterialPhoto,
  uploadMaterialPhoto,
} from "./material-photo-service";

const empresaId = "123e4567-e89b-42d3-a456-426614174000";
const materialId = "223e4567-e89b-42d3-a456-426614174000";
const photoId = "323e4567-e89b-42d3-a456-426614174000";

describe("material photo service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.filters.length = 0;
    mocks.insertPayload = null;
    mocks.updatePayload = null;
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteMaybeSingle.mockResolvedValue({
      data: { id: photoId },
      error: null,
    });
    mocks.insertSingle.mockResolvedValue({
      data: {
        id: photoId,
        empresa_id: empresaId,
        material_id: materialId,
        storage_path: `${empresaId}/${materialId}/photo.jpg`,
        nome_arquivo: "photo.jpg",
        tipo_arquivo: "image/jpeg",
        tamanho_arquivo: 3,
        foto_principal: true,
        created_at: "2026-07-30T00:00:00Z",
        created_by: null,
      },
      error: null,
    });
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "423e4567-e89b-42d3-a456-426614174000",
    );
  });

  it("uploads the object before creating tenant-scoped metadata", async () => {
    const file = new File(["jpg"], "Foto Áudio.jpg", {
      type: "image/jpeg",
    });
    await uploadMaterialPhoto({
      empresaId,
      materialId,
      file,
      main: true,
    });

    expect(mocks.calls.slice(0, 2)).toEqual([
      "storage-upload",
      "metadata-insert",
    ]);
    expect(mocks.insertPayload).toMatchObject({
      empresa_id: empresaId,
      material_id: materialId,
      nome_arquivo: "Foto Áudio.jpg",
      foto_principal: true,
    });
  });

  it("removes metadata before physical Storage cleanup", async () => {
    await removeMaterialPhoto({
      empresaId,
      materialId,
      photoId,
      storagePath: `${empresaId}/${materialId}/photo.jpg`,
    });

    expect(mocks.calls).toEqual(["metadata-delete", "storage-remove"]);
    expect(mocks.filters).toEqual([
      ["id", photoId],
      ["empresa_id", empresaId],
      ["material_id", materialId],
    ]);
  });

  it("scopes the principal-photo update to tenant and material", async () => {
    await setMainMaterialPhoto({ empresaId, materialId, photoId });
    expect(mocks.updatePayload).toEqual({ foto_principal: true });
    expect(mocks.filters).toEqual([
      ["id", photoId],
      ["empresa_id", empresaId],
      ["material_id", materialId],
    ]);
  });

  it("cleans up Storage when metadata creation fails", async () => {
    mocks.insertSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("metadata denied"),
    });

    await expect(
      uploadMaterialPhoto({
        empresaId,
        materialId,
        file: new File(["jpg"], "foto.jpg", { type: "image/jpeg" }),
      }),
    ).rejects.toThrow("metadata denied");
    expect(mocks.calls).toEqual([
      "storage-upload",
      "metadata-insert",
      "storage-remove",
    ]);
  });
});

