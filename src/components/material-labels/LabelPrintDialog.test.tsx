import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastMock,
  isDesktopRuntimeMock,
  listPrinterConfigsMock,
  registerLabelPrintBatchMock,
  openLabelPrintWindowMock,
  printLabelBatchDesktopMock,
  printLabelRequestMock,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  isDesktopRuntimeMock: vi.fn(),
  listPrinterConfigsMock: vi.fn(),
  registerLabelPrintBatchMock: vi.fn(),
  openLabelPrintWindowMock: vi.fn(),
  printLabelBatchDesktopMock: vi.fn(),
  printLabelRequestMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/printer-service", () => ({
  isDesktopRuntime: isDesktopRuntimeMock,
  listPrinterConfigs: listPrinterConfigsMock,
}));
vi.mock("@/lib/material-label-service", () => ({ registerLabelPrintBatch: registerLabelPrintBatchMock }));
vi.mock("@/lib/material-label-print", () => ({
  openLabelPrintWindow: openLabelPrintWindowMock,
  printLabelBatchDesktop: printLabelBatchDesktopMock,
  printLabelRequest: printLabelRequestMock,
}));

import { LabelPrintDialog } from "./LabelPrintDialog";
import type { LabelBatchSelection, LabelMaterial, LabelModel, LabelPrintBatch } from "@/lib/material-label-types";

const model: LabelModel = {
  id: "model-1", empresa_id: "company-1", nome: "Padrão", descricao: null,
  largura_mm: 50, altura_mm: 30, tipo_identificacao: "qr_code",
  campos: ["nome", "codigo_interno"], tamanho_fonte: 10, mostrar_borda: false,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5, padrao: true, ativo: true,
  versao: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

const material: LabelMaterial = {
  id: "material-1", nome: "Furadeira", codigo_interno: "FUR-001", categoria: "Ferramentas",
  marca: null, modelo: null, numero_serie: null, numero_patrimonio: null, localizacao: null,
  identificador_unico: "uuid-1", tipo_identificacao: "qr_code", status_identificacao: "ativa",
  conteudo_qr_code: "QR-1", codigo_barras: null, ativo: true, ultima_impressao_em: null,
  total_impresso: 0, updated_at: "2026-01-01T00:00:00Z",
};

const items: LabelBatchSelection[] = [{ material, quantity: 2 }];

const fakeRecord: LabelPrintBatch = {
  id: "batch-1", modelo_id: model.id, modelo_snapshot: {
    id: model.id, nome: model.nome, largura_mm: model.largura_mm, altura_mm: model.altura_mm,
    tipo_identificacao: model.tipo_identificacao, campos: model.campos, tamanho_fonte: model.tamanho_fonte,
    mostrar_borda: model.mostrar_borda, margem_interna_mm: model.margem_interna_mm,
    espacamento_interno_mm: model.espacamento_interno_mm, versao: model.versao,
  },
  quantidade_materiais: 1, quantidade_etiquetas: 2, solicitada_em: "2026-01-01T00:00:00Z",
  solicitante_nome: "Tester", reimpressao_de_id: null,
  itens: [{
    id: "item-1", solicitacao_id: "batch-1", material_id: material.id, ordem: 0, quantidade: 2,
    material_snapshot: {
      id: material.id, nome: material.nome, codigo_interno: material.codigo_interno, categoria: material.categoria,
      marca: material.marca, modelo: material.modelo, numero_serie: material.numero_serie,
      numero_patrimonio: material.numero_patrimonio, localizacao: material.localizacao, empresa: "Empresa X",
      identificador_unico: material.identificador_unico, conteudo_qr_code: material.conteudo_qr_code,
      codigo_barras: material.codigo_barras,
    },
  }],
};

function renderDialog(overrides?: Partial<{ onPrinted: () => Promise<void>; onOpenChange: (open: boolean) => void }>) {
  const onPrinted = overrides?.onPrinted ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = overrides?.onOpenChange ?? vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LabelPrintDialog
        open
        onOpenChange={onOpenChange}
        companyId="company-1"
        companyName="Empresa X"
        model={model}
        items={items}
        onPrinted={onPrinted}
      />
    </QueryClientProvider>,
  );
  return { onPrinted, onOpenChange };
}

function clickPrint() {
  fireEvent.click(screen.getByRole("button", { name: /registrar lote e imprimir/i }));
}

describe("LabelPrintDialog", () => {
  beforeEach(() => {
    toastMock.mockReset();
    isDesktopRuntimeMock.mockReset();
    listPrinterConfigsMock.mockReset();
    registerLabelPrintBatchMock.mockReset().mockResolvedValue(fakeRecord);
    openLabelPrintWindowMock.mockReset();
    printLabelBatchDesktopMock.mockReset().mockResolvedValue(undefined);
    printLabelRequestMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("web: shows the popup-blocked message and never registers the batch when window.open is blocked", async () => {
    isDesktopRuntimeMock.mockReturnValue(false);
    openLabelPrintWindowMock.mockReturnValue(null);
    renderDialog();

    clickPrint();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Não foi possível imprimir", description: expect.stringMatching(/navegador bloqueou/i) }),
      ),
    );
    expect(registerLabelPrintBatchMock).not.toHaveBeenCalled();
  });

  it("web: registers the batch and prints into the already-open popup, never touching the desktop bridge", async () => {
    isDesktopRuntimeMock.mockReturnValue(false);
    const popup = { close: vi.fn() } as unknown as Window;
    openLabelPrintWindowMock.mockReturnValue(popup);
    renderDialog();

    clickPrint();

    await waitFor(() => expect(printLabelRequestMock).toHaveBeenCalledWith(fakeRecord, popup));
    expect(registerLabelPrintBatchMock).toHaveBeenCalledWith("company-1", expect.objectContaining({ model, items }));
    expect(listPrinterConfigsMock).not.toHaveBeenCalled();
    expect(printLabelBatchDesktopMock).not.toHaveBeenCalled();
  });

  it("desktop: shows a specific error and never registers the batch when no printer is configured for etiqueta", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    listPrinterConfigsMock.mockResolvedValue([{ finalidade: "cupom", nome_impressora: "POS-80" }]);
    renderDialog();

    clickPrint();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/Nenhuma impressora de etiquetas configurada/) }),
      ),
    );
    expect(registerLabelPrintBatchMock).not.toHaveBeenCalled();
    expect(printLabelBatchDesktopMock).not.toHaveBeenCalled();
  });

  it("desktop: registers the batch, then sends it straight to the configured printer with no popup and no window.open", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    listPrinterConfigsMock.mockResolvedValue([{ finalidade: "etiqueta", nome_impressora: "LABEL" }]);
    const { onPrinted, onOpenChange } = renderDialog();

    clickPrint();

    await waitFor(() => expect(printLabelBatchDesktopMock).toHaveBeenCalledWith("LABEL", fakeRecord));
    expect(registerLabelPrintBatchMock).toHaveBeenCalledWith("company-1", expect.objectContaining({ model, items }));
    expect(openLabelPrintWindowMock).not.toHaveBeenCalled();
    expect(printLabelRequestMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onPrinted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("desktop: reuses the same client_uuid across retries after a failed print, instead of registering a duplicate", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    listPrinterConfigsMock.mockResolvedValue([{ finalidade: "etiqueta", nome_impressora: "LABEL" }]);
    printLabelBatchDesktopMock.mockRejectedValueOnce(new Error("Não foi possível enviar a etiqueta para a impressora."));
    renderDialog();

    clickPrint();
    await waitFor(() => expect(registerLabelPrintBatchMock).toHaveBeenCalledTimes(1));
    const firstUuid = registerLabelPrintBatchMock.mock.calls[0][1].clientUuid;

    clickPrint();
    await waitFor(() => expect(registerLabelPrintBatchMock).toHaveBeenCalledTimes(2));
    const secondUuid = registerLabelPrintBatchMock.mock.calls[1][1].clientUuid;

    expect(secondUuid).toBe(firstUuid);
  });
});
