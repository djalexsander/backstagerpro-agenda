import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    role: "admin_empresa",
    empresaId: "company-1",
    empresaReadOnly: false,
    isMasterAdmin: false,
  }),
}));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => true, isLoading: false }),
}));
// This page's own camera lifecycle is covered by MaterialQrScanner.test.tsx.
// Here the scanner is replaced by a trigger button so the test can focus on
// what CheckinCheckout does with a detected code, not on camera internals.
vi.mock("@/components/materials/MaterialQrScanner", () => ({
  MaterialQrScanner: ({
    open,
    onDetected,
  }: {
    open: boolean;
    onDetected: (code: string) => void;
  }) =>
    open ? (
      <button onClick={() => onDetected("  BACKSTAGE-PRO:MATERIAL:mocked-uuid\n")}>
        Simular leitura da câmera
      </button>
    ) : null,
}));

import CheckinCheckout from "./CheckinCheckout";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CheckinCheckout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Every RPC the page's background queries touch (custody lists, indicators,
// responsibles, stock locations) resolves empty/neutral by default so tests
// can focus on buscar_materiais_custodia without wiring up every query.
function defaultRpcResponse(name: string) {
  if (name === "obter_indicadores_custodia") {
    return { data: { itens_fora: 0, previstos_hoje: 0, atrasados: 0, ocorrencias: 0 }, error: null };
  }
  return { data: [], error: null };
}

describe("CheckinCheckout - identification field integrates the camera reader", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockImplementation((name: string) => Promise.resolve(defaultRpcResponse(name)));
  });
  afterEach(() => vi.clearAllMocks());

  it("a simulated camera read calls the exact same RPC (buscar_materiais_custodia) manual typing uses, with the value normalized", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /ler com a câmera/i }));
    fireEvent.click(await screen.findByRole("button", { name: /simular leitura da câmera/i }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "buscar_materiais_custodia",
        expect.objectContaining({
          _empresa_id: "company-1",
          // normalizeCustodyScan strips \r\n\t and trims - the mock scanner
          // fed a value with leading/trailing whitespace and a newline on
          // purpose to prove this is actually applied, not bypassed.
          _busca: "BACKSTAGE-PRO:MATERIAL:mocked-uuid",
        }),
      ),
    );
  });

  it("also fills the visible identification field with the camera-read value", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /ler com a câmera/i }));
    fireEvent.click(await screen.findByRole("button", { name: /simular leitura da câmera/i }));

    // A single-line <input> sanitizes embedded newlines out of its own
    // live .value (spec behavior, not something this app controls) - the
    // surrounding whitespace this asserts on on is what actually survives.
    const field = await screen.findByPlaceholderText<HTMLInputElement>(/UUID, QR, código de barras/i);
    await waitFor(() => expect(field.value).toContain("BACKSTAGE-PRO:MATERIAL:mocked-uuid"));
  });

  it("does not wait on scannerValue's state round-trip - the RPC fires with the code passed straight through", async () => {
    // Only two renders' worth of RPC calls should exist by the time the
    // search resolves: the page's own background queries, then exactly one
    // buscar_materiais_custodia call carrying the code itself (not an
    // empty/stale value, which is what a stale-closure bug would produce).
    renderPage();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /ler com a câmera/i }));
    fireEvent.click(await screen.findByRole("button", { name: /simular leitura da câmera/i }));

    await waitFor(() => {
      const call = rpcMock.mock.calls.find(([name]) => name === "buscar_materiais_custodia");
      expect(call?.[1]).toMatchObject({ _busca: "BACKSTAGE-PRO:MATERIAL:mocked-uuid" });
    });
  });

  it("manual typing + form submit (the USB/Bluetooth scanner's own path) keeps working unchanged", async () => {
    renderPage();
    const field = await screen.findByPlaceholderText(/UUID, QR, código de barras/i);

    fireEvent.change(field, { target: { value: "FUR-001" } });
    fireEvent.click(screen.getByRole("button", { name: /^identificar$/i }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "buscar_materiais_custodia",
        expect.objectContaining({ _empresa_id: "company-1", _busca: "FUR-001" }),
      ),
    );
  });

  it("never introduces a second RPC for identification - only buscar_materiais_custodia is called for a search, from either input path", async () => {
    renderPage();
    rpcMock.mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /ler com a câmera/i }));
    fireEvent.click(await screen.findByRole("button", { name: /simular leitura da câmera/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    const searchCalls = rpcMock.mock.calls.filter(([name]) => name.includes("busca") || name.includes("materia"));
    expect(new Set(searchCalls.map(([name]) => name))).toEqual(new Set(["buscar_materiais_custodia"]));
  });
});
