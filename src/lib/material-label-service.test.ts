import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { listLabelPrintHistory, registerLabelPrintBatch, registerLabelPrintRequest, saveLabelModel } from "./material-label-service";

describe("material label service", () => {
  beforeEach(() => rpc.mockReset());

  it("sends model dimensions and ordered fields to the canonical RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "model" }, error: null });
    await saveLabelModel("company", { name: "60x40", widthMm: 60, heightMm: 40, identificationType: "ambos", fields: ["nome", "codigo_interno"], fontSize: 10, showBorder: true, isDefault: true, innerMarginMm: 2, innerGapMm: 1 });
    expect(rpc).toHaveBeenCalledWith("salvar_modelo_etiqueta_v2", expect.objectContaining({ _empresa_id: "company", _largura_mm: 60, _campos: ["nome", "codigo_interno"], _margem_interna_mm: 2 }));
  });

  it("sends one ordered multi-material payload to the atomic batch RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "batch", itens: [] }, error: null });
    const model = { id: "model", updated_at: "model-version" } as never;
    const items = [{ material: { id: "a", updated_at: "a-version" }, quantity: 10 }, { material: { id: "b", updated_at: "b-version" }, quantity: 4 }] as never;
    await registerLabelPrintBatch("company", { model, items, clientUuid: "request" });
    expect(rpc).toHaveBeenCalledWith("registrar_solicitacao_impressao_lote_etiquetas", expect.objectContaining({
      _client_uuid: "request", _expected_model_updated_at: "model-version",
      _itens: [{ material_id: "a", quantidade: 10, expected_updated_at: "a-version" }, { material_id: "b", quantidade: 4, expected_updated_at: "b-version" }],
    }));
  });

  it("records quantity and client idempotency key before browser printing", async () => {
    rpc.mockResolvedValue({ data: { id: "print" }, error: null });
    await registerLabelPrintRequest("company", { modelId: "model", materialId: "material", quantity: 12, clientUuid: "request" });
    expect(rpc).toHaveBeenCalledWith("registrar_solicitacao_impressao_etiqueta", expect.objectContaining({ _quantidade: 12, _client_uuid: "request" }));
  });

  it("maps paginated immutable history", async () => {
    rpc.mockResolvedValue({ data: [{ item: { id: "print" }, total_count: 9 }], error: null });
    const result = await listLabelPrintHistory("company", 2, 5);
    expect(result).toEqual({ items: [{ id: "print" }], total: 9 });
    expect(rpc).toHaveBeenCalledWith("listar_historico_impressoes_etiqueta", expect.objectContaining({ _pagina: 2, _por_pagina: 5 }));
  });
});
