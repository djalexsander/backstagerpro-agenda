import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CheckinDialog } from "./CheckinDialog";
import { toDatetimeLocalValue } from "@/lib/datetime";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";
import type { StockLocation } from "@/lib/stock-types";

// CheckinDialog only uses this to decide whether to offer a "open
// maintenance order" toast action after a damaged check-in - irrelevant to
// the date/time prefill behavior under test, and mocking it avoids needing
// a real AuthProvider/network-backed useCompanyModules in this test.
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => false, isLoading: false }),
}));

const operation: CustodyOperationView = {
  id: "40000000-0000-4000-8000-000000000001",
  empresa_id: "31000000-0000-4000-8000-000000000001",
  material_id: "41000000-0000-4000-8000-000000000001",
  material_nome: "Line Array Neo 210",
  material_codigo: "0001",
  material_identificador: null,
  foto_path: null,
  tipo_controle: "quantidade",
  quantidade_retirada: 6,
  quantidade_baixada: 0,
  quantidade_devolvida: 0,
  quantidade_pendente: 6,
  localizacao_origem_id: "42000000-0000-4000-8000-000000000001",
  localizacao_origem_nome: "Barracão",
  retirada_em: "2026-08-06T11:00:00.000Z",
  previsao_retorno: null,
  executado_por: "u1",
  executor_nome: "Alex",
  responsavel_tipo: "usuario",
  responsavel_usuario_id: "u1",
  responsavel_funcionario_id: null,
  responsavel_nome: "Alex",
  finalidade: "uso_interno",
  referencia_tipo: null,
  referencia_id: null,
  observacao_saida: null,
  condicao_saida: "bom",
  status: "aberta",
  movimento_saida_id: "m1",
  encerrada_em: null,
  created_at: "2026-08-06T11:00:00.000Z",
  updated_at: "2026-08-06T11:00:00.000Z",
};

const locations: StockLocation[] = [
  {
    id: "42000000-0000-4000-8000-000000000001",
    empresa_id: "31000000-0000-4000-8000-000000000001",
    codigo: "BAR",
    nome: "Barracão",
    tipo: "deposito",
    localizacao_pai_id: null,
    descricao: null,
    ativa: true,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
    updated_at: "2026-08-01T00:00:00.000Z",
    updated_by: null,
  },
];

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CheckinDialog
          open
          onOpenChange={vi.fn()}
          companyId="31000000-0000-4000-8000-000000000001"
          operation={operation}
          locations={locations}
          onSaved={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CheckinDialog effective date/time", () => {
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fills the current local date/time when the dialog opens", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-06T15:00:00.000Z");
    vi.setSystemTime(now);

    renderDialog();

    // Expected value computed via the same helper the component itself
    // uses (toDatetimeLocalValue), instead of a clock string hardcoded for
    // one specific timezone - holds under any timezone Vitest runs in.
    expect(screen.getByLabelText(/Data\/hora do retorno/i)).toHaveValue(
      toDatetimeLocalValue(now),
    );
  });

  it("keeps the field editable for a retroactive/corrected entry", () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    renderDialog();

    const field = screen.getByLabelText(/Data\/hora do retorno/i);
    fireEvent.change(field, { target: { value: "2026-08-05T09:30" } });

    expect(field).toHaveValue("2026-08-05T09:30");
  });
});
