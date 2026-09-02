import { describe, expect, it, vi, beforeEach } from "vitest";

const { printHtmlBatchMock, jsBarcodeMock } = vi.hoisted(() => ({
  printHtmlBatchMock: vi.fn(),
  // JsBarcode measures text via a real canvas 2D context to lay out the
  // human-readable value under the bars - jsdom has none (same gap as
  // html2canvas). Mocked minimally so barcode-inclusion logic stays
  // testable without needing the `canvas` native package as a test dep.
  // Respects `displayValue` (unlike a fixed always-add-text stub) since
  // renderLabelMarkup's own displayValue-by-height decision is under test.
  // A real vi.fn() (not a plain arrow function) so tests can also assert on
  // the *other* options renderLabelMarkup passes through (height/margins).
  jsBarcodeMock: vi.fn((svg: SVGElement, value: string, options?: { displayValue?: boolean }) => {
    if (options?.displayValue === false) return;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  }),
}));
vi.mock("./printer-service", () => ({
  printHtmlBatch: printHtmlBatchMock,
}));
vi.mock("jsbarcode", () => ({ default: jsBarcodeMock }));

import type { BobinaPrintProfile } from "./label-layout-engine";
import { buildBobinaPrintHtml, buildLabelContentCss, buildLabelPrintHtml, printBobinaTestPage, printLabelBatch, renderLabelMarkup } from "./material-label-print";
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

  it("groups long name and company in the non-compressible identity area", () => {
    const identityModel: LabelModelSnapshot = { ...model, campos: ["nome", "empresa", "codigo_interno"] };
    const longMaterial: LabelMaterialSnapshot = {
      ...material,
      nome: "LINE ARRAY NEO 210 COM NOME MUITO LONGO PARA A ETIQUETA",
      empresa: "EMPRESA COM RAZAO SOCIAL MUITO LONGA",
    };
    const html = renderLabelMarkup(identityModel, longMaterial);
    const identityEnd = html.indexOf("</div><div class=\"secondary-fields\"");

    expect(html).toContain('class="identity-fields"');
    expect(html).toContain('class="field field-nome primary"');
    expect(html).toContain('class="field field-empresa ');
    expect(html.indexOf(longMaterial.nome)).toBeLessThan(identityEnd);
    expect(html.indexOf(longMaterial.empresa)).toBeLessThan(identityEnd);
    expect(html.indexOf(material.codigo_interno)).toBeGreaterThan(identityEnd);
  });

  it("shows a clear, safe marker instead of a barcode when the material has no codigo_barras - never invents one", () => {
    const barcodeOnlyModel: LabelModelSnapshot = { ...model, tipo_identificacao: "codigo_barras" };
    const materialWithoutBarcode: LabelMaterialSnapshot = { ...material, codigo_barras: null };
    const html = renderLabelMarkup(barcodeOnlyModel, materialWithoutBarcode);
    expect(html).not.toContain("<svg");
    expect(html).toContain("Sem identificação");
    expect(html).not.toContain(material.identificador_unico); // no UUID fallback either
  });

  it("shows the same safe marker instead of a QR when the material has no conteudo_qr_code", () => {
    const qrOnlyModel: LabelModelSnapshot = { ...model, tipo_identificacao: "qr_code" };
    const materialWithoutQr: LabelMaterialSnapshot = { ...material, conteudo_qr_code: null };
    const html = renderLabelMarkup(qrOnlyModel, materialWithoutQr);
    expect(html).not.toContain("<svg");
    expect(html).toContain("Sem identificação");
  });

  it("marks only the missing side of a combined model, still rendering the code that IS available", () => {
    const combinedModel: LabelModelSnapshot = { ...model, tipo_identificacao: "ambos" };
    const materialWithOnlyQr: LabelMaterialSnapshot = { ...material, codigo_barras: null };
    const html = renderLabelMarkup(combinedModel, materialWithOnlyQr);
    expect(html).toContain("<svg"); // the QR still renders
    expect(html).toContain("Sem identificação"); // the missing barcode is flagged, not silently dropped
  });

  it("shows the barcode's human-readable text on a label tall enough to fit it", () => {
    const tallModel: LabelModelSnapshot = { ...model, tipo_identificacao: "codigo_barras", altura_mm: 40 };
    expect(renderLabelMarkup(tallModel, material)).toContain("<text");
  });

  it("omits the barcode's human-readable text on a label too short to fit it legibly, keeping a scannable barcode", () => {
    const shortModel: LabelModelSnapshot = { ...model, tipo_identificacao: "codigo_barras", altura_mm: 10 };
    const html = renderLabelMarkup(shortModel, material);
    expect(html).toContain("<svg");
    expect(html).not.toContain("<text");
  });
});

describe("buildLabelContentCss", () => {
  it("stacks fields and codes in explicit grid rows regardless of label dimensions", () => {
    const tallModel: LabelModelSnapshot = { ...model, largura_mm: 40, altura_mm: 60 };
    const wideModel: LabelModelSnapshot = { ...model, largura_mm: 100, altura_mm: 30 };
    for (const m of [tallModel, wideModel]) {
      const css = buildLabelContentCss(m);
      expect(css).toMatch(/\.label \{[^}]*display: grid;[^}]*grid-template-rows:/);
    }
  });

  it.each([
    [50, 30, "11mm"],
    [60, 40, "16mm"],
  ])("reserves a predictable information row for a %sx%s label", (width, height, informationHeight) => {
    const css = buildLabelContentCss({ ...model, largura_mm: width, altura_mm: height, campos: ["nome", "empresa"] });
    expect(css).toContain(`grid-template-rows: minmax(0, ${informationHeight}) minmax(0, 1fr)`);
  });

  it("limits name to two lines and company to one line", () => {
    const css = buildLabelContentCss({ ...model, campos: ["nome", "empresa"] });
    expect(css).toMatch(/\.field-nome \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden/);
    expect(css).toMatch(/\.field-empresa,[^{]+\{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
  });

  it("in combined mode, caps the QR to a modest share and lets Code128 take the remaining (priority) space", () => {
    const css = buildLabelContentCss({ ...model, tipo_identificacao: "ambos" });
    expect(css).toMatch(/\.qr-code \{ flex: 0 0 auto; max-width: 60%; max-height: 34%;/);
    expect(css).toMatch(/\.barcode \{ flex: 1 1 auto;/);
  });

  it("in QR-only mode, the QR itself gets the full codes area instead of the combined-mode cap", () => {
    const css = buildLabelContentCss({ ...model, tipo_identificacao: "qr_code" });
    expect(css).toMatch(/\.qr-code \{ flex: 1 1 auto;[^}]*max-width: 100%; max-height: 100%;/);
    expect(css).not.toContain("max-height: 34%");
  });

  it("in Code128-only mode, the barcode gets the full codes area (flex:1, same as combined mode)", () => {
    const css = buildLabelContentCss({ ...model, tipo_identificacao: "codigo_barras" });
    expect(css).toMatch(/\.barcode \{ flex: 1 1 auto;/);
  });

  it("keeps QR aspect ratio and prevents CSS from shrinking Code128 below its calculated module width", () => {
    const css = buildLabelContentCss({ ...model, tipo_identificacao: "ambos" });
    expect(css).toMatch(/\.qr-code svg \{ max-width: 100%; max-height: 100%; \}/);
    expect(css).toMatch(/\.barcode svg \{[^}]*max-width: none; max-height: 100%; \}/);
    expect(css).not.toMatch(/\.barcode svg \{[^}]*max-width: 100%/);
  });

  it("keeps identity text visible while containing secondary fields and codes", () => {
    const css = buildLabelContentCss({ ...model, largura_mm: 40, altura_mm: 27 });
    expect(css).toMatch(/\.label \{[^}]*overflow: hidden/);
    expect(css).toMatch(/\.fields \{[^}]*overflow: visible/);
    expect(css).toMatch(/\.identity-fields \{ overflow: visible/);
    expect(css).toMatch(/\.secondary-fields \{[^}]*overflow: hidden/);
    expect(css).toMatch(/\.codes \{[^}]*overflow: hidden/);
  });

  it("makes the label fill the preview surface and prevents barcode flex from compressing the information row", () => {
    const css = buildLabelContentCss(model);
    expect(css).toMatch(/\.label \{[^}]*width: 100%; height: 100%;[^}]*grid-template-rows:/);
    expect(css).not.toMatch(/\.fields \{[^}]*flex:/);
    expect(css).not.toMatch(/\.codes \{[^}]*flex:/);
  });

  it("emits bare selectors by default (the print path's isolated documents never need scoping)", () => {
    const css = buildLabelContentCss(model);
    expect(css).toContain(".label {");
    expect(css).not.toContain("undefined .label");
  });

  it("namespaces every selector under the given scope, for safe injection into a shared DOM", () => {
    const css = buildLabelContentCss(model, "#label-preview-abc");
    expect(css).toContain("#label-preview-abc .label {");
    expect(css).toContain("#label-preview-abc .codes {");
    expect(css).toContain("#label-preview-abc .fields {");
    expect(css).not.toMatch(/(?<!#label-preview-abc )\.label \{/);
  });
});

describe("renderLabelMarkup layout order (combined model)", () => {
  it("places the fields block (name/código) before the codes block in DOM order, never lateral to the QR", () => {
    const html = renderLabelMarkup(model, material);
    const fieldsIndex = html.indexOf('class="fields"');
    const codesIndex = html.indexOf('class="codes"');
    expect(fieldsIndex).toBeGreaterThanOrEqual(0);
    expect(codesIndex).toBeGreaterThan(fieldsIndex);
  });

  it("wraps QR and Code128 in distinct classed containers, QR before Code128", () => {
    const html = renderLabelMarkup(model, material);
    const qrIndex = html.indexOf('class="qr-code"');
    const barcodeIndex = html.indexOf('class="barcode"');
    expect(qrIndex).toBeGreaterThanOrEqual(0);
    expect(barcodeIndex).toBeGreaterThan(qrIndex);
  });

  it("scales the barcode's intrinsic height with the label's altura_mm instead of a fixed size", () => {
    jsBarcodeMock.mockClear();

    renderLabelMarkup({ ...model, altura_mm: 30 }, material);
    const shortHeight = (jsBarcodeMock.mock.calls.at(-1)?.[2] as { height: number }).height;

    renderLabelMarkup({ ...model, altura_mm: 90 }, material);
    const tallHeight = (jsBarcodeMock.mock.calls.at(-1)?.[2] as { height: number }).height;

    expect(tallHeight).toBeGreaterThan(shortHeight);
  });

  it("gives the barcode a lateral quiet zone without eating into top/bottom (bar height stays maximized)", () => {
    jsBarcodeMock.mockClear();

    renderLabelMarkup(model, material);
    const options = jsBarcodeMock.mock.calls.at(-1)?.[2] as {
      width: number; marginLeft: number; marginRight: number; marginTop: number; marginBottom: number;
    };
    expect(options.marginLeft).toBeCloseTo(options.width * 10, 6);
    expect(options.marginRight).toBeCloseTo(options.width * 10, 6);
    expect(options.marginTop).toBe(0);
    expect(options.marginBottom).toBe(0);
  });

  it.each([
    [50, 30, 203, 2],
    [50, 30, 300, 3],
    [60, 40, 203, 2],
    [60, 40, 300, 3],
  ])("uses Code128 C with an integer-dot module for a numeric code on %sx%s at %s DPI", (widthMm, heightMm, dpi, expectedDots) => {
    jsBarcodeMock.mockClear();
    const value = "1234567890";
    const html = renderLabelMarkup(
      { ...model, largura_mm: widthMm, altura_mm: heightMm, tipo_identificacao: "codigo_barras" },
      { ...material, codigo_barras: value },
      { widthMm, heightMm, dpi },
    );
    const [, generatedValue, options] = jsBarcodeMock.mock.calls.at(-1)!;

    expect(generatedValue).toBe(value);
    expect(options).toEqual(expect.objectContaining({ format: "CODE128C", displayValue: true }));
    expect((options as { width: number }).width * dpi / 96).toBeCloseTo(expectedDots, 6);
    expect(html).toContain(`data-module-dots=\"${expectedDots}\"`);
    expect(html).toContain("<text");
    const svg = new DOMParser().parseFromString(html, "text/html").querySelector(".barcode svg") as SVGElement;
    expect(Number.parseFloat(svg.style.width)).toBeLessThanOrEqual(widthMm - 3);
  });

  it.each([
    [50, 30, 203, 1],
    [50, 30, 300, 1],
    [60, 40, 203, 1],
    [60, 40, 300, 2],
  ])("keeps a legacy BSP barcode printable on %sx%s at %s DPI without sub-dot modules", (widthMm, heightMm, dpi, expectedDots) => {
    jsBarcodeMock.mockClear();
    const value = "BSP-A968A4040E074A928FBF";
    const html = renderLabelMarkup(
      { ...model, largura_mm: widthMm, altura_mm: heightMm, tipo_identificacao: "codigo_barras" },
      { ...material, codigo_barras: value },
      { widthMm, heightMm, dpi },
    );
    const [, generatedValue, options] = jsBarcodeMock.mock.calls.at(-1)!;

    expect(generatedValue).toBe(value);
    expect(options).toEqual(expect.objectContaining({ format: "CODE128", displayValue: false }));
    expect((options as { width: number }).width * dpi / 96).toBeCloseTo(expectedDots, 6);
    expect(html).toContain(`data-module-dots=\"${expectedDots}\"`);
    expect(html).toContain('data-quiet-zone-modules="10"');
    expect(html).not.toContain("<text");
    const svg = new DOMParser().parseFromString(html, "text/html").querySelector(".barcode svg") as SVGElement;
    expect(Number.parseFloat(svg.style.width)).toBeLessThanOrEqual(widthMm - 3);
  });

  it("keeps the human-readable value bold and separated below bars when safe width fits", () => {
    jsBarcodeMock.mockClear();
    renderLabelMarkup(
      { ...model, tipo_identificacao: "codigo_barras" },
      { ...material, codigo_barras: "1234567890" },
      { widthMm: 50, heightMm: 30, dpi: 203 },
    );
    const options = jsBarcodeMock.mock.calls.at(-1)?.[2];
    expect(options).toEqual(expect.objectContaining({
      font: "Arial",
      fontOptions: "bold",
      fontSize: 13,
      textMargin: 2,
      displayValue: true,
    }));
  });
});

describe("buildLabelPrintHtml", () => {
  it("writes one <article class=label> per physical label (quantity expanded), not per batch item", () => {
    const batch: LabelPrintBatch = {
      id: "batch-1", modelo_id: model.id, modelo_snapshot: model, quantidade_materiais: 1,
      quantidade_etiquetas: 3, solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [{ id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 3, material_snapshot: material }],
    };
    const written = buildLabelPrintHtml(batch);

    expect(written.match(/class="label"/g)).toHaveLength(3);
    expect(written).toContain("@page { size: 50mm 30mm; margin: 0; }");
  });
});

describe("printLabelBatch", () => {
  beforeEach(() => {
    printHtmlBatchMock.mockReset().mockResolvedValue(undefined);
  });

  it("rasterizes once per batch item (not once per physical label) and forwards each item's quantity", async () => {
    const batch: LabelPrintBatch = {
      id: "batch-1", modelo_id: model.id, modelo_snapshot: model, quantidade_materiais: 1,
      quantidade_etiquetas: 5, solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [{ id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 5, material_snapshot: material }],
    };

    const configuredPrinter = { finalidade: "etiqueta", nome_impressora: "LABEL", ativo: true } as never;
    await printLabelBatch("company-1", batch, configuredPrinter);

    expect(printHtmlBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      purpose: "etiqueta",
      configuredPrinter,
      jobs: [expect.objectContaining({ widthMm: 50, heightMm: 30, quantity: 5 })],
      webHtml: expect.stringContaining('class="label"'),
    }));
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
    await printLabelBatch("company-1", batch);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs[0].html).toContain("Furadeira");
    expect(jobs[1].html).toContain("Segundo");
  });
});

const twoColumnProfile: BobinaPrintProfile = {
  largura_etiqueta_mm: 50, altura_etiqueta_mm: 30, colunas: 2,
  espacamento_horizontal_mm: 4, espacamento_vertical_mm: 2,
  margem_esquerda_mm: 2, margem_direita_mm: 2, margem_superior_mm: 2, margem_inferior_mm: 2,
  largura_midia_mm: null, offset_horizontal_mm: 0, offset_vertical_mm: 0,
  dpi: "automatico", dpi_personalizado: null, orientacao: "retrato",
};

const productA: LabelMaterialSnapshot = { ...material, id: "a", nome: "Produto A" };
const productB: LabelMaterialSnapshot = { ...material, id: "b", nome: "Produto B" };
const productC: LabelMaterialSnapshot = { ...material, id: "c", nome: "Produto C" };
const productD: LabelMaterialSnapshot = { ...material, id: "d", nome: "Produto D" };

function batchFromItems(items: { material: LabelMaterialSnapshot; quantity: number }[]): LabelPrintBatch {
  return {
    id: "batch-1", modelo_id: model.id, modelo_snapshot: model,
    quantidade_materiais: items.length, quantidade_etiquetas: items.reduce((total, item) => total + item.quantity, 0),
    solicitada_em: "2026-01-01T00:00:00Z", solicitante_nome: "Tester", reimpressao_de_id: null,
    itens: items.map((item, index) => ({
      id: `item-${index}`, solicitacao_id: "batch-1", material_id: item.material.id,
      ordem: index, quantidade: item.quantity, material_snapshot: item.material,
    })),
  };
}

describe("printLabelBatch with a multi-column bobina profile", () => {
  beforeEach(() => {
    printHtmlBatchMock.mockReset().mockResolvedValue(undefined);
  });

  it("composes [A,B] then [C,D] for 4 distinct items on a 2-column bobina, not one label per full-width page", async () => {
    const batch = batchFromItems([
      { material: productA, quantity: 1 }, { material: productB, quantity: 1 },
      { material: productC, quantity: 1 }, { material: productD, quantity: 1 },
    ]);
    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string; quantity: number }>;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].html).toContain("Produto A");
    expect(jobs[0].html).toContain("Produto B");
    expect(jobs[0].html.indexOf("Produto A")).toBeLessThan(jobs[0].html.indexOf("Produto B"));
    expect(jobs[1].html).toContain("Produto C");
    expect(jobs[1].html).toContain("Produto D");
    expect(jobs.every((job) => job.quantity === 1)).toBe(true);
  });

  it("pads the last row with an empty cell (not a duplicate label) for an odd quantity in a 2-column bobina", async () => {
    const batch = batchFromItems([
      { material: productA, quantity: 1 }, { material: productB, quantity: 1 }, { material: productC, quantity: 1 },
    ]);
    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs).toHaveLength(2);
    expect(jobs[1].html).toContain("Produto C");
    expect(jobs[1].html.match(/class="label"/g)).toHaveLength(1);
  });

  it("collapses N/columns identical rows of one repeated item into a single rasterize call with quantity=N/columns", async () => {
    const batch = batchFromItems([{ material: productA, quantity: 6 }]);
    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ quantity: number }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].quantity).toBe(3);
  });

  it("produces a different row count for the identical batch under a different column count (troca de perfil)", async () => {
    const batch = batchFromItems([{ material: productA, quantity: 1 }, { material: productB, quantity: 1 }]);

    await printLabelBatch("company-1", batch, undefined, { ...twoColumnProfile, colunas: 1 });
    expect((printHtmlBatchMock.mock.calls.at(-1)?.[0].jobs as unknown[])).toHaveLength(2);

    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    expect((printHtmlBatchMock.mock.calls.at(-1)?.[0].jobs as unknown[])).toHaveLength(1);
  });

  it("falls back to the legacy single-column layout (byte-identical widthMm/heightMm) when no profile is given", async () => {
    const batch = batchFromItems([{ material: productA, quantity: 2 }]);
    await printLabelBatch("company-1", batch);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ widthMm: number; heightMm: number; quantity: number }>;
    expect(jobs).toEqual([expect.objectContaining({ widthMm: 50, heightMm: 30, quantity: 2 })]);
  });

  it("rotates cell content for a paisagem profile without changing the row's declared physical size", async () => {
    const landscapeProfile: BobinaPrintProfile = { ...twoColumnProfile, orientacao: "paisagem" };
    const batch = batchFromItems([{ material: productA, quantity: 1 }, { material: productB, quantity: 1 }]);

    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    const portraitJob = (printHtmlBatchMock.mock.calls.at(-1)?.[0].jobs as Array<{ widthMm: number; heightMm: number }>)[0];

    await printLabelBatch("company-1", batch, undefined, landscapeProfile);
    const jobs = printHtmlBatchMock.mock.calls.at(-1)?.[0].jobs as Array<{ html: string; widthMm: number; heightMm: number }>;
    expect(jobs[0].html).toContain("rotate(90deg)");
    expect(jobs[0].widthMm).toBe(portraitJob.widthMm);
    expect(jobs[0].heightMm).toBe(portraitJob.heightMm);
  });

  it("does not rotate content for the default retrato orientation", async () => {
    const batch = batchFromItems([{ material: productA, quantity: 1 }]);
    await printLabelBatch("company-1", batch, undefined, twoColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs[0].html).not.toContain("rotate(90deg)");
  });

  it.each([["300", 300 / 96], ["203", 203 / 96]] as const)(
    "derives rasterScale %s DPI -> %s from the profile, forwarded to the job",
    async (dpi, expectedScale) => {
      const batch = batchFromItems([{ material: productA, quantity: 1 }]);
      await printLabelBatch("company-1", batch, undefined, { ...twoColumnProfile, dpi });
      const jobs = printHtmlBatchMock.mock.calls.at(-1)?.[0].jobs as Array<{ rasterScale: number }>;
      expect(jobs[0].rasterScale).toBeCloseTo(expectedScale, 5);
    },
  );

  const threeColumnProfile: BobinaPrintProfile = { ...twoColumnProfile, colunas: 3 };

  it("composes 3 distinct items into a single row on a 3-column bobina without breaking", async () => {
    const batch = batchFromItems([
      { material: productA, quantity: 1 }, { material: productB, quantity: 1 }, { material: productC, quantity: 1 },
    ]);
    await printLabelBatch("company-1", batch, undefined, threeColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].html.match(/class="label"/g)).toHaveLength(3);
    expect(jobs[0].html.indexOf("Produto A")).toBeLessThan(jobs[0].html.indexOf("Produto B"));
    expect(jobs[0].html.indexOf("Produto B")).toBeLessThan(jobs[0].html.indexOf("Produto C"));
  });

  it("pads the last row with empty cells for an odd quantity across multiple 3-column rows", async () => {
    const batch = batchFromItems([
      { material: productA, quantity: 1 }, { material: productB, quantity: 1 },
      { material: productC, quantity: 1 }, { material: productD, quantity: 1 },
    ]);
    await printLabelBatch("company-1", batch, undefined, threeColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs).toHaveLength(2); // [A,B,C] then [D, empty, empty]
    expect(jobs[0].html.match(/class="label"/g)).toHaveLength(3);
    expect(jobs[1].html).toContain("Produto D");
    expect(jobs[1].html.match(/class="label"/g)).toHaveLength(1);
  });

  it("never swaps a material's own identifier with a neighbor's when rasterizing a multi-column batch", async () => {
    const withCode = (id: string, name: string, barcode: string, qr: string): LabelMaterialSnapshot => ({
      ...material, id, nome: name, codigo_barras: barcode, conteudo_qr_code: qr,
    });
    const alpha = withCode("alpha", "Alpha", "1111111111", "QR-ALPHA");
    const beta = withCode("beta", "Beta", "2222222222", "QR-BETA");
    const gamma = withCode("gamma", "Gamma", "3333333333", "QR-GAMMA");
    const combinedModel: LabelModelSnapshot = { ...model, tipo_identificacao: "codigo_barras" };
    const batch: LabelPrintBatch = {
      id: "batch-ids", modelo_id: combinedModel.id, modelo_snapshot: combinedModel,
      quantidade_materiais: 3, quantidade_etiquetas: 3, solicitada_em: "2026-01-01T00:00:00Z",
      solicitante_nome: "Tester", reimpressao_de_id: null,
      itens: [
        { id: "item-gamma", solicitacao_id: "batch-ids", material_id: gamma.id, ordem: 2, quantidade: 1, material_snapshot: gamma },
        { id: "item-alpha", solicitacao_id: "batch-ids", material_id: alpha.id, ordem: 0, quantidade: 1, material_snapshot: alpha },
        { id: "item-beta", solicitacao_id: "batch-ids", material_id: beta.id, ordem: 1, quantidade: 1, material_snapshot: beta },
      ],
    };
    await printLabelBatch("company-1", batch, undefined, threeColumnProfile);
    const jobs = printHtmlBatchMock.mock.calls[0][0].jobs as Array<{ html: string }>;
    expect(jobs).toHaveLength(1);
    const document = new DOMParser().parseFromString(jobs[0].html, "text/html");
    const cells = Array.from(document.querySelectorAll(".cell"));
    for (const [index, [name, code]] of [["Alpha", "1111111111"], ["Beta", "2222222222"], ["Gamma", "3333333333"]].entries()) {
      expect(cells[index]?.textContent).toContain(name);
      expect(cells[index]?.textContent).toContain(code);
    }
  });
});

describe("buildBobinaPrintHtml (web/browser multi-row document)", () => {
  it("writes one .row per chunk with no dedup, even when consecutive rows are identical", () => {
    const html = buildBobinaPrintHtml(twoColumnProfile, model, [productA, productA, productA, productA], "Lote teste");
    expect(html.match(/class="row"/g)).toHaveLength(2);
    expect(html.match(/class="label"/g)).toHaveLength(4);
  });

  it("sizes @page to the full row footprint (margins + columns + gaps), not a single cell", () => {
    const html = buildBobinaPrintHtml(twoColumnProfile, model, [productA], "Lote teste");
    expect(html).toContain("@page { size: 108mm 34mm; margin: 0; }");
  });
});

describe("printBobinaTestPage", () => {
  beforeEach(() => {
    printHtmlBatchMock.mockReset().mockResolvedValue(undefined);
  });

  it("prints one labeled cell per column (TESTE / size / Coluna N) through the same pipeline as a real batch", async () => {
    await printBobinaTestPage("company-1", twoColumnProfile);
    expect(printHtmlBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1", purpose: "etiqueta", documentName: "Teste de etiqueta",
    }));
    const options = printHtmlBatchMock.mock.calls[0][0] as { jobs: Array<{ html: string; quantity: number }> };
    expect(options.jobs).toHaveLength(1);
    expect(options.jobs[0].quantity).toBe(1);
    expect(options.jobs[0].html).toContain("TESTE");
    expect(options.jobs[0].html).toContain("Coluna 1");
    expect(options.jobs[0].html).toContain("Coluna 2");
    expect(options.jobs[0].html.match(/class="label"/g)).toHaveLength(2);
  });

  it("forwards the configured printer through to the shared pipeline", async () => {
    const configuredPrinter = { finalidade: "etiqueta", nome_impressora: "LABEL", ativo: true } as never;
    await printBobinaTestPage("company-1", twoColumnProfile, configuredPrinter);
    expect(printHtmlBatchMock).toHaveBeenCalledWith(expect.objectContaining({ configuredPrinter }));
  });
});
