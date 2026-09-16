import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Asaas module batches must only be approved/activated by the confirmed
// webhook (see supabase/migrations/20260916100000_asaas_module_batches_webhook_only.sql).
// This suite proves the Master UI never offers the manual approve/reject
// actions for those batches, so it can't even attempt the RPC the backend
// now rejects.
const mocks = vi.hoisted(() => ({
  batchRows: [] as Record<string, unknown>[],
  asaasLinkRows: [] as { related_batch_request_id: string }[],
  asaasLinkError: null as { message: string } | null,
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      switch (table) {
        case "module_batch_requests":
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mocks.batchRows, error: null }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        case "asaas_payments":
          return {
            select: () => ({
              eq: () => ({
                not: () => Promise.resolve({ data: mocks.asaasLinkRows, error: mocks.asaasLinkError }),
              }),
            }),
          };
        case "system_logs":
          return { insert: () => Promise.resolve({ data: null, error: null }) };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

import SolicitacoesLoteModulos from "./SolicitacoesLoteModulos";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SolicitacoesLoteModulos />
    </QueryClientProvider>,
  );
}

function batch(overrides: Record<string, unknown>) {
  return {
    id: "batch-1",
    empresa_id: "company-1",
    status: "pending",
    payment_method: null,
    valor_total: 50,
    observacao: null,
    comprovante_url: null,
    created_at: "2026-09-10T00:00:00Z",
    empresas: { nome_empresa: "Empresa Teste", vencimento: null },
    module_batch_request_items: [
      { id: "item-1", valor: 50, module_catalog: { nome: "RFID" } },
    ],
    ...overrides,
  };
}

describe("SolicitacoesLoteModulos - proteção de lotes Asaas", () => {
  beforeEach(() => {
    mocks.batchRows = [];
    mocks.asaasLinkRows = [];
    mocks.asaasLinkError = null;
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.toast.mockClear();
  });

  it("hides Aprovar/Rejeitar and shows the Asaas badge for a batch created with payment_method asaas", async () => {
    mocks.batchRows = [batch({ id: "batch-asaas-1", payment_method: "asaas" })];

    renderPage();

    expect(await screen.findByText("Empresa Teste")).toBeInTheDocument();
    expect(screen.getByText("Asaas · confirmação automática")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aprovar lote/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rejeitar/i })).not.toBeInTheDocument();
  });

  it("hides Aprovar/Rejeitar for a legacy-shaped batch that is only linked via asaas_payments", async () => {
    mocks.batchRows = [batch({ id: "batch-asaas-2", payment_method: null, status: "paid" })];
    mocks.asaasLinkRows = [{ related_batch_request_id: "batch-asaas-2" }];

    renderPage();

    expect(await screen.findByText("Empresa Teste")).toBeInTheDocument();
    expect(screen.getByText("Asaas · confirmação automática")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aprovar lote/i })).not.toBeInTheDocument();
  });

  it("keeps manual approval working for a batch that is not linked to Asaas", async () => {
    mocks.batchRows = [batch({ id: "batch-manual-1", payment_method: "manual" })];
    mocks.asaasLinkRows = [{ related_batch_request_id: "some-other-batch" }];

    renderPage();

    expect(await screen.findByRole("button", { name: /aprovar lote/i })).toBeInTheDocument();
    expect(screen.queryByText("Asaas · confirmação automática")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /aprovar lote/i }));
    fireEvent.click(await screen.findByRole("button", { name: /aprovar e ativar todos/i }));

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("master_approve_module_batch_request", {
        _batch_request_id: "batch-manual-1",
        _observacao_admin: null,
      }),
    );
  });

  it("shows an error and no batch actions when the Asaas link check fails", async () => {
    mocks.batchRows = [batch({ id: "batch-manual-2", payment_method: "manual" })];
    mocks.asaasLinkError = { message: "network error" };

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível verificar os lotes asaas/i);
    expect(screen.queryByRole("button", { name: /aprovar lote/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Empresa Teste")).not.toBeInTheDocument();
  });
});
