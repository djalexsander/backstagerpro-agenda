import { describe, expect, it } from "vitest";
import { addLabelBatchMaterial, canPrintMaterialWithModel, expandLabelBatch, labelBatchTotal, labelBatchToRpcItems, labelHistoryPagination, labelModelToSnapshot, labelReadinessMessage, removeLabelBatchMaterial, updateLabelBatchQuantity, validateLabelModel } from "./material-label-domain";
import type { LabelMaterial, LabelModel } from "./material-label-types";

const material = (overrides: Partial<LabelMaterial> = {}): LabelMaterial => ({
  id: "material", nome: "Moving Head", codigo_interno: "LUZ-01", categoria: "Iluminação",
  marca: "Acme", modelo: "Beam", numero_serie: "SER-1", numero_patrimonio: "PAT-1",
  localizacao: "Galpão", identificador_unico: "unique", tipo_identificacao: "ambos",
  status_identificacao: "ativa", conteudo_qr_code: "BACKSTAGE-PRO:MATERIAL:unique",
  codigo_barras: "BSP-ABC123", ativo: true, ultima_impressao_em: null, total_impresso: 0, updated_at: "2026-08-04T00:00:00Z", ...overrides,
});

const model = (overrides: Partial<LabelModel> = {}): LabelModel => ({
  id: "model", empresa_id: "company", nome: "Patrimônio", descricao: null,
  largura_mm: 60, altura_mm: 40, tipo_identificacao: "qr_code", campos: ["nome", "codigo_interno"],
  tamanho_fonte: 10, mostrar_borda: false, padrao: true, ativo: true, versao: 2,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5,
  created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z", ...overrides,
});

describe("material label domain", () => {
  it("requires exactly the identifiers selected by the model", () => {
    expect(canPrintMaterialWithModel(material(), model())).toBe(true);
    expect(canPrintMaterialWithModel(material({ conteudo_qr_code: null }), model())).toBe(false);
    expect(canPrintMaterialWithModel(material({ codigo_barras: null }), model({ tipo_identificacao: "codigo_barras" }))).toBe(false);
    expect(canPrintMaterialWithModel(material({ codigo_barras: null }), model({ tipo_identificacao: "ambos" }))).toBe(false);
  });

  it("explains missing identification without generating a parallel value", () => {
    expect(labelReadinessMessage(material({ conteudo_qr_code: null }), model())).toMatch(/QR Code/);
    expect(labelReadinessMessage(material(), model())).toBeNull();
  });

  it("validates physical dimensions, font and distinct fields", () => {
    expect(validateLabelModel({ name: "A", widthMm: 60, heightMm: 40, fontSize: 10, fields: ["nome"] })).toBeNull();
    expect(validateLabelModel({ name: "", widthMm: 60, heightMm: 40, fontSize: 10, fields: ["nome"] })).toMatch(/nome/);
    expect(validateLabelModel({ name: "A", widthMm: 10, heightMm: 40, fontSize: 10, fields: ["nome"] })).toMatch(/largura/);
    expect(validateLabelModel({ name: "A", widthMm: 60, heightMm: 40, fontSize: 4, fields: ["nome"] })).toMatch(/fonte/);
    expect(validateLabelModel({ name: "A", widthMm: 60, heightMm: 40, fontSize: 10, fields: ["nome", "nome"] })).toMatch(/repetições/);
  });

  it("creates an immutable-print snapshot contract from the current model version", () => {
    expect(labelModelToSnapshot(model())).toEqual(expect.objectContaining({ id: "model", versao: 2, largura_mm: 60 }));
    expect(labelModelToSnapshot(model())).not.toHaveProperty("updated_at");
  });

  it("selects, updates and removes multiple materials without duplicates", () => {
    const first = material(); const second = material({ id: "material-2", nome: "Cabo" });
    let batch = addLabelBatchMaterial([], first);
    batch = addLabelBatchMaterial(batch, first);
    batch = addLabelBatchMaterial(batch, second);
    batch = updateLabelBatchQuantity(batch, first.id, 10);
    expect(batch).toHaveLength(2); expect(labelBatchTotal(batch)).toBe(11);
    batch = removeLabelBatchMaterial(batch, second.id);
    expect(batch.map((item) => item.material.id)).toEqual([first.id]);
  });

  it("transforms the ordered batch into the atomic RPC payload", () => {
    const items = [{ material: material(), quantity: 10 }, { material: material({ id: "material-2" }), quantity: 4 }];
    expect(labelBatchToRpcItems(items)).toEqual([
      { material_id: "material", quantidade: 10, expected_updated_at: "2026-08-04T00:00:00Z" },
      { material_id: "material-2", quantidade: 4, expected_updated_at: "2026-08-04T00:00:00Z" },
    ]);
  });

  it("expands preview and print pages in stable item order", () => {
    const snapshot = { id: "a", nome: "A" } as never; const snapshotB = { id: "b", nome: "B" } as never;
    const pages = expandLabelBatch({ itens: [
      { id: "b", solicitacao_id: "r", material_id: "b", ordem: 2, quantidade: 1, material_snapshot: snapshotB },
      { id: "a", solicitacao_id: "r", material_id: "a", ordem: 1, quantidade: 2, material_snapshot: snapshot },
    ] });
    expect(pages.map((item) => item.id)).toEqual(["a", "a", "b"]);
  });

  it("computes server-side history pagination limits", () => {
    expect(labelHistoryPagination(1, 10, 21)).toEqual({ totalPages: 3, canGoPrevious: false, canGoNext: true });
    expect(labelHistoryPagination(3, 10, 21)).toEqual({ totalPages: 3, canGoPrevious: true, canGoNext: false });
  });
});
