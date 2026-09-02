import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  search: vi.fn(),
  models: vi.fn(),
  history: vi.fn(),
  indicators: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "admin_empresa", empresaId: "company-a", empresaNome: "Empresa A", empresaReadOnly: false, isMasterAdmin: false }) }));
vi.mock("@/hooks/useCompanyModules", () => ({ useCompanyModules: () => ({ hasModule: () => true, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/material-labels/LabelModelDialog", () => ({ LabelModelDialog: () => null }));
vi.mock("@/components/material-labels/LabelPrintDialog", () => ({
  LabelPrintDialog: ({ open, items }: { open: boolean; items: Array<{ material: LabelMaterial }> }) =>
    open ? (
      <div data-testid="label-print-dialog">
        {items.map(({ material: item }) => (
          <div key={item.id}>
            <span>{item.codigo_barras}</span>
            <span>{item.conteudo_qr_code}</span>
          </div>
        ))}
      </div>
    ) : null,
}));
vi.mock("@/lib/material-label-service", () => ({
  resolveLabelMaterialById: mocks.resolve,
  searchLabelMaterials: mocks.search,
  listLabelModels: mocks.models,
  listLabelPrintHistory: mocks.history,
  getLabelIndicators: mocks.indicators,
  archiveLabelModel: vi.fn(),
}));

import Etiquetas from "./Etiquetas";
import type { LabelMaterial, LabelModel } from "@/lib/material-label-types";

const material: LabelMaterial = {
  id: "11bd7b83-dc2f-43aa-8a4d-73f1d0388a51", nome: "line array", codigo_interno: "0003", categoria: "Áudio",
  marca: null, modelo: null, numero_serie: null, numero_patrimonio: null, localizacao: null,
  identificador_unico: "technical-uuid", tipo_identificacao: "qr_code", status_identificacao: "ativa",
  conteudo_qr_code: "BACKSTAGE-PRO:MATERIAL:technical-uuid", codigo_barras: null, ativo: true,
  ultima_impressao_em: null, total_impresso: 0, updated_at: "2026-08-17T00:00:00Z",
};
const model: LabelModel = {
  id: "model", empresa_id: "company-a", nome: "Padrão", descricao: null, largura_mm: 60, altura_mm: 40,
  tipo_identificacao: "qr_code", campos: ["nome", "codigo_interno"], tamanho_fonte: 10, mostrar_borda: false,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5, padrao: true, ativo: true, versao: 1,
  created_at: "2026-08-17T00:00:00Z", updated_at: "2026-08-17T00:00:00Z",
};

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Etiquetas /></MemoryRouter></QueryClientProvider>);
}

describe("Etiquetas structured material navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ status: "found", material });
    mocks.search.mockResolvedValue([material]);
    mocks.models.mockResolvedValue([model]);
    mocks.history.mockResolvedValue({ items: [], total: 0 });
    mocks.indicators.mockResolvedValue({ modelos_ativos: 1, materiais_identificados: 1, solicitacoes_hoje: 0, etiquetas_hoje: 0 });
  });

  it("resolves material 0003 by id, shows its readable code and adds it to the batch", async () => {
    renderPage(`/etiquetas?material_id=${material.id}`);

    expect(await screen.findByText("0003 - line array foi adicionado ao lote.")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("Buscar materiais");
    expect(search).toHaveValue("0003");
    expect(search).not.toHaveValue(material.id);
    expect(screen.getByText("1 material(is) · 1 etiqueta(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selecionado" })).toBeDisabled();
    expect(mocks.resolve).toHaveBeenCalledWith("company-a", material.id);
  });

  it("keeps the normal manual search independent from the route id", async () => {
    renderPage(`/etiquetas?material_id=${material.id}`);
    const search = await screen.findByPlaceholderText("Buscar materiais");
    await waitFor(() => expect(search).toHaveValue("0003"));
    fireEvent.change(search, { target: { value: "cabo" } });
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith("company-a", "cabo"));
  });

  it("passes the current persisted QR and barcode to the existing print dialog", async () => {
    const currentMaterial: LabelMaterial = {
      ...material,
      tipo_identificacao: "ambos",
      codigo_barras: "0000000026",
    };
    const currentModel: LabelModel = {
      ...model,
      tipo_identificacao: "ambos",
    };
    mocks.resolve.mockResolvedValue({ status: "found", material: currentMaterial });
    mocks.search.mockResolvedValue([currentMaterial]);
    mocks.models.mockResolvedValue([currentModel]);
    renderPage(`/etiquetas?material_id=${material.id}`);

    expect(await screen.findByText("0003 - line array foi adicionado ao lote.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar lote" }));

    expect(screen.getByTestId("label-print-dialog")).toBeVisible();
    expect(screen.getByText("0000000026")).toBeVisible();
    expect(screen.getByText(material.conteudo_qr_code!)).toBeVisible();
  });

  it("shows a safe fallback for an invalid structured parameter", async () => {
    mocks.resolve.mockResolvedValue({ status: "not_found" });
    renderPage("/etiquetas?material_id=invalid");
    expect(await screen.findByText("Material solicitado não encontrado nesta empresa. Use a busca manual.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Buscar materiais")).toHaveValue("");
  });

  it("explains that an inactive material cannot be added", async () => {
    mocks.resolve.mockResolvedValue({ status: "inactive", id: material.id, code: "0003", name: "line array" });
    renderPage(`/etiquetas?material_id=${material.id}`);
    expect(await screen.findByText("O material 0003 - line array está inativo e não pode ser adicionado ao lote.")).toBeInTheDocument();
    expect(screen.queryByText(/Resumo do lote/)).not.toBeInTheDocument();
  });
});
