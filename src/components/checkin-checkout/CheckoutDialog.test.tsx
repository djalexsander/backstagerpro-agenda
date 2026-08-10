import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CheckoutDialog } from "./CheckoutDialog";
import type {
  CustodyMaterialSearchResult,
  CustodyResponsibleOption,
} from "@/lib/checkin-checkout-types";

const material: CustodyMaterialSearchResult = {
  id: "41000000-0000-4000-8000-000000000001",
  nome: "Line Array Neo 210",
  codigo_interno: "0001",
  identificador_unico: null,
  codigo_barras: null,
  conteudo_qr_code: null,
  numero_patrimonio: null,
  numero_serie: null,
  tipo_controle: "quantidade",
  status_operacional: "disponivel",
  ativo: true,
  unidade_medida: "un",
  foto_path: null,
  saldos: [
    {
      localizacao_id: "42000000-0000-4000-8000-000000000001",
      localizacao_codigo: "BAR",
      localizacao_nome: "Barracão",
      localizacao_ativa: true,
      quantidade: 24,
    },
  ],
  custodias_abertas: [],
};

const responsibles: CustodyResponsibleOption[] = [
  { tipo: "usuario", id: "u1", nome: "Alex", detalhe: "admin" },
];

function renderDialog(open = true) {
  const client = new QueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <CheckoutDialog
        open={open}
        onOpenChange={vi.fn()}
        companyId="31000000-0000-4000-8000-000000000001"
        material={material}
        responsibles={responsibles}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return {
    ...utils,
    rerenderOpen: (nextOpen: boolean) =>
      utils.rerender(
        <QueryClientProvider client={client}>
          <CheckoutDialog
            open={nextOpen}
            onOpenChange={vi.fn()}
            companyId="31000000-0000-4000-8000-000000000001"
            material={material}
            responsibles={responsibles}
            onSaved={vi.fn()}
          />
        </QueryClientProvider>,
      ),
  };
}

describe("CheckoutDialog effective date/time", () => {
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
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180); // UTC-3
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));

    renderDialog();

    expect(screen.getByLabelText(/Data\/hora da retirada/i)).toHaveValue(
      "2026-08-06T12:00",
    );
  });

  it("does not prefill the expected-return field (that one is a future estimate, not 'now')", () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    renderDialog();

    expect(screen.getByLabelText(/Previsão de retorno/i)).toHaveValue("");
  });

  it("keeps the field editable for a retroactive/corrected entry", () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    renderDialog();

    const field = screen.getByLabelText(/Data\/hora da retirada/i);
    fireEvent.change(field, { target: { value: "2026-08-05T09:30" } });

    expect(field).toHaveValue("2026-08-05T09:30");
  });

  it("captures a new 'now' each time the same dialog instance is closed and reopened", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    const { rerenderOpen } = renderDialog();
    expect(screen.getByLabelText(/Data\/hora da retirada/i)).toHaveValue(
      "2026-08-06T12:00",
    );

    // Close it (component stays mounted, as it does on the real pages -
    // Dialog visibility is controlled by the `open` prop, not by unmounting).
    rerenderOpen(false);

    // Time passes while it's closed - the field must not update while
    // hidden, only when it's opened again.
    vi.setSystemTime(new Date("2026-08-06T15:07:00.000Z"));
    rerenderOpen(true);

    expect(screen.getByLabelText(/Data\/hora da retirada/i)).toHaveValue(
      "2026-08-06T12:07",
    );
  });
});
