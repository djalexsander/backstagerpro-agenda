import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {} as Record<string, ReturnType<typeof vi.fn>>;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn();
  return { rpc: vi.fn(), from: vi.fn(() => query), query };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
import { listLabelPrintHistory, registerLabelPrintBatch, registerLabelPrintRequest, resolveLabelMaterialById, saveLabelModel } from "./material-label-service";

describe("material label service", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockClear();
    mocks.query.select.mockClear();
    mocks.query.eq.mockClear();
    mocks.query.maybeSingle.mockReset();
  });

  it("sends model dimensions and ordered fields to the canonical RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "model" }, error: null });
    await saveLabelModel("company", { name: "60x40", widthMm: 60, heightMm: 40, identificationType: "ambos", fields: ["nome", "codigo_interno"], fontSize: 10, showBorder: true, isDefault: true, innerMarginMm: 2, innerGapMm: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("salvar_modelo_etiqueta_v2", expect.objectContaining({ _empresa_id: "company", _largura_mm: 60, _campos: ["nome", "codigo_interno"], _margem_interna_mm: 2 }));
  });

  it("sends one ordered multi-material payload to the atomic batch RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "batch", itens: [] }, error: null });
    const model = { id: "model", updated_at: "model-version" } as never;
    const items = [{ material: { id: "a", updated_at: "a-version" }, quantity: 10 }, { material: { id: "b", updated_at: "b-version" }, quantity: 4 }] as never;
    await registerLabelPrintBatch("company", { model, items, clientUuid: "request" });
    expect(mocks.rpc).toHaveBeenCalledWith("registrar_solicitacao_impressao_lote_etiquetas", expect.objectContaining({
      _client_uuid: "request", _expected_model_updated_at: "model-version",
      _itens: [{ material_id: "a", quantidade: 10, expected_updated_at: "a-version" }, { material_id: "b", quantidade: 4, expected_updated_at: "b-version" }],
    }));
  });

  it("records quantity and client idempotency key before browser printing", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "print" }, error: null });
    await registerLabelPrintRequest("company", { modelId: "model", materialId: "material", quantity: 12, clientUuid: "request" });
    expect(mocks.rpc).toHaveBeenCalledWith("registrar_solicitacao_impressao_etiqueta", expect.objectContaining({ _quantidade: 12, _client_uuid: "request" }));
  });

  it("maps paginated immutable history", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ item: { id: "print" }, total_count: 9 }], error: null });
    const result = await listLabelPrintHistory("company", 2, 5);
    expect(result).toEqual({ items: [{ id: "print" }], total: 9 });
    expect(mocks.rpc).toHaveBeenCalledWith("listar_historico_impressoes_etiqueta", expect.objectContaining({ _pagina: 2, _por_pagina: 5 }));
  });

  it("resolves a structured material id and reuses the canonical text search with its code", async () => {
    const material = { id: "11bd7b83-dc2f-43aa-8a4d-73f1d0388a51", nome: "line array", codigo_interno: "0003", ativo: true };
    mocks.query.maybeSingle.mockResolvedValue({ data: material, error: null });
    mocks.rpc.mockResolvedValue({ data: [{ ...material, categoria: "Áudio" }], error: null });

    await expect(resolveLabelMaterialById("company-a", material.id)).resolves.toEqual({
      status: "found",
      material: expect.objectContaining({ id: material.id, codigo_interno: "0003" }),
    });
    expect(mocks.query.eq).toHaveBeenNthCalledWith(1, "empresa_id", "company-a");
    expect(mocks.query.eq).toHaveBeenNthCalledWith(2, "id", material.id);
    expect(mocks.rpc).toHaveBeenCalledWith("buscar_materiais_etiqueta", expect.objectContaining({ _busca: "0003" }));
  });

  it("returns an explicit inactive fallback without searching by UUID", async () => {
    const id = "11bd7b83-dc2f-43aa-8a4d-73f1d0388a51";
    mocks.query.maybeSingle.mockResolvedValue({ data: { id, nome: "line array", codigo_interno: "0003", ativo: false }, error: null });

    await expect(resolveLabelMaterialById("company-a", id)).resolves.toEqual({
      status: "inactive", id, code: "0003", name: "line array",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a safe fallback for an invalid material id", async () => {
    await expect(resolveLabelMaterialById("company-a", "invalid-id")).resolves.toEqual({ status: "not_found" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
