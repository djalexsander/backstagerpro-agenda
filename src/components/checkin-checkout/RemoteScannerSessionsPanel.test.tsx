import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteScannerSessionsPanel } from "./RemoteScannerSessionsPanel";
import {
  endScannerRemotoSession,
  listScannerRemotoReads,
  listScannerRemotoSessions,
} from "@/lib/scanner-remoto-service";
import type { ScannerRemotoSessao } from "@/lib/scanner-remoto-types";

vi.mock("@/lib/scanner-remoto-service", () => ({
  listScannerRemotoSessions: vi.fn(),
  listScannerRemotoReads: vi.fn(),
  endScannerRemotoSession: vi.fn(),
  startScannerRemotoSession: vi.fn(),
  registerScannerRemotoRead: vi.fn(),
}));
// Realtime plumbing has its own coverage (useCompanyRealtime.test.tsx) - here
// it only needs to not connect.
vi.mock("@/hooks/useCompanyRealtime", () => ({
  useCompanyRealtime: vi.fn(() => ({ status: "connected" })),
}));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

function session(
  overrides: Partial<ScannerRemotoSessao> & { id: string; titulo: string },
): ScannerRemotoSessao {
  return {
    empresa_id: "company-1",
    tipo_operacao: "misto",
    responsavel_tipo: null,
    responsavel_id: null,
    finalidade: null,
    condicao: "bom",
    localizacao_origem_id: null,
    localizacao_destino_id: null,
    referencia_tipo: null,
    referencia_id: null,
    observacao: null,
    status: "aberta",
    criado_por: "user-1",
    aberta_em: "2026-09-01T10:00:00Z",
    encerrada_em: null,
    encerrada_por: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RemoteScannerSessionsPanel companyId="company-1" />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listScannerRemotoReads).mockResolvedValue([]);
});

describe("RemoteScannerSessionsPanel - finalizar sessão pela lista", () => {
  it("shows a 'Finalizar' action next to each open session", async () => {
    vi.mocked(listScannerRemotoSessions).mockResolvedValue([
      session({ id: "s1", titulo: "Load-out A" }),
      session({ id: "s2", titulo: "Load-in B" }),
    ]);

    renderPanel();

    expect(await screen.findByText("Load-out A")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Finalizar" })).toHaveLength(2);
  });

  it("confirming finalization removes the session from the list and toasts success", async () => {
    vi.mocked(listScannerRemotoSessions)
      .mockResolvedValueOnce([
        session({ id: "s1", titulo: "Load-out A" }),
        session({ id: "s2", titulo: "Load-in B" }),
      ])
      .mockResolvedValue([session({ id: "s2", titulo: "Load-in B" })]);
    vi.mocked(endScannerRemotoSession).mockResolvedValue(
      session({ id: "s1", titulo: "Load-out A", status: "encerrada" }),
    );

    renderPanel();
    await screen.findByText("Load-out A");

    fireEvent.click(screen.getAllByRole("button", { name: "Finalizar" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));

    // Reuses the existing service (encerrar_sessao_scanner_remoto) with the id.
    await waitFor(() =>
      expect(endScannerRemotoSession).toHaveBeenCalledWith("company-1", "s1"),
    );
    await waitFor(() => expect(screen.queryByText("Load-out A")).not.toBeInTheDocument());
    expect(screen.getByText("Load-in B")).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith({ title: "Sessão finalizada" });
  });

  it("on failure keeps the session in the list and reports the error", async () => {
    vi.mocked(listScannerRemotoSessions).mockResolvedValue([
      session({ id: "s1", titulo: "Load-out A" }),
    ]);
    vi.mocked(endScannerRemotoSession).mockRejectedValue(new Error("Sessão já encerrada"));

    renderPanel();
    await screen.findByText("Load-out A");

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Sessão já encerrada" }),
      ),
    );
    expect(screen.getByText("Load-out A")).toBeInTheDocument();
  });

  it("does not read or clear session reads when finalizing", async () => {
    vi.mocked(listScannerRemotoSessions)
      .mockResolvedValueOnce([session({ id: "s1", titulo: "Load-out A" })])
      .mockResolvedValue([]);
    vi.mocked(endScannerRemotoSession).mockResolvedValue(
      session({ id: "s1", titulo: "Load-out A", status: "encerrada" }),
    );

    renderPanel();
    await screen.findByText("Load-out A");

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() => expect(endScannerRemotoSession).toHaveBeenCalledTimes(1));
    // listScannerRemotoReads is only for the expandable reads view - never
    // touched by finalization, and there is no "delete reads" call at all.
    expect(listScannerRemotoReads).not.toHaveBeenCalled();
  });
});
