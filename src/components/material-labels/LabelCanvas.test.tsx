import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Same shim as material-label-print.test.tsx: JsBarcode measures text via a
// real canvas 2D context that jsdom doesn't provide.
vi.mock("jsbarcode", () => ({
  default: (svg: SVGElement, value: string, options?: { displayValue?: boolean }) => {
    if (options?.displayValue === false) return;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  },
}));

import { LabelCanvas } from "./LabelCanvas";
import { renderLabelMarkup } from "@/lib/material-label-print";
import type { LabelMaterialSnapshot, LabelModelSnapshot } from "@/lib/material-label-types";

const baseModel: LabelModelSnapshot = {
  id: "model-1", nome: "Padrão", largura_mm: 60, altura_mm: 40, tipo_identificacao: "qr_code",
  campos: ["nome", "codigo_interno"], tamanho_fonte: 10, mostrar_borda: false,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5, versao: 1,
};

const material: LabelMaterialSnapshot = {
  id: "material-1", nome: "Furadeira", codigo_interno: "FUR-001", categoria: "Ferramentas",
  marca: null, modelo: null, numero_serie: null, numero_patrimonio: null, localizacao: null,
  empresa: "Empresa X", identificador_unico: "uuid-1", conteudo_qr_code: "QR-1", codigo_barras: "789000123",
};

function article(container: HTMLElement) {
  return container.querySelector("article.label")!;
}

describe("LabelCanvas", () => {
  it("renders through the exact same function used for real printing (renderLabelMarkup)", () => {
    const model: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "ambos" };
    const { container } = render(<LabelCanvas model={model} material={material} />);

    // Parse renderLabelMarkup's own output through the same DOM round-trip
    // instead of comparing to its raw string, so this only fails if the
    // rendered content actually differs - not because of HTML serialization
    // quirks (e.g. self-closing tags) that parsing-then-reserializing can
    // introduce on either side.
    const reference = document.createElement("div");
    reference.innerHTML = renderLabelMarkup(model, material);

    expect(article(container).outerHTML).toBe(reference.querySelector("article.label")!.outerHTML);
  });

  it("QR model: renders the material's QR content, no barcode text and no missing-identification marker", () => {
    const { container } = render(<LabelCanvas model={baseModel} material={material} />);
    const el = article(container);
    expect(el.querySelector("svg")).toBeTruthy();
    expect(el.querySelector("text")).toBeFalsy(); // JsBarcode's shim always adds a <text>; QRCodeSVG never does
    expect(el.querySelector(".codes-missing")).toBeFalsy();
  });

  it("an existing QR-only model (created before Code128/combined existed) keeps working exactly as before", () => {
    // Same shape a model row saved under the original QR-only feature would
    // still have today - nothing about it changed, no migration was needed.
    const legacyModel: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "qr_code", versao: 1 };
    const { container } = render(<LabelCanvas model={legacyModel} material={material} />);
    expect(article(container).querySelector("svg")).toBeTruthy();
    expect(article(container).querySelector("text")).toBeFalsy();
  });

  it("Code 128 model: renders a real barcode built from codigo_barras, no QR", () => {
    const model: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "codigo_barras" };
    const { container } = render(<LabelCanvas model={model} material={material} />);
    const el = article(container);
    const svgs = el.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(el.querySelector("text")?.textContent).toBe(material.codigo_barras);
  });

  it("combined model: renders both QR and Code 128 with no overlap-causing layout (each capped on its own axis)", () => {
    const model: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "ambos" };
    const { container } = render(<LabelCanvas model={model} material={material} />);
    const el = article(container);
    expect(el.querySelectorAll("svg")).toHaveLength(2);
    expect(el.querySelector("text")?.textContent).toBe(material.codigo_barras);
    const codes = el.querySelector(".codes") as HTMLElement;
    expect(codes.children).toHaveLength(2);
  });

  it("material without codigo_barras under a Code 128 model shows a clear, safe marker instead of inventing a value", () => {
    const model: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "codigo_barras" };
    const materialWithoutBarcode: LabelMaterialSnapshot = { ...material, codigo_barras: null };
    const { container } = render(<LabelCanvas model={model} material={materialWithoutBarcode} />);
    const el = article(container);
    expect(el.querySelector("svg")).toBeFalsy();
    expect(el.querySelector(".codes-missing")?.textContent).toBe("Sem identificação");
  });

  it("material without conteudo_qr_code under a QR model shows the same safe marker, never a fabricated QR", () => {
    const materialWithoutQr: LabelMaterialSnapshot = { ...material, conteudo_qr_code: null };
    const { container } = render(<LabelCanvas model={baseModel} material={materialWithoutQr} />);
    const el = article(container);
    expect(el.querySelector("svg")).toBeFalsy();
    expect(el.querySelector(".codes-missing")?.textContent).toBe("Sem identificação");
  });

  it("preserves the material's identifying value verbatim - never substitutes the internal UUID for the barcode", () => {
    const model: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "codigo_barras" };
    const { container } = render(<LabelCanvas model={model} material={material} />);
    const text = article(container).querySelector("text")?.textContent;
    expect(text).toBe(material.codigo_barras);
    expect(text).not.toBe(material.identificador_unico);
  });

  it("scopes its injected <style> per instance so two previews on the same page never leak .codes rules into each other", () => {
    const wideModel: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "ambos", largura_mm: 100, altura_mm: 30 };
    const tallModel: LabelModelSnapshot = { ...baseModel, tipo_identificacao: "ambos", largura_mm: 40, altura_mm: 60 };
    // Both instances mounted in the *same* tree/root, like they would be if
    // this component were ever reused in a list - two separate render()
    // calls (two separate roots) each start their own useId() counter and
    // would misleadingly collide, which isn't the scenario being guarded.
    const { container } = render(
      <>
        <LabelCanvas model={wideModel} material={material} />
        <LabelCanvas model={tallModel} material={material} />
      </>,
    );
    const [firstRoot, secondRoot] = Array.from(container.children) as HTMLElement[];
    const firstStyle = firstRoot.querySelector("style")!.textContent!;
    const secondStyle = secondRoot.querySelector("style")!.textContent!;
    expect(firstRoot.id).not.toBe(secondRoot.id);
    expect(firstStyle).toContain("flex-direction: row");
    expect(secondStyle).toContain("flex-direction: column");
    expect(secondStyle).not.toContain(firstRoot.id);
    expect(firstStyle).not.toContain(secondRoot.id);
  });
});
