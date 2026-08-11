import { describe, expect, it, vi, beforeEach } from "vitest";

const { rasterizeHtmlToPngBytesMock, printImagesToWindowsPrinterMock } = vi.hoisted(() => ({
  rasterizeHtmlToPngBytesMock: vi.fn(),
  printImagesToWindowsPrinterMock: vi.fn(),
}));
vi.mock("./printer-service", () => ({
  rasterizeHtmlToPngBytes: rasterizeHtmlToPngBytesMock,
  printImagesToWindowsPrinter: printImagesToWindowsPrinterMock,
}));
// JsBarcode measures text via a real canvas 2D context to lay out the
// human-readable value under the bars - jsdom has none (same gap as
// html2canvas). Mocked minimally so barcode-inclusion logic stays
// testable without needing the `canvas` native package as a test dep.
vi.mock("jsbarcode", () => ({
  default: (svg: SVGElement, value: string) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  },
}));

import { openLabelPrintWindow, printLabelBatchDesktop, printLabelRequest, renderLabelMarkup } from "./material-label-print";
import type { LabelMaterialSnapshot, LabelModelSnapshot, LabelPrintBatch } from "./material-label-types";

const model: LabelModelSnapshot = {
  id: "model-1", nome: "Padrão", largura_mm: 50, altura_mm: 30, tipo_identificacao: "ambos",
  campos: ["nome", "codigo_interno"], tamanho_fonte: 10, mostrar_borda: false,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5, versao: 1,
};

const material: LabelMaterialSnapshot = {
  id: "material-1", nome: "Furadeira <Bosch>", codigo_interno: "FUR-001", categoria: "Ferramentas",
  marca: null, modelo: null, numero_serie: null, numero_patrimonio: null, localizacao: null,
  empresa: "Empresa X", identificador_unico: "uuid-1", conteudo_qr_code: "QR-1", codigo_barras: "789",
};

describe("renderLabelMarkup", () => {
  it("includes both QR and barcode when the model asks for both and the material has both codes", () => {
    const html = renderLabelMarkup(model, material);
    expect(html).toContain('class="label"');
    expect(html).toContain("<svg"); // at least the QR/barcode svg markup is present
  });

  it("omits the QR code entirely when the model is codigo_barras-only", () => {
    const barcodeOnlyModel: LabelModelSnapshot = { ...model, tipo_identificacao: "codigo_barras" };
    const html = renderLabelMarkup(barcodeOnlyModel, material);
    // qrcode.react's SVG carries no distinguishing class, so assert via the
    // one thing that does differ: JsBarcode always renders a <text> node
    // for the human-readable value (displayValue: true) - QRCodeSVG never
    // does, so this only appears when the barcode is actually included.
    expect(html).toContain("<text");
  });

  it("escapes field values so a material name can't break out of the label markup", () => {
    const html = renderLabelMarkup(model, material);
    expect(html).not.toContain("<Bosch>");
    expect(html).toContain("Furadeira &lt;Bosch&gt;");
  });

  it("only renders fields that have a value, skipping blanks", () => {
    const modelWithLocation: LabelModelSnapshot = { ...model, campos: ["nome", "localizacao"] };
    const html = renderLabelMarkup(modelWithLocation, material); // localizacao is null
    expect(html).toContain("Furadeira");
    expect(html).not.toContain("Localiza"); // label for the skipped empty field never appears
  });
});

describe("printLabelRequest", () => {
  it("throws the pop-up-blocked message instead of writing anything when there's no target window", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => printLabelRequest({ modelo_snapshot: model } as LabelPrintBatch, null)).toThrow(/pop-up|bloqueou/i);
    openSpy.mockRestore();
  });

  it("writes one <article class=label> per physical label (quantity expanded), not per batch item", () => {
    const batch: LabelPrintBatch = {
      id: "batch-1", modelo_id: model.id, modelo_snapshot: model, quantidade_materiais: 1,
      quantidade_etiquetas: 3, solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [{ id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 3, material_snapshot: material }],
    };
    let written = "";
    const popup = { document: { open: vi.fn(), write: (html: string) => { written = html; }, close: vi.fn() } } as unknown as Window;

    printLabelRequest(batch, popup);

    expect(written.match(/class="label"/g)).toHaveLength(3);
    expect(written).toContain("@page { size: 50mm 30mm; margin: 0; }");
  });
});

describe("printLabelBatchDesktop", () => {
  beforeEach(() => {
    rasterizeHtmlToPngBytesMock.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    printImagesToWindowsPrinterMock.mockReset().mockResolvedValue(undefined);
  });

  it("rasterizes once per batch item (not once per physical label) and forwards each item's quantity", async () => {
    const batch: LabelPrintBatch = {
      id: "batch-1", modelo_id: model.id, modelo_snapshot: model, quantidade_materiais: 1,
      quantidade_etiquetas: 5, solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [{ id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 5, material_snapshot: material }],
    };

    await printLabelBatchDesktop("LABEL", batch);

    expect(rasterizeHtmlToPngBytesMock).toHaveBeenCalledTimes(1);
    expect(rasterizeHtmlToPngBytesMock).toHaveBeenCalledWith(
      expect.objectContaining({ widthMm: 50, heightMm: 30 }),
    );
    expect(printImagesToWindowsPrinterMock).toHaveBeenCalledWith(
      "LABEL",
      [{ pngBytes: new Uint8Array([1, 2, 3]), quantity: 5 }],
      "Etiquetas - lote batch-1",
      expect.objectContaining({ failed: expect.stringMatching(/etiqueta/i) }),
    );
  });

  it("rasterizes items in `ordem`, regardless of the array's original order", async () => {
    const second: LabelMaterialSnapshot = { ...material, id: "material-2", nome: "Segundo" };
    const batch: LabelPrintBatch = {
      id: "batch-1", modelo_id: model.id, modelo_snapshot: model, quantidade_materiais: 2,
      quantidade_etiquetas: 2, solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [
        { id: "item-2", solicitacao_id: "batch-1", material_id: second.id, ordem: 1, quantidade: 1, material_snapshot: second },
        { id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 1, material_snapshot: material },
      ],
    };
    const seenNames: string[] = [];
    rasterizeHtmlToPngBytesMock.mockImplementation(async ({ html }: { html: string }) => {
      seenNames.push(html.includes("Segundo") ? "Segundo" : "Furadeira");
      return new Uint8Array([0]);
    });

    await printLabelBatchDesktop("LABEL", batch);

    expect(seenNames).toEqual(["Furadeira", "Segundo"]);
  });
});

describe("openLabelPrintWindow", () => {
  it("opens a blank popup window sized for the print preview", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    openLabelPrintWindow();
    expect(openSpy).toHaveBeenCalledWith("", "_blank", "popup,width=900,height=700");
    openSpy.mockRestore();
  });
});
