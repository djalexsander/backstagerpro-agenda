import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MODULE_A = "11111111-1111-4111-8111-111111111111";
const MODULE_B = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  payments: [] as Array<Record<string, unknown>>,
  invoke: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  refreshProfile: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const catalog = [
  { id: MODULE_A, nome: "Módulo A", feature_key: "module_a", valor: 10, periodicidade: "mensal", ativo: true, ordem: 1, descricao: null, is_capacity_module: false },
  { id: MODULE_B, nome: "Módulo B", feature_key: "module_b", valor: 20, periodicidade: "mensal", ativo: true, ordem: 2, descricao: null, is_capacity_module: false },
];

function chargeResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    payment_id: "payment-1",
    asaas_payment_id: "pay_asaas_1",
    amount: 77.5,
    pix_qr_code: "asaas-image-base64",
    pix_copy_paste: "pix-copia-e-cola-asaas",
    invoice_url: "https://sandbox.asaas.com/i/invoice-1",
    renewal_competence: "2026-10-01",
    module_ids: [MODULE_A, MODULE_B],
    ...overrides,
  };
}

function storedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    empresa_id: "company-1",
    payment_type: "renewal",
    status: "pending",
    activation_status: "pending",
    amount: 77.5,
    asaas_payment_id: "pay_asaas_1",
    pix_qr_code: "stored-asaas-image",
    pix_copy_paste: "stored-asaas-pix",
    invoice_url: "https://sandbox.asaas.com/i/stored-invoice",
    metadata: { renewal_competence: "2026-10-01" },
    related_module_id: null,
    created_at: "2026-09-16T12:00:00Z",
    ...overrides,
  };
}

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ empresaId: "company-1", refreshProfile: mocks.refreshProfile }),
}));

vi.mock("@/hooks/useSubscriptionSummary", () => ({
  useSubscriptionSummary: () => ({
    isLoading: false,
    planoBase: { id: "plan-1", nome: "Plano Mensal", valor: 50, descricao: null, periodicidade: "mensal" },
    valorBase: 50,
    valorModulos: 0,
    valorTotal: 50,
    capabilities: { maxEventos: 10, maxUsuarios: 5 },
    vencimento: "2026-10-01T12:00:00Z",
    trialExpiresAt: null,
    isOnTrial: false,
    isLifetime: false,
    isExpired: false,
    isReadOnly: false,
    needsPlanSelection: false,
  }),
}));

vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    catalog,
    activeModules: [],
    allModules: [],
    moduleDependencies: [],
    isLoading: false,
  }),
}));

vi.mock("@/lib/subscription-license", () => ({
  ensureSingleCommercialBasePlan: (plans: unknown[]) => plans,
  getCustomerPlanPresentation: () => ({
    name: "Plano Mensal", type: "Mensal", chargeLabel: "Mensal", status: "Ativo",
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => mocks.from(table),
    functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    storage: { from: () => { throw new Error("manual receipt upload is forbidden"); } },
  },
}));

import PlanoAssinatura from "./PlanoAssinatura";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(
    <QueryClientProvider client={queryClient}><PlanoAssinatura /></QueryClientProvider>,
  ), queryClient };
}

async function selectBatch() {
  fireEvent.click(await screen.findByText("Módulo A"));
  fireEvent.click(screen.getByText("Módulo B"));
  fireEvent.click(screen.getByRole("button", { name: "Comprar módulos" }));
  return screen.getByRole("dialog");
}

describe("PlanoAssinatura - cobranças Asaas", () => {
  beforeEach(() => {
    mocks.payments = [];
    mocks.invoke.mockReset().mockResolvedValue({ data: chargeResponse(), error: null });
    mocks.rpc.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
    mocks.refreshProfile.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.from.mockReset().mockImplementation((table: string) => {
      const rows = table === "asaas_payments" ? mocks.payments
        : table === "planos" ? [{ id: "plan-1", nome: "Plano Mensal", valor: 50, periodicidade: "mensal" }]
        : [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        in: () => chain,
        order: () => Promise.resolve({ data: rows, error: null }),
        single: () => Promise.resolve({ data: { id: "company-1", nome_empresa: "Empresa Teste", plano_id: "plan-1" }, error: null }),
        insert: (...args: unknown[]) => mocks.insert(...args),
        update: (...args: unknown[]) => mocks.update(...args),
      };
      return chain;
    });
  });

  it("renova com somente tipo_cobranca e mostra PIX, valor e competência do Asaas", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("create-asaas-charge", {
      body: { tipo_cobranca: "renewal" },
    }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("R$ 77.50")).toBeInTheDocument();
    expect(within(dialog).getByText("Competência: 2026-10-01")).toBeInTheDocument();
    expect(within(dialog).getByText("pix-copia-e-cola-asaas")).toBeInTheDocument();
    expect(within(dialog).getByAltText("QR Code PIX do Asaas")).toHaveAttribute("src", "data:image/png;base64,asaas-image-base64");
    expect(within(dialog).getByRole("link", { name: /Abrir cobrança no Asaas/ })).toHaveAttribute("href", "https://sandbox.asaas.com/i/invoice-1");
    expect(mocks.invoke.mock.calls[0][1]).toEqual({ body: { tipo_cobranca: "renewal" } });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("prepara um único lote com dois IDs sem enviar valor e sem limpar a seleção antes do sucesso", async () => {
    let resolveCharge!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { resolveCharge = resolve; }));
    renderPage();
    const dialog = await selectBatch();
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar cobrança PIX" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenCalledWith("create-asaas-charge", {
      body: { modulo_ids: [MODULE_A, MODULE_B] },
    });
    expect(within(dialog).getByText("Módulo A")).toBeInTheDocument();
    expect(within(dialog).getByText("Módulo B")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Preparando cobrança/ })).toBeDisabled();

    resolveCharge({ data: chargeResponse(), error: null });
    const pixDialog = await screen.findByRole("dialog", { name: /PIX Asaas/ });
    expect(within(pixDialog).getByText("R$ 77.50")).toBeInTheDocument();
    expect(within(pixDialog).getByText("pix-copia-e-cola-asaas")).toBeInTheDocument();
    expect(within(pixDialog).getByAltText("QR Code PIX do Asaas")).toHaveAttribute("src", "data:image/png;base64,asaas-image-base64");
    expect(within(pixDialog).getByRole("link", { name: /Abrir cobrança no Asaas/ })).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("impede duplo clique enquanto a cobrança está sendo preparada", async () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    renderPage();
    const button = await screen.findByRole("button", { name: "Pagar Mensalidade" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  });

  it("reabre a cobrança de renovação já preparada sem chamar a Edge Function novamente", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Pagar Mensalidade" });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(button);
    expect(within(await screen.findByRole("dialog")).getByText("pix-copia-e-cola-asaas")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("impede envio concorrente do mesmo lote pelo usuário", async () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    renderPage();
    const dialog = await selectBatch();
    const button = within(dialog).getByRole("button", { name: "Gerar cobrança PIX" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  });

  it("reabre cobrança de renovação existente após rejeição idempotente do backend", async () => {
    mocks.payments = [storedPayment()];
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "An active renewal charge already exists for this competence" } });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("stored-asaas-pix")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("reabre o mesmo lote existente, independentemente da ordem dos IDs", async () => {
    mocks.payments = [storedPayment({
      payment_type: "modules",
      metadata: { module_ids: [MODULE_B, MODULE_A] },
    })];
    renderPage();
    const dialog = await selectBatch();
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar cobrança PIX" }));
    const pixDialog = await screen.findByRole("dialog", { name: /PIX Asaas/ });
    expect(within(pixDialog).getByText("stored-asaas-pix")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("não cria outra cobrança enquanto um lote existente aguarda vinculação ao Asaas", async () => {
    mocks.payments = [storedPayment({
      payment_type: "modules",
      asaas_payment_id: null,
      metadata: { module_ids: [MODULE_A, MODULE_B] },
    })];
    renderPage();
    const dialog = await selectBatch();
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar cobrança PIX" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/já está sendo preparada/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("permite reabrir o PIX de um lote pendente pelo histórico após recarregar a tela", async () => {
    mocks.payments = [storedPayment({
      payment_type: "modules",
      metadata: { module_ids: [MODULE_A, MODULE_B] },
    })];
    const { queryClient } = renderPage();
    await waitFor(() => expect(queryClient.getQueryData(["asaas-payments", "company-1"])).toEqual(mocks.payments));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Pagamentos Módulos" }), { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pagamentos Módulos" })).toHaveAttribute("data-state", "active"));
    expect(await screen.findByText("Lote Asaas — R$ 77.50")).toBeInTheDocument();
    const reopen = await screen.findByRole("button", { name: "Ver PIX" });
    fireEvent.click(reopen);
    const dialog = await screen.findByRole("dialog", { name: /PIX Asaas/ });
    expect(within(dialog).getByText("stored-asaas-pix")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(["renewal", "modules"] as const)("mostra erro e não cria fallback quando o PIX %s vem incompleto", async (kind) => {
    mocks.invoke.mockResolvedValue({ data: chargeResponse({ pix_qr_code: null, pix_copy_paste: null }), error: null });
    renderPage();
    if (kind === "renewal") {
      fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));
    } else {
      const dialog = await selectBatch();
      fireEvent.click(within(dialog).getByRole("button", { name: "Gerar cobrança PIX" }));
    }
    const dialog = await screen.findByRole("dialog", { name: kind === "renewal" ? /Renovação via Asaas/ : /PIX Asaas/ });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/não retornou QR Code/);
    expect(within(dialog).queryByAltText("QR Code PIX do Asaas")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Copiar PIX" })).not.toBeInTheDocument();
  });

  it.each(["renewal", "modules"] as const)("mostra erro da Edge Function no fluxo %s", async (kind) => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "Falha de rede" } });
    renderPage();
    if (kind === "renewal") {
      fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    } else {
      const dialog = await selectBatch();
      fireEvent.click(within(dialog).getByRole("button", { name: "Gerar cobrança PIX" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Falha de rede");
    }
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("só reflete confirmação observada no banco e não ativa a assinatura no frontend", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Aguardando confirmação do Asaas/)).toBeInTheDocument();
    expect(mocks.refreshProfile).not.toHaveBeenCalled();

    mocks.payments = [storedPayment({ activation_status: "completed", status: "received" })];
    fireEvent.click(within(dialog).getByRole("button", { name: "Atualizar status" }));
    expect(await within(dialog).findByText(/Pagamento confirmado pelo Asaas/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalledTimes(1));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("atualiza o perfil quando a confirmação do banco chega com o PIX fechado", async () => {
    const { queryClient } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Pagar Mensalidade" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    queryClient.setQueryData(["asaas-payments", "company-1"], [
      storedPayment({ activation_status: "completed", status: "received" }),
    ]);
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalledTimes(1));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
