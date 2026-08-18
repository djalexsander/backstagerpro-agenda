import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useScannerRemoto } from "./useScannerRemoto";
import {
  listScannerRemotoReads,
  listScannerRemotoSessions,
  registerScannerRemotoRead,
  startScannerRemotoSession,
} from "@/lib/scanner-remoto-service";
import { useCompanyRealtime } from "@/hooks/useCompanyRealtime";
import type { ScannerRemotoLeitura, ScannerRemotoSessao } from "@/lib/scanner-remoto-types";

vi.mock("@/lib/scanner-remoto-service", () => ({
  listScannerRemotoSessions: vi.fn().mockResolvedValue([]),
  listScannerRemotoReads: vi.fn().mockResolvedValue([]),
  startScannerRemotoSession: vi.fn(),
  registerScannerRemotoRead: vi.fn(),
  endScannerRemotoSession: vi.fn(),
}));

// Realtime plumbing (channels, postgres_changes) has its own dedicated
// coverage in useCompanyRealtime.test.tsx - here it only matters that this
// hook asks for the right domains under the right enabled/companyId state.
vi.mock("@/hooks/useCompanyRealtime", () => ({
  useCompanyRealtime: vi.fn(() => ({ status: "connected" })),
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useScannerRemoto", () => {
  it("subscribes to its two realtime domains, disabled when the caller passes enabled: false", () => {
    const { wrapper } = createWrapper();

    renderHook(() => useScannerRemoto({ companyId: "company-1", enabled: false }), { wrapper });

    expect(useCompanyRealtime).toHaveBeenCalledWith(null, [
      "scanner_remoto_sessoes",
      "scanner_remoto_leituras",
    ]);
  });

  it("refetches sessions and reads after starting a session", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(startScannerRemotoSession).mockResolvedValue({
      id: "session-1",
    } as ScannerRemotoSessao);

    const { result } = renderHook(
      () => useScannerRemoto({ companyId: "company-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(listScannerRemotoSessions).toHaveBeenCalledWith("company-1", true));

    await result.current.startSession({
      tipoOperacao: "misto",
      condicao: "bom",
      clientUuid: "client-uuid-1",
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["scanner-remoto-sessoes", "company-1"]);
    expect(invalidatedKeys).toContainEqual(["scanner-remoto-leituras", "company-1"]);
  });

  it("resolves normally (not a rejection) for a rejected/unmatched scan", async () => {
    const { wrapper } = createWrapper();
    vi.mocked(registerScannerRemotoRead).mockResolvedValue({
      id: "read-1",
      acao_executada: "nao_encontrado",
      resultado: { mensagem: "Nenhum material corresponde a este código." },
    } as ScannerRemotoLeitura);

    const { result } = renderHook(
      () => useScannerRemoto({ companyId: "company-1", sessaoId: "session-1", enabled: true }),
      { wrapper },
    );

    const read = await result.current.registerRead({
      sessaoId: "session-1",
      codigoLido: "unknown-code",
      clientUuid: "client-uuid-2",
    });

    expect(read.acao_executada).toBe("nao_encontrado");
    expect(registerScannerRemotoRead).toHaveBeenCalledWith("company-1", {
      sessaoId: "session-1",
      codigoLido: "unknown-code",
      clientUuid: "client-uuid-2",
    });
  });

  it("loads a specific session's reads when sessaoId is provided", async () => {
    const { wrapper } = createWrapper();
    vi.mocked(listScannerRemotoReads).mockResolvedValue([
      { id: "read-1", acao_executada: "checkout" } as ScannerRemotoLeitura,
    ]);

    const { result } = renderHook(
      () => useScannerRemoto({ companyId: "company-1", sessaoId: "session-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.reads).toHaveLength(1));
    expect(listScannerRemotoReads).toHaveBeenCalledWith("company-1", "session-1");
  });
});
