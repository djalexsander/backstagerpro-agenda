import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  empresa: {
    nome_empresa: "Empresa Teste",
    cpf_cnpj: "12345678909",
  } as { nome_empresa: string; cpf_cnpj: string | null },
  updates: [] as Array<Record<string, unknown>>,
  updateTargets: [] as Array<[string, unknown]>,
  invoke: vi.fn(),
  toast: vi.fn(),
}));

function chargeResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    payment_id: "internal-payment-1",
    asaas_payment_id: "pay_asaas_1",
    resource_id: PLAN_ID,
    amount: 99.9,
    pix_qr_code: "asaas-base64-image",
    pix_copy_paste: "000201-pix-returned-by-asaas",
    invoice_url: "https://sandbox.asaas.com/i/invoice-1",
    billing_type: "PIX",
    ...overrides,
  };
}

type TestJsonResponseReader = {
  json: () => Promise<unknown>;
  clone?: () => TestJsonResponseReader;
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    empresaId: "company-1",
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useSystemSettings", () => ({
  usePlatformBranding: () => ({ platformLogoUrl: null, platformName: "Backstage Pro" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "planos") {
        const plan = {
          id: PLAN_ID,
          nome: "Plano Mensal",
          valor: 99.9,
          periodicidade: "mensal",
        };
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          single: () => Promise.resolve({ data: plan, error: null }),
        };
        return chain;
      }

      if (table === "empresas") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: mocks.empresa, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            mocks.updates.push(payload);
            return {
              eq: (column: string, value: unknown) => {
                mocks.updateTargets.push([column, value]);
                return {
                  select: () => ({
                    maybeSingle: () => Promise.resolve({
                      data: { id: "company-1", cpf_cnpj: payload.cpf_cnpj },
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    functions: {
      invoke: (...args: unknown[]) => mocks.invoke(...args),
    },
  },
}));

import PagamentoPlano from "./PagamentoPlano";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/pagamento-plano/${PLAN_ID}`]}>
        <Routes>
          <Route path="/pagamento-plano/:planoId" element={<PagamentoPlano />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function confirmPlan() {
  const confirmButton = await screen.findByRole("button", { name: "Confirmar escolha do plano" });
  await waitFor(() => expect(confirmButton).toBeEnabled());
  fireEvent.click(confirmButton);
  return screen.findByRole("button", { name: "Gerar cobrança PIX" });
}

function createChargeCalls() {
  return mocks.invoke.mock.calls.filter(([functionName]) => functionName === "create-asaas-charge");
}

describe("PagamentoPlano - CPF/CNPJ da cobrança", () => {
  beforeEach(() => {
    mocks.empresa = { nome_empresa: "Empresa Teste", cpf_cnpj: "12345678909" };
    mocks.updates = [];
    mocks.updateTargets = [];
    mocks.toast.mockReset();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      if (functionName === "create-asaas-charge") {
        return Promise.resolve({ data: chargeResponse(), error: null });
      }
      throw new Error(`unexpected function: ${functionName}`);
    });
  });

  it("carrega o documento persistido com máscara apenas visual", async () => {
    renderPage();

    expect(await screen.findByDisplayValue("123.456.789-09")).toBeInTheDocument();
  });

  it("salva somente dígitos e limita o update à empresa autenticada", async () => {
    renderPage();

    const input = await screen.findByLabelText("CPF ou CNPJ");
    fireEvent.change(input, { target: { value: "11.222.333/0001-81" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar CPF/CNPJ" }));

    await waitFor(() => expect(mocks.updates).toEqual([{ cpf_cnpj: "11222333000181" }]));
    expect(mocks.updateTargets).toEqual([["id", "company-1"]]);
  });

  it("bloqueia a cobrança sem CPF/CNPJ válido e salvo", async () => {
    mocks.empresa = { nome_empresa: "Empresa Teste", cpf_cnpj: null };
    renderPage();

    const generateButton = await confirmPlan();
    expect(generateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("CPF ou CNPJ"), {
      target: { value: "123.456.789-09" },
    });
    expect(generateButton).toBeDisabled();
    expect(createChargeCalls()).toHaveLength(0);
  });
});

describe("PagamentoPlano - cobrança inicial Asaas", () => {
  beforeEach(() => {
    mocks.empresa = { nome_empresa: "Empresa Teste", cpf_cnpj: "12345678909" };
    mocks.updates = [];
    mocks.updateTargets = [];
    mocks.toast.mockReset();
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: chargeResponse(), error: null });
    });
  });

  it("invoca create-asaas-charge enviando somente plano_id", async () => {
    renderPage();

    fireEvent.click(await confirmPlan());

    await waitFor(() => expect(createChargeCalls()).toHaveLength(1));
    expect(createChargeCalls()[0]).toEqual([
      "create-asaas-charge",
      { body: { plano_id: PLAN_ID } },
    ]);
  });

  it("exibe exclusivamente os dados PIX retornados pelo Asaas", async () => {
    renderPage();

    fireEvent.click(await confirmPlan());

    expect(await screen.findByText("000201-pix-returned-by-asaas")).toBeInTheDocument();
    expect(screen.getByAltText("QR Code PIX gerado pelo Asaas")).toHaveAttribute(
      "src",
      "data:image/png;base64,asaas-base64-image",
    );
    expect(screen.getByText((text) => text.replace(/\u00a0/g, " ") === "R$ 99,90")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir cobrança no Asaas/i })).toHaveAttribute(
      "href",
      "https://sandbox.asaas.com/i/invoice-1",
    );
  });

  it("mostra o erro devolvido pela Edge Function", async () => {
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("Asaas indisponível") });
    });
    renderPage();

    fireEvent.click(await confirmPlan());

    expect(await screen.findByRole("alert")).toHaveTextContent("Asaas indisponível");
  });

  it("não cria fallback quando QR Code e copia e cola estão ausentes", async () => {
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({
        data: chargeResponse({ pix_qr_code: null, pix_copy_paste: null }),
        error: null,
      });
    });
    renderPage();

    fireEvent.click(await confirmPlan());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "o Asaas não retornou os dados PIX completos",
    );
    expect(screen.queryByAltText("QR Code PIX gerado pelo Asaas")).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="api.qrserver.com"]')).not.toBeInTheDocument();
  });

  it("impede chamadas duplicadas enquanto a cobrança está sendo gerada", async () => {
    let resolveCharge!: (result: { data: ReturnType<typeof chargeResponse>; error: null }) => void;
    const pendingCharge = new Promise<{ data: ReturnType<typeof chargeResponse>; error: null }>((resolve) => {
      resolveCharge = resolve;
    });
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return pendingCharge;
    });
    renderPage();

    const generateButton = await confirmPlan();
    fireEvent.click(generateButton);
    fireEvent.click(generateButton);

    await waitFor(() => expect(createChargeCalls()).toHaveLength(1));
    await act(async () => resolveCharge({ data: chargeResponse(), error: null }));
    expect(await screen.findByText("000201-pix-returned-by-asaas")).toBeInTheDocument();
  });

  it("trava novas tentativas quando o backend informa cobrança ativa existente", async () => {
    const errorContext: TestJsonResponseReader = {
      json: () => Promise.resolve({ error: "An active charge already exists for this plan" }),
    };
    errorContext.clone = () => errorContext;
    mocks.invoke.mockImplementation((functionName: string) => {
      if (functionName === "choose-plan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "Edge Function returned a non-2xx status code", context: errorContext },
      });
    });
    renderPage();

    fireEvent.click(await confirmPlan());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Já existe uma cobrança ativa para este plano");
    const generateButton = screen.getByRole("button", { name: "Gerar cobrança PIX" });
    expect(generateButton).toBeDisabled();
    fireEvent.click(generateButton);
    expect(createChargeCalls()).toHaveLength(1);
  });
});
