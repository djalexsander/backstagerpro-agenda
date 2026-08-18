import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastMock,
  isDesktopRuntimeMock,
  getConfiguredPrinterMock,
  listPrinterConfigsMock,
  listBobinaProfilesMock,
  registerLabelPrintBatchMock,
  printLabelBatchMock,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  isDesktopRuntimeMock: vi.fn(),
  getConfiguredPrinterMock: vi.fn(),
  listPrinterConfigsMock: vi.fn(),
  listBobinaProfilesMock: vi.fn(),
  registerLabelPrintBatchMock: vi.fn(),
  printLabelBatchMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/printer-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/printer-service")>()),
  isDesktopRuntime: isDesktopRuntimeMock,
  getConfiguredPrinter: getConfiguredPrinterMock,
  listPrinterConfigs: listPrinterConfigsMock,
}));
// resolveBobinaProfile is left real (pure, no side effects) - only the RPC
// call is mocked, same "mock the lowest boundary" approach as printer-service above.
vi.mock("@/lib/bobina-profile-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bobina-profile-service")>()),
  listBobinaProfiles: listBobinaProfilesMock,
}));
vi.mock("@/lib/material-label-service", () => ({ registerLabelPrintBatch: registerLabelPrintBatchMock }));
// renderLabelMarkup/buildLabelContentCss are left real (pure, no side
// effects) - LabelCanvas's on-screen preview now calls them directly (same
// function as the real print path, see material-label-print.tsx), so a full
// module mock would break the preview. Only printLabelBatch, the actual
// GDI/iframe dispatch, is mocked - same "mock the lowest boundary" approach
// as bobina-profile-service below.
vi.mock("@/lib/material-label-print", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/material-label-print")>()),
  printLabelBatch: printLabelBatchMock,
}));

import { LabelPrintDialog } from "./LabelPrintDialog";
import type { BobinaProfile } from "@/lib/bobina-profile-types";
import type { LabelBatchSelection, LabelMaterial, LabelModel, LabelPrintBatch } from "@/lib/material-label-types";
import type { PrinterConfig } from "@/lib/printer-types";
import { clearTerminalPrinterOverride, saveTerminalPrinterOverride } from "@/lib/terminal-printer-config";

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

function renderDialog(overrides?: Partial<{
  onPrinted: () => Promise<void>; onOpenChange: (open: boolean) => void;
  model: LabelModel; items: LabelBatchSelection[];
}>) {
  const onPrinted = overrides?.onPrinted ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = overrides?.onOpenChange ?? vi.fn();
  const rendered = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LabelPrintDialog
        open
        onOpenChange={onOpenChange}
        companyId="company-1"
        companyName="Empresa X"
        model={overrides?.model ?? model}
        items={overrides?.items ?? items}
        onPrinted={onPrinted}
      />
    </QueryClientProvider>,
  );
  return { onPrinted, onOpenChange, unmount: rendered.unmount };
}

function clickPrint() {
  fireEvent.click(screen.getByRole("button", { name: /registrar lote e imprimir/i }));
}

function labelPrinterConfig(profileId: string | null, printerName = "LABEL-COMPANY"): PrinterConfig {
  return {
    id: "printer-config-1", empresa_id: "company-1", finalidade: "etiqueta",
    nome_impressora: printerName, formato: "50x30mm", largura_mm: 50, altura_mm: 30,
    orientacao: "retrato", ativo: true, configuracoes: {}, perfil_bobina_padrao_id: profileId,
  };
}

function saveLocalLabelProfile(profileId: string, printerName = "LABEL-LOCAL") {
  saveTerminalPrinterOverride("company-1", "etiqueta", {
    printerName, format: "50x30mm", widthMm: 50, heightMm: 30,
    orientation: "retrato", bobinaProfileId: profileId,
  });
}

describe("LabelPrintDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.mockReset();
    isDesktopRuntimeMock.mockReset();
    getConfiguredPrinterMock.mockReset();
    listPrinterConfigsMock.mockReset().mockResolvedValue([]);
    listBobinaProfilesMock.mockReset().mockResolvedValue([]);
    registerLabelPrintBatchMock.mockReset().mockResolvedValue(fakeRecord);
    printLabelBatchMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("web: registers the batch and delegates to the canonical iframe print flow", async () => {
    isDesktopRuntimeMock.mockReturnValue(false);
    renderDialog();

    clickPrint();

    // No printer config / bobina profile exists in these fixtures, so the
    // resolved profile is null - printLabelBatch falls back to
    // legacyProfileFromModel internally, same as before this feature existed.
    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, undefined, null));
    expect(registerLabelPrintBatchMock).toHaveBeenCalledWith("company-1", expect.objectContaining({ model, items }));
    expect(getConfiguredPrinterMock).not.toHaveBeenCalled();
  });

  it("desktop: shows a specific error and never registers the batch when no printer is configured for etiqueta", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    getConfiguredPrinterMock.mockRejectedValue(new Error("Nenhuma impressora de etiquetas configurada. Configure em Configurações > Impressoras."));
    renderDialog();

    clickPrint();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/Nenhuma impressora de etiquetas configurada/) }),
      ),
    );
    expect(registerLabelPrintBatchMock).not.toHaveBeenCalled();
    expect(printLabelBatchMock).not.toHaveBeenCalled();
  });

  it("desktop: registers the batch, then sends it straight to the configured printer with no popup and no window.open", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    const configuredPrinter = { finalidade: "etiqueta", nome_impressora: "LABEL", ativo: true };
    getConfiguredPrinterMock.mockResolvedValue(configuredPrinter);
    const { onPrinted, onOpenChange } = renderDialog();

    clickPrint();

    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, configuredPrinter, null));
    expect(registerLabelPrintBatchMock).toHaveBeenCalledWith("company-1", expect.objectContaining({ model, items }));
    await waitFor(() => expect(onPrinted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("desktop: reuses the same client_uuid across retries after a failed print, instead of registering a duplicate", async () => {
    isDesktopRuntimeMock.mockReturnValue(true);
    getConfiguredPrinterMock.mockResolvedValue({ finalidade: "etiqueta", nome_impressora: "LABEL", ativo: true });
    printLabelBatchMock.mockRejectedValueOnce(new Error("Não foi possível enviar a etiqueta para a impressora."));
    renderDialog();

    clickPrint();
    await waitFor(() => expect(registerLabelPrintBatchMock).toHaveBeenCalledTimes(1));
    const firstUuid = registerLabelPrintBatchMock.mock.calls[0][1].clientUuid;

    clickPrint();
    await waitFor(() => expect(registerLabelPrintBatchMock).toHaveBeenCalledTimes(2));
    const secondUuid = registerLabelPrintBatchMock.mock.calls[1][1].clientUuid;

    expect(secondUuid).toBe(firstUuid);
  });

  it("blocks printing and shows a clear warning when a batch item lacks the identifier the model needs", async () => {
    isDesktopRuntimeMock.mockReturnValue(false);
    // Etiquetas.tsx normally can't produce this combination (it blocks
    // adding a material the *currently selected* model can't identify), but
    // switching models after items were already added isn't retroactive -
    // this is exactly that gap, exercised directly against the dialog.
    const barcodeOnlyModel: LabelModel = { ...model, tipo_identificacao: "codigo_barras" };
    const materialWithoutBarcode: LabelMaterial = { ...material, codigo_barras: null };
    renderDialog({ model: barcodeOnlyModel, items: [{ material: materialWithoutBarcode, quantity: 1 }] });

    expect(await screen.findByRole("alert")).toHaveTextContent(/código de barras/i);
    expect(screen.getByRole("button", { name: /registrar lote e imprimir/i })).toBeDisabled();

    clickPrint();

    expect(registerLabelPrintBatchMock).not.toHaveBeenCalled();
    expect(printLabelBatchMock).not.toHaveBeenCalled();
  });
});

function bobinaProfile(overrides: Partial<BobinaProfile> = {}): BobinaProfile {
  return {
    id: "profile-1", empresa_id: "company-1", nome: "50x30 - 2 colunas",
    largura_etiqueta_mm: 50, altura_etiqueta_mm: 30, colunas: 2,
    espacamento_horizontal_mm: 4, espacamento_vertical_mm: 2,
    margem_esquerda_mm: 2, margem_direita_mm: 2, margem_superior_mm: 2, margem_inferior_mm: 2,
    orientacao: "retrato", largura_midia_mm: null, offset_horizontal_mm: 0, offset_vertical_mm: 0,
    dpi: "automatico", dpi_personalizado: null, padrao: false, ativo: true, updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("LabelPrintDialog bobina profile resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.mockReset();
    isDesktopRuntimeMock.mockReset().mockReturnValue(false);
    getConfiguredPrinterMock.mockReset();
    registerLabelPrintBatchMock.mockReset().mockResolvedValue(fakeRecord);
    printLabelBatchMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("resolves the profile linked to the etiqueta printer config and forwards it to printLabelBatch", async () => {
    const linked = bobinaProfile({ id: "profile-linked" });
    listPrinterConfigsMock.mockResolvedValue([labelPrinterConfig("profile-linked")]);
    listBobinaProfilesMock.mockResolvedValue([bobinaProfile({ id: "profile-other", padrao: true }), linked]);
    renderDialog();

    await screen.findByText(/50x30 - 2 colunas/);
    clickPrint();

    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, undefined, linked));
  });

  it("falls back to the company's default profile when the printer has none linked yet", async () => {
    const defaultProfile = bobinaProfile({ id: "profile-default", padrao: true });
    listPrinterConfigsMock.mockResolvedValue([labelPrinterConfig(null)]);
    listBobinaProfilesMock.mockResolvedValue([defaultProfile]);
    renderDialog();

    await screen.findByText(/50x30 - 2 colunas/);
    clickPrint();

    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, undefined, defaultProfile));
  });

  it("shows the bobina's layout preview (columns from the resolved profile), not the old one-card-per-material grid", async () => {
    listPrinterConfigsMock.mockResolvedValue([labelPrinterConfig("profile-1")]);
    listBobinaProfilesMock.mockResolvedValue([bobinaProfile()]);
    renderDialog();

    expect(await screen.findByText(/Layout na bobina — 50x30 - 2 colunas/)).toBeInTheDocument();
    // items = [{ material: Furadeira, quantity: 2 }] -> flattened to 2 identical cells on a 2-column bobina, i.e. one row.
    // Scoped to the preview grid itself: LabelCanvas's separate "Conteúdo
    // da etiqueta" sample also renders the material's name as a field.
    const grid = await screen.findByTestId("bobina-preview");
    expect(within(grid).getAllByText("Furadeira")).toHaveLength(2);
  });

  it("uses this terminal's local bobina profile for both preview and the real desktop batch", async () => {
    const companyProfile = bobinaProfile({ id: "profile-company", nome: "Bobina empresa", padrao: true });
    const localProfile = bobinaProfile({ id: "profile-local", nome: "Bobina terminal", colunas: 3 });
    const localPrinter = labelPrinterConfig("profile-local", "LABEL-LOCAL");
    saveLocalLabelProfile("profile-local");
    isDesktopRuntimeMock.mockReturnValue(true);
    getConfiguredPrinterMock.mockResolvedValue(localPrinter);
    listPrinterConfigsMock.mockResolvedValue([labelPrinterConfig("profile-company")]);
    listBobinaProfilesMock.mockResolvedValue([companyProfile, localProfile]);
    renderDialog();

    expect(await screen.findByText(/Layout na bobina .* Bobina terminal/)).toBeInTheDocument();
    clickPrint();

    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, localPrinter, localProfile));
  });

  it("lets two terminal-local selections resolve different profiles without changing the company fallback", async () => {
    const companyProfile = bobinaProfile({ id: "profile-company", nome: "Bobina empresa", padrao: true });
    const terminalAProfile = bobinaProfile({ id: "profile-a", nome: "Bobina terminal A" });
    const terminalBProfile = bobinaProfile({ id: "profile-b", nome: "Bobina terminal B" });
    const companyConfig = labelPrinterConfig("profile-company");
    listPrinterConfigsMock.mockResolvedValue([companyConfig]);
    listBobinaProfilesMock.mockResolvedValue([companyProfile, terminalAProfile, terminalBProfile]);
    isDesktopRuntimeMock.mockReturnValue(true);

    saveLocalLabelProfile("profile-a", "LABEL-A");
    const printerA = labelPrinterConfig("profile-a", "LABEL-A");
    getConfiguredPrinterMock.mockResolvedValueOnce(printerA);
    const first = renderDialog();
    expect(await screen.findByText(/Layout na bobina .* Bobina terminal A/)).toBeInTheDocument();
    clickPrint();
    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, printerA, terminalAProfile));
    first.unmount();

    saveLocalLabelProfile("profile-b", "LABEL-B");
    const printerB = labelPrinterConfig("profile-b", "LABEL-B");
    getConfiguredPrinterMock.mockResolvedValueOnce(printerB);
    renderDialog();
    expect(await screen.findByText(/Layout na bobina .* Bobina terminal B/)).toBeInTheDocument();
    clickPrint();
    await waitFor(() => expect(printLabelBatchMock).toHaveBeenCalledWith("company-1", fakeRecord, printerB, terminalBProfile));

    clearTerminalPrinterOverride("company-1", "etiqueta");
    expect(companyConfig.perfil_bobina_padrao_id).toBe("profile-company");
  });
});
