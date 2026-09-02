import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateBarcodeMock, generateQrMock, replaceBarcodeMock, toastMock } = vi.hoisted(() => ({
  generateBarcodeMock: vi.fn(),
  generateQrMock: vi.fn(),
  replaceBarcodeMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("jsbarcode", () => ({
  default: (svg: SVGElement, value: string) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));
vi.mock("@/lib/material-service", () => ({
  generateMaterialBarcode: generateBarcodeMock,
  generateMaterialQrCode: generateQrMock,
  replaceMaterialBarcode: replaceBarcodeMock,
}));

import { MaterialIdentificationCard } from "./MaterialIdentificationCard";
import type { MaterialCategory, MaterialWithRelations } from "@/lib/material-types";

const companyId = "31000000-0000-4000-8000-000000000001";
const materialId = "33000000-0000-4000-8000-000000000001";
const identifier = "34000000-0000-4000-8000-000000000001";
const qrContent = `BACKSTAGE-PRO:MATERIAL:${identifier}`;

const category: MaterialCategory = {
  id: "32000000-0000-4000-8000-000000000001",
  empresa_id: companyId,
  nome: "Áudio",
  descricao: null,
  ativo: true,
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:00:00Z",
  created_by: null,
  updated_by: null,
};

function materialFixture(
  overrides: Partial<MaterialWithRelations> = {},
): MaterialWithRelations {
  return {
    id: materialId,
    empresa_id: companyId,
    categoria_id: category.id,
    codigo_interno: "0001",
    nome: "LINE ARRAY NEO 210",
    descricao: null,
    marca: "TGR",
    modelo: "NEO 210",
    numero_serie: null,
    numero_patrimonio: null,
    codigo_barras: "BSP-A968A4040E074A928FBF",
    identificador_unico: identifier,
    conteudo_qr_code: qrContent,
    tipo_identificacao: "ambos",
    status_identificacao: "ativa",
    identificacao_gerada_em: "2026-09-02T12:00:00Z",
    identificacao_gerada_por: null,
    tipo_controle: "individual",
    quantidade: 0,
    quantidade_legada_etapa1: null,
    estoque_minimo: 0,
    unidade_medida: "unidade",
    valor_aquisicao: null,
    valor_reposicao: null,
    valor_locacao_padrao: null,
    data_aquisicao: null,
    fornecedor: null,
    observacoes: null,
    localizacao: null,
    status_operacional: "disponivel",
    justificativa_status: null,
    ativo: true,
    created_at: "2026-09-02T12:00:00Z",
    updated_at: "2026-09-02T12:00:00Z",
    created_by: null,
    updated_by: null,
    categoria: category,
    fotos: [],
    ...overrides,
  };
}

function renderCard(
  material = materialFixture(),
  canGenerate = true,
  canPrint = true,
) {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  return {
    onChanged,
    ...render(
      <MemoryRouter>
        <MaterialIdentificationCard
          material={material}
          canGenerate={canGenerate}
          canPrint={canPrint}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    ),
  };
}

describe("MaterialIdentificationCard", () => {
  beforeEach(() => {
    generateBarcodeMock.mockReset();
    generateQrMock.mockReset();
    replaceBarcodeMock.mockReset();
    toastMock.mockReset();
  });

  it("shows and copies an existing QR without changing its technical identifier", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { onChanged } = renderCard();

    expect(screen.getByTitle("QR Code de LINE ARRAY NEO 210")).toBeInTheDocument();
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(identifier)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copiar QR Code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(qrContent));

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "Visualização do QR Code reconstruída",
      }),
    );
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(identifier)).toBeVisible();
    expect(generateQrMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("opens the existing print flow with the persisted material id without generating identification", () => {
    const current = materialFixture();
    renderCard(current);

    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByLabelText(`Código de barras ${current.codigo_barras}`)).toBeVisible();
    expect(screen.getByRole("link", { name: "Imprimir etiqueta" })).toHaveAttribute(
      "href",
      `/etiquetas?material_id=${materialId}`,
    );
    expect(generateQrMock).not.toHaveBeenCalled();
    expect(generateBarcodeMock).not.toHaveBeenCalled();
    expect(replaceBarcodeMock).not.toHaveBeenCalled();
  });

  it("opens the print flow without generating a missing identification", () => {
    const current = materialFixture({
      codigo_barras: null,
      conteudo_qr_code: qrContent,
      tipo_identificacao: "qr_code",
    });
    renderCard(current);

    expect(screen.getByRole("link", { name: "Imprimir etiqueta" })).toHaveAttribute(
      "href",
      `/etiquetas?material_id=${materialId}`,
    );
    expect(screen.getByText("Não informado")).toBeVisible();
    expect(generateQrMock).not.toHaveBeenCalled();
    expect(generateBarcodeMock).not.toHaveBeenCalled();
  });

  it("generates a missing QR through the server and updates the preview immediately", async () => {
    generateQrMock.mockResolvedValue(qrContent);
    const current = materialFixture({
      conteudo_qr_code: null,
      tipo_identificacao: "qr_code",
    });
    const { onChanged } = renderCard(current);

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR Code" }));

    await waitFor(() => expect(screen.getByText(qrContent)).toBeVisible());
    expect(screen.getByTitle("QR Code de LINE ARRAY NEO 210")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imprimir etiqueta" })).toHaveAttribute(
      "href",
      `/etiquetas?material_id=${materialId}`,
    );
    expect(generateQrMock).toHaveBeenCalledWith(materialId);
    expect(generateBarcodeMock).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText(identifier)).toBeVisible();
  });

  it("renders and copies a legacy BSP barcode without automatic replacement", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const current = materialFixture();
    renderCard(current);

    expect(screen.getByTestId("material-identification-barcode-preview")).toBeVisible();
    expect(screen.getByLabelText(`Código de barras ${current.codigo_barras}`)).toBeVisible();
    expect(screen.getAllByText(current.codigo_barras!)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Gerar código de barras" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Substituir código de barras" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Copiar código de barras" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(current.codigo_barras),
    );
    expect(generateBarcodeMock).not.toHaveBeenCalled();
  });

  it("cancels a legacy BSP replacement and keeps the previous barcode", async () => {
    const current = materialFixture();
    renderCard(current);

    fireEvent.click(
      screen.getByRole("button", { name: "Substituir código de barras" }),
    );
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(
      screen.getByText(/etiquetas físicas antigas podem deixar de corresponder/i),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(`Código de barras ${current.codigo_barras}`)).toBeVisible();
    expect(replaceBarcodeMock).not.toHaveBeenCalled();
  });

  it("confirms replacement server-side and preserves QR and technical identifier", async () => {
    replaceBarcodeMock.mockResolvedValue("0000000026");
    const current = materialFixture();
    const { onChanged } = renderCard(current);

    fireEvent.click(
      screen.getByRole("button", { name: "Substituir código de barras" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar substituição" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Código de barras 0000000026")).toBeVisible(),
    );
    expect(replaceBarcodeMock).toHaveBeenCalledWith(materialId);
    expect(generateBarcodeMock).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(identifier)).toBeVisible();
    expect(screen.getByTitle("QR Code de LINE ARRAY NEO 210")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imprimir etiqueta" })).toHaveAttribute(
      "href",
      `/etiquetas?material_id=${materialId}`,
    );
  });

  it("keeps the previous barcode when server-side replacement fails", async () => {
    replaceBarcodeMock.mockRejectedValue(new Error("replacement failed"));
    const current = materialFixture({ codigo_barras: "0000000018" });
    const { onChanged } = renderCard(current);

    fireEvent.click(
      screen.getByRole("button", { name: "Substituir código de barras" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar substituição" }),
    );

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Não foi possível substituir o código de barras",
        variant: "destructive",
      })),
    );
    expect(screen.getByLabelText("Código de barras 0000000018")).toBeVisible();
    expect(screen.getByText(qrContent)).toBeVisible();
    expect(screen.getByText(identifier)).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("generates a missing numeric barcode only through the server and previews it", async () => {
    generateBarcodeMock.mockResolvedValue("0000000018");
    const current = materialFixture({
      codigo_barras: null,
      tipo_identificacao: "qr_code",
    });
    const { onChanged } = renderCard(current);

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar código de barras" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Código de barras 0000000018")).toBeVisible(),
    );
    expect(screen.getAllByText("0000000018")).toHaveLength(2);
    expect(generateBarcodeMock).toHaveBeenCalledWith(materialId);
    expect(generateQrMock).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps existing identifications read-only when generation is not allowed", () => {
    renderCard(materialFixture(), false);

    expect(screen.getByTitle("QR Code de LINE ARRAY NEO 210")).toBeInTheDocument();
    expect(screen.getByTestId("material-identification-barcode-preview")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Gerar QR Code" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gerar código de barras" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Substituir código de barras" }),
    ).not.toBeInTheDocument();
  });

  it("hides the print action without label-print permission", () => {
    renderCard(materialFixture(), true, false);

    expect(
      screen.queryByRole("link", { name: "Imprimir etiqueta" }),
    ).not.toBeInTheDocument();
  });
});
