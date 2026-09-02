import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { saveMaterialMock, generateBarcodeMock, generateQrMock, jsBarcodeMock, toastMock } = vi.hoisted(() => ({
  saveMaterialMock: vi.fn(),
  generateBarcodeMock: vi.fn(),
  generateQrMock: vi.fn(),
  jsBarcodeMock: vi.fn((svg: SVGElement, value: string) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  }),
  toastMock: vi.fn(),
}));

vi.mock("jsbarcode", () => ({
  default: jsBarcodeMock,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/material-service", () => ({
  saveMaterial: saveMaterialMock,
  generateMaterialBarcode: generateBarcodeMock,
  generateMaterialQrCode: generateQrMock,
}));

import { MaterialFormDialog } from "./MaterialFormDialog";
import type { MaterialCategory, MaterialWithRelations } from "@/lib/material-types";

const companyId = "31000000-0000-4000-8000-000000000001";
const materialId = "33000000-0000-4000-8000-000000000001";
const identifier = "34000000-0000-4000-8000-000000000001";
const qrContent = `BACKSTAGE-PRO:MATERIAL:${identifier}`;

const category: MaterialCategory = {
  id: "32000000-0000-4000-8000-000000000001", empresa_id: companyId, nome: "Áudio",
  descricao: null, ativo: true, created_at: "2026-07-30T00:00:00Z", updated_at: "2026-07-30T00:00:00Z",
  created_by: null, updated_by: null,
};

function existingMaterial(overrides: Partial<MaterialWithRelations> = {}): MaterialWithRelations {
  return {
    id: materialId, empresa_id: companyId, categoria_id: category.id, codigo_interno: "0001",
    nome: "LINE ARRAY NEO 210", descricao: null, marca: "TGR", modelo: "NEO 210",
    numero_serie: null, numero_patrimonio: null, codigo_barras: "BSP-A968A4040E074A928FBF",
    identificador_unico: identifier, conteudo_qr_code: qrContent, tipo_identificacao: "ambos",
    status_identificacao: "ativa", identificacao_gerada_em: "2026-09-02T12:00:00Z",
    identificacao_gerada_por: null, tipo_controle: "individual", quantidade: 0,
    quantidade_legada_etapa1: null, estoque_minimo: 0, unidade_medida: "unidade",
    valor_aquisicao: null, valor_reposicao: null, valor_locacao_padrao: null, data_aquisicao: null,
    fornecedor: null, observacoes: null, localizacao: null, status_operacional: "disponivel",
    justificativa_status: null, ativo: true, created_at: "2026-09-02T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z", created_by: null, updated_by: null,
    categoria: category, fotos: [], ...overrides,
  };
}

function renderDialog(options: { material?: MaterialWithRelations | null; canGenerate?: boolean } = {}) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const rendered = render(
    <QueryClientProvider client={new QueryClient()}>
      <MaterialFormDialog
        open onOpenChange={vi.fn()} empresaId={companyId} categories={[category]}
        material={options.material ?? null} canGenerateIdentification={options.canGenerate ?? true}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, onSaved };
}

function fillRequiredNewMaterialFields() {
  fireEvent.change(screen.getByLabelText("Código interno *"), { target: { value: "0001" } });
  fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "LINE ARRAY NEO 210" } });
  fireEvent.click(screen.getAllByRole("combobox")[1]);
  fireEvent.click(screen.getByRole("option", { name: "Áudio" }));
}

function selectIdentificationType(name: "QR Code" | "Código de barras" | "QR Code e código de barras") {
  fireEvent.click(screen.getAllByRole("combobox")[0]);
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("material identification previews", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    saveMaterialMock.mockReset(); generateBarcodeMock.mockReset(); generateQrMock.mockReset(); jsBarcodeMock.mockClear(); toastMock.mockReset();
  });

  it("generates a new numeric barcode server-side and shows its Code 128 preview immediately", async () => {
    saveMaterialMock.mockResolvedValue(existingMaterial({
      codigo_barras: "0000000018", conteudo_qr_code: null, tipo_identificacao: "codigo_barras",
    }));
    renderDialog();
    selectIdentificationType("Código de barras");
    fillRequiredNewMaterialFields();
    expect(screen.getByRole("button", { name: "Gerar código automático" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Gerar código automático" }));

    await waitFor(() => expect(screen.getByTestId("material-barcode-preview")).toBeVisible());
    expect(screen.getByLabelText("Código de barras 0000000018")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^Código de barras/ })).toHaveValue("0000000018");
    expect(jsBarcodeMock).toHaveBeenLastCalledWith(
      expect.any(SVGElement),
      "0000000018",
      expect.objectContaining({ format: "CODE128C" }),
    );
    expect(screen.queryByDisplayValue(/^BSP-/)).not.toBeInTheDocument();
    expect(saveMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      empresaId: companyId, generateBarcode: true, generateQrCode: false,
    }));
    expect(generateBarcodeMock).not.toHaveBeenCalled();
  });

  it("creates a new material through the existing service and shows the immutable QR content", async () => {
    saveMaterialMock.mockResolvedValue(existingMaterial({ codigo_barras: null, tipo_identificacao: "qr_code" }));
    renderDialog();
    fillRequiredNewMaterialFields();
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    await waitFor(() => expect(screen.getByTestId("material-qr-preview")).toBeVisible());
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(`Identificador imutável: ${identifier}`)).toBeVisible();
    expect(saveMaterialMock).toHaveBeenCalledWith(expect.objectContaining({ generateQrCode: true, generateBarcode: false }));
    expect(generateQrMock).not.toHaveBeenCalled();
  });

  it("reuses the persisted material id when finishing after QR generation", async () => {
    saveMaterialMock.mockResolvedValue(existingMaterial({
      codigo_barras: null,
      tipo_identificacao: "qr_code",
    }));
    const { onSaved } = renderDialog();
    fillRequiredNewMaterialFields();

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));
    await waitFor(() => expect(screen.getByTestId("material-qr-preview")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Salvar material" }));

    await waitFor(() => expect(saveMaterialMock).toHaveBeenCalledTimes(2));
    expect(saveMaterialMock.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: materialId,
      generateQrCode: false,
      generateBarcode: false,
    }));
    expect(generateQrMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(materialId));
  });

  it("reuses the persisted draft id when the user finishes after generating a barcode", async () => {
    const generated = existingMaterial({
      codigo_barras: "0000000018", conteudo_qr_code: null, tipo_identificacao: "codigo_barras",
    });
    saveMaterialMock.mockResolvedValue(generated);
    generateQrMock.mockResolvedValue(qrContent);
    const { onSaved } = renderDialog();
    selectIdentificationType("QR Code e código de barras");
    fillRequiredNewMaterialFields();

    fireEvent.click(screen.getByRole("button", { name: "Gerar código automático" }));
    await waitFor(() => expect(screen.getByTestId("material-barcode-preview")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Salvar material" }));

    await waitFor(() => expect(saveMaterialMock).toHaveBeenCalledTimes(2));
    expect(saveMaterialMock.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: materialId,
      generateBarcode: false,
    }));
    expect(generateQrMock).toHaveBeenCalledWith(materialId);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(materialId));
  });

  it("shows existing BSP and QR previews without replacing either identification", () => {
    const current = existingMaterial();
    renderDialog({ material: current });

    expect(screen.getByTestId("material-barcode-preview")).toBeVisible();
    expect(screen.getByLabelText(`Código de barras ${current.codigo_barras}`)).toBeVisible();
    expect(screen.getByTestId("material-qr-preview")).toBeVisible();
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Gerar código automático" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeVisible();
    expect(saveMaterialMock).not.toHaveBeenCalled();
    expect(generateBarcodeMock).not.toHaveBeenCalled();
    expect(generateQrMock).not.toHaveBeenCalled();
  });

  it("copies the displayed barcode and QR content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const current = existingMaterial();
    renderDialog({ material: current });

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar conteúdo do QR" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenNthCalledWith(1, current.codigo_barras);
    expect(writeText).toHaveBeenNthCalledWith(2, qrContent);
  });

  it("preserves manual barcode entry and previews it without calling the automatic generator", () => {
    renderDialog();
    selectIdentificationType("Código de barras");
    const barcodeInput = screen.getByRole("textbox", { name: /^Código de barras/ });

    fireEvent.change(barcodeInput, { target: { value: "MANUAL-123" } });
    expect(screen.getByTestId("material-barcode-preview")).toBeVisible();
    expect(screen.getByLabelText("Código de barras MANUAL-123")).toBeVisible();
    expect(screen.getByRole("button", { name: "Gerar código automático" })).toBeVisible();
    expect(saveMaterialMock).not.toHaveBeenCalled();
    expect(generateBarcodeMock).not.toHaveBeenCalled();
  });

  it("cancels automatic generation and preserves a manually typed barcode", async () => {
    renderDialog();
    selectIdentificationType("Código de barras");
    const barcodeInput = screen.getByRole("textbox", { name: /^Código de barras/ });
    fireEvent.change(barcodeInput, { target: { value: "MANUAL-123" } });

    fireEvent.click(screen.getByRole("button", { name: "Gerar código automático" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/valor manual ainda não persistido/i);
    expect(saveMaterialMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(barcodeInput).toHaveValue("MANUAL-123");
    expect(screen.getByLabelText("Código de barras MANUAL-123")).toBeVisible();
    expect(saveMaterialMock).not.toHaveBeenCalled();
  });

  it("confirms before replacing a manual value with a server-generated barcode", async () => {
    saveMaterialMock.mockResolvedValue(existingMaterial({
      codigo_barras: "0000000018",
      conteudo_qr_code: null,
      tipo_identificacao: "codigo_barras",
    }));
    renderDialog();
    selectIdentificationType("Código de barras");
    fillRequiredNewMaterialFields();
    const barcodeInput = screen.getByRole("textbox", { name: /^Código de barras/ });
    fireEvent.change(barcodeInput, { target: { value: "MANUAL-123" } });

    fireEvent.click(screen.getByRole("button", { name: "Gerar código automático" }));
    expect(saveMaterialMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e gerar" }));

    await waitFor(() => expect(barcodeInput).toHaveValue("0000000018"));
    expect(screen.getByLabelText("Código de barras 0000000018")).toBeVisible();
    expect(saveMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      empresaId: companyId,
      values: expect.objectContaining({ codigo_barras: "" }),
      generateBarcode: true,
      generateQrCode: false,
    }));
    expect(generateBarcodeMock).not.toHaveBeenCalled();
  });

  it("generates only a missing QR for an existing material and keeps its barcode and identifier", async () => {
    const current = existingMaterial({ conteudo_qr_code: null, tipo_identificacao: "ambos" });
    generateQrMock.mockResolvedValue(qrContent);
    renderDialog({ material: current });
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    await waitFor(() => expect(screen.getByTestId("material-qr-preview")).toBeVisible());
    expect(generateQrMock).toHaveBeenCalledWith(materialId);
    expect(generateBarcodeMock).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /^Código de barras/ })).toHaveValue(current.codigo_barras);
    expect(screen.getByText(`Identificador imutável: ${identifier}`)).toBeVisible();
  });

  it("keeps manual barcode entry and disables generation for read-only users", () => {
    renderDialog({ canGenerate: false });
    expect(screen.queryByRole("button", { name: "Gerar código automático" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /^Código de barras/ })).not.toBeInTheDocument();
  });

  it("shows only the QR actions for QR-only identification", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Gerar código automático" })).not.toBeInTheDocument();
    expect(screen.getByTestId("material-qr-card")).toBeVisible();
    expect(screen.queryByTestId("material-barcode-card")).not.toBeInTheDocument();
    expect(screen.getByText("O QR Code e seu conteúdo aparecerão aqui.")).toBeVisible();
  });

  it("shows only barcode actions for barcode-only identification", () => {
    renderDialog();
    selectIdentificationType("Código de barras");

    expect(screen.getByRole("button", { name: "Gerar código automático" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Gerar QR Code" })).not.toBeInTheDocument();
    expect(screen.getByTestId("material-barcode-card")).toBeVisible();
    expect(screen.queryByTestId("material-qr-card")).not.toBeInTheDocument();
    expect(screen.getByText("O código e sua prévia aparecerão aqui.")).toBeVisible();
  });

  it("shows both identification flows when the type is both", () => {
    renderDialog();
    selectIdentificationType("QR Code e código de barras");

    expect(screen.getByRole("button", { name: "Gerar código automático" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeVisible();
    expect(screen.getByTestId("material-identification-cards")).toHaveClass("grid", "lg:grid-cols-2", "min-w-0");
    expect(screen.getByTestId("material-barcode-card")).toHaveClass("min-w-0", "overflow-hidden");
    expect(screen.getByTestId("material-qr-card")).toHaveClass("min-w-0", "overflow-hidden");
  });

  it("shows the generating state inside the QR card and then displays the result", async () => {
    let resolveSave: (material: MaterialWithRelations) => void = () => undefined;
    saveMaterialMock.mockImplementation(() => new Promise<MaterialWithRelations>((resolve) => {
      resolveSave = resolve;
    }));
    renderDialog();
    fillRequiredNewMaterialFields();

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Gerando..." })).toBeDisabled());
    expect(screen.getByTestId("material-qr-card")).toBeVisible();

    resolveSave(existingMaterial({ codigo_barras: null, tipo_identificacao: "qr_code" }));
    await waitFor(() => expect(screen.getByTestId("material-qr-preview")).toBeVisible());
    await waitFor(() => expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeEnabled());
  });

  it("shows a retryable error state inside the QR card", async () => {
    saveMaterialMock.mockRejectedValue(new Error("falha controlada"));
    renderDialog();
    fillRequiredNewMaterialFields();

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível gerar o QR Code");
    expect(screen.getByRole("button", { name: "Gerar QR Code" })).toBeEnabled();
  });

  it("rebuilds an existing QR visually without regenerating its identity", async () => {
    const current = existingMaterial();
    renderDialog({ material: current });

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({
      title: "Visualização do QR Code reconstruída",
    }));
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(`Identificador imutável: ${identifier}`)).toBeVisible();
    expect(generateQrMock).not.toHaveBeenCalled();
    expect(saveMaterialMock).not.toHaveBeenCalled();
  });
});
