import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "admin_empresa" }),
}));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => true, isLoading: false }),
}));

// Defaults to "web, WhatsApp app available" so every pre-existing test
// below keeps exercising the window.open fallback untouched; only the
// desktop-specific test flips isTauri to true.
const { isTauri, invoke, openUrl } = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(() => Promise.resolve(true)),
  openUrl: vi.fn(),
}));
vi.mock("@/features/update/UpdateService", () => ({ isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { LocacoesReceivablesPanel } from "./LocacoesReceivablesPanel";

const summaryRow = {
  valor_contratado: 300, valor_recebido: 0, valor_a_receber: 300, valor_vencido: 0, valor_pendente_regularizacao: 0,
};

const installmentEntry = {
  id: "lanc-1", empresa_id: "company", origem_tipo: "locacao_material", origem_id: "rental-1",
  cliente_id: "client-1", cliente_nome: "Cliente Um", cliente_nome_fantasia: null,
  tipo: "receita", descricao: "Locação 0001", forma_cobranca: "parcelado",
  valor_original: 300, valor_recebido: 0, valor_estornado: 0, status: "pendente",
  vencimento: null, forma_pagamento: null, observacoes: null, vencido: false,
  requer_revisao_vencimento: false, created_at: "2026-08-01T00:00:00Z",
};

const clientSummary = {
  cliente_id: "client-1", cliente_nome: "Cliente Um", cliente_nome_fantasia: null,
  quantidade_titulos: 1, total_devido: 300, total_vencido: 0, total_pendente_regularizacao: 0,
  proximo_vencimento: null,
};

const rentalFinancialSummary = {
  id: "lanc-1", origem_tipo: "locacao_material", origem_id: "rental-1", cliente_id: "client-1",
  forma_cobranca: "parcelado", valor_original: 300, valor_recebido: 0, valor_estornado: 0,
  status: "pendente", vencimento: null, forma_pagamento: null, requer_revisao_vencimento: false,
  recebimentos: [],
  parcelas: [
    { id: "parcela-paga", lancamento_id: "lanc-1", numero: 1, valor: 150, valor_recebido: 150, valor_estornado: 0, vencimento: "2026-08-01", status: "recebido", recebimentos: [] },
    { id: "parcela-aberta", lancamento_id: "lanc-1", numero: 2, valor: 150, valor_recebido: 0, valor_estornado: 0, vencimento: "2026-09-01", status: "pendente", recebimentos: [] },
  ],
};

function mockRpcByName() {
  rpc.mockImplementation((name: string) => {
    switch (name) {
      case "obter_resumo_financeiro_locacoes":
        return Promise.resolve({ data: [summaryRow], error: null });
      case "listar_contas_receber":
        return Promise.resolve({ data: [{ item: installmentEntry, total_count: 1 }], error: null });
      case "listar_clientes_a_receber":
        return Promise.resolve({ data: [clientSummary], error: null });
      case "obter_financeiro_locacao":
        return Promise.resolve({ data: rentalFinancialSummary, error: null });
      case "registrar_recebimento_locacao":
        return Promise.resolve({ data: { ...rentalFinancialSummary, valor_recebido: 150 }, error: null });
      case "listar_clientes":
        return Promise.resolve({ data: [], error: null });
      default:
        return Promise.resolve({ data: null, error: null });
    }
  });
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocacoesReceivablesPanel empresaId="company" companyReadOnly={false} />
    </QueryClientProvider>,
  );
}

describe("LocacoesReceivablesPanel", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    rpc.mockReset();
    mockRpcByName();
    isTauri.mockReset().mockReturnValue(false);
    invoke.mockReset().mockResolvedValue(true);
    openUrl.mockReset();
  });

  it("lets a parcelado title be received directly, skipping only its already-paid installment", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Receber" }));

    // The already-paid installment (numero 1) must never be offered - only
    // the open one (numero 2) is auto-selected, pending balance and all.
    expect(await screen.findByText(/Parcela 2.*150,00 pendente/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(150);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));

    // Toast rendering needs the app's root <Toaster/>, which this isolated
    // render doesn't mount - the dialog closing is the observable proof
    // the mutation resolved instead of erroring.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Registrar recebimento" })).not.toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith("registrar_recebimento_locacao", expect.objectContaining({
      _locacao_id: "rental-1", _parcela_id: "parcela-aberta", _valor: 150,
    }));
  });

  it("opens a client's open titles from Clientes a receber and routes Receber into the same receipt dialog", async () => {
    renderPanel();

    // Radix Tabs switches the active tab on mousedown, not click - a plain
    // fireEvent.click on the trigger never flips data-state to "active".
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));
    fireEvent.click(await screen.findByText("Cliente Um"));

    expect(await screen.findByText("Títulos em aberto")).toBeInTheDocument();
    const withinReceiptEntry = await screen.findByText("Locação 0001");
    expect(withinReceiptEntry).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Receber" }));

    expect(screen.queryByText("Títulos em aberto")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Registrar recebimento" })).toBeInTheDocument();
  });

  it("highlights próximo vencimento by urgency - vencido, hoje and próximo share the visible cues, normal stays plain", async () => {
    // shouldAdvanceTime keeps real wall-clock progress for setTimeout-based
    // polling (React Query, Testing Library's waitFor/findBy) while still
    // freezing `new Date()`/Date.now() at the value below - without it the
    // fake clock never advances on its own and every findBy times out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z")); // noon in America/Sao_Paulo (UTC-3): 2026-08-10, no day-boundary ambiguity

    const clients = [
      { cliente_id: "c-vencido", cliente_nome: "Vencido Ltda", cliente_nome_fantasia: null, quantidade_titulos: 1, total_devido: 100, total_vencido: 100, total_pendente_regularizacao: 0, proximo_vencimento: "2026-08-05" },
      { cliente_id: "c-hoje", cliente_nome: "Hoje Ltda", cliente_nome_fantasia: null, quantidade_titulos: 1, total_devido: 100, total_vencido: 0, total_pendente_regularizacao: 0, proximo_vencimento: "2026-08-10" },
      { cliente_id: "c-proximo", cliente_nome: "Proximo Ltda", cliente_nome_fantasia: null, quantidade_titulos: 1, total_devido: 100, total_vencido: 0, total_pendente_regularizacao: 0, proximo_vencimento: "2026-08-12" },
      { cliente_id: "c-normal", cliente_nome: "Normal Ltda", cliente_nome_fantasia: null, quantidade_titulos: 1, total_devido: 100, total_vencido: 0, total_pendente_regularizacao: 0, proximo_vencimento: "2026-08-25" },
    ];
    rpc.mockImplementation((name: string) => {
      if (name === "listar_clientes_a_receber") return Promise.resolve({ data: clients, error: null });
      if (name === "obter_resumo_financeiro_locacoes") return Promise.resolve({ data: [summaryRow], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    renderPanel();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));

    expect(await screen.findByText(/05\/08\/2026 · vencido/)).toBeInTheDocument();
    expect(screen.getByText(/10\/08\/2026 · vence hoje/)).toBeInTheDocument();
    expect(screen.getByText(/12\/08\/2026 · próximo/)).toBeInTheDocument();
    // "normal" gets the bare date with no urgency suffix at all.
    expect(screen.getByText("25/08/2026")).toBeInTheDocument();
  });

  it("disables Cobrar no WhatsApp with a clear reason when the client has no phone on file", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "listar_clientes_a_receber") return Promise.resolve({ data: [clientSummary], error: null });
      if (name === "obter_resumo_financeiro_locacoes") return Promise.resolve({ data: [summaryRow], error: null });
      if (name === "listar_clientes") return Promise.resolve({ data: [{ id: "client-1", telefone: null }], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    renderPanel();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));

    const button = await screen.findByRole("button", { name: /Sem telefone/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Cliente sem telefone cadastrado");
  });

  it("builds the WhatsApp message from the same receivables data (no separate financial computation) and opens wa.me, not a paid API", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "listar_clientes_a_receber") return Promise.resolve({ data: [{ ...clientSummary, total_devido: 2000, proximo_vencimento: "2026-10-05" }], error: null });
      if (name === "obter_resumo_financeiro_locacoes") return Promise.resolve({ data: [summaryRow], error: null });
      if (name === "listar_clientes") return Promise.resolve({ data: [{ id: "client-1", telefone: "(11) 99999-8888" }], error: null });
      if (name === "listar_contas_receber") return Promise.resolve({ data: [{ item: { ...installmentEntry, forma_cobranca: "avista", vencimento: "2026-10-05" }, total_count: 1 }], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    renderPanel();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar no WhatsApp" }));

    // toHaveValue does an exact match - it doesn't accept asymmetric
    // matchers like stringContaining, so assert on the raw .value instead.
    // Intl.NumberFormat inserts a non-breaking space after "R$", not a
    // regular one - matching on "2.000,00" alone sidesteps that entirely.
    const textarea = await screen.findByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain("2.000,00"));
    expect(textarea.value).toContain("05/10/2026");

    fireEvent.click(screen.getByRole("button", { name: "Abrir WhatsApp" }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    expect(url).toMatch(/^https:\/\/wa\.me\/5511999998888\?text=/);
    expect(target).toBe("_blank");

    openSpy.mockRestore();
  });

  it("tries the whatsapp:// app protocol first on desktop and never touches window.open when it succeeds", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true); // WhatsApp Desktop registered
    rpc.mockImplementation((name: string) => {
      if (name === "listar_clientes_a_receber") return Promise.resolve({ data: [clientSummary], error: null });
      if (name === "obter_resumo_financeiro_locacoes") return Promise.resolve({ data: [summaryRow], error: null });
      if (name === "listar_clientes") return Promise.resolve({ data: [{ id: "client-1", telefone: "(11) 99999-8888" }], error: null });
      if (name === "listar_contas_receber") return Promise.resolve({ data: [{ item: installmentEntry, total_count: 1 }], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const openSpy = vi.spyOn(window, "open");

    renderPanel();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar no WhatsApp" }));
    await screen.findByRole("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Abrir WhatsApp" }));

    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(openUrl.mock.calls[0][0]).toMatch(/^whatsapp:\/\/send\?phone=5511999998888&text=/);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("falls back to https://wa.me (still via the opener plugin, not window.open) when WhatsApp Desktop isn't registered", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(false); // no app registered for whatsapp://
    rpc.mockImplementation((name: string) => {
      if (name === "listar_clientes_a_receber") return Promise.resolve({ data: [clientSummary], error: null });
      if (name === "obter_resumo_financeiro_locacoes") return Promise.resolve({ data: [summaryRow], error: null });
      if (name === "listar_clientes") return Promise.resolve({ data: [{ id: "client-1", telefone: "(11) 99999-8888" }], error: null });
      if (name === "listar_contas_receber") return Promise.resolve({ data: [{ item: installmentEntry, total_count: 1 }], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const openSpy = vi.spyOn(window, "open");

    renderPanel();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Clientes a receber" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar no WhatsApp" }));
    await screen.findByRole("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Abrir WhatsApp" }));

    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(openUrl.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/5511999998888\?text=/);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
