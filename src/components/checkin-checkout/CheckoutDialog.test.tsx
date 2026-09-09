import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CheckoutDialog } from "./CheckoutDialog";
import { toDatetimeLocalValue } from "@/lib/datetime";
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

  // Dois DateTimePicker no diálogo (retirada + previsão de retorno), então o
  // campo "Hora" existe duas vezes - em ordem de DOM: [0] retirada, [1] previsão.
  const withdrawalTime = () => screen.getAllByLabelText("Hora")[0];
  const expectedReturnTime = () => screen.getAllByLabelText("Hora")[1];

  // O DateTimePicker mostra a data no gatilho (DD/MM/AAAA, rotulado via
  // htmlFor) e a hora no campo "Hora" (HH:mm). O esperado sai do mesmo helper
  // que o componente usa (toDatetimeLocalValue), sem fixar timezone.
  function expectEffectiveDateTime(moment: Date) {
    const [date, time] = toDatetimeLocalValue(moment).split("T");
    expect(screen.getByLabelText(/Data\/hora da retirada/i)).toHaveTextContent(
      date.split("-").reverse().join("/"),
    );
    expect(withdrawalTime()).toHaveValue(time);
  }

  it("fills the current local date/time when the dialog opens", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-06T15:00:00.000Z");
    vi.setSystemTime(now);

    renderDialog();

    expectEffectiveDateTime(now);
  });

  it("does not prefill the expected-return field (that one is a future estimate, not 'now')", () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    renderDialog();

    // vazio: data no placeholder, hora em branco
    expect(screen.getByLabelText(/Previsão de retorno/i)).toHaveTextContent("Selecionar data");
    expect(expectedReturnTime()).toHaveValue("");
  });

  it("keeps the field editable for a retroactive/corrected entry", () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00.000Z"));
    renderDialog();

    const time = withdrawalTime();
    fireEvent.change(time, { target: { value: "09:30" } });

    expect(time).toHaveValue("09:30");
    // a data continua editável (gatilho habilitado abre o calendário)
    expect(screen.getByLabelText(/Data\/hora da retirada/i)).toBeEnabled();
  });

  it("captures a new 'now' each time the same dialog instance is closed and reopened", () => {
    vi.useFakeTimers();
    const firstMoment = new Date("2026-08-06T15:00:00.000Z");
    vi.setSystemTime(firstMoment);
    const { rerenderOpen } = renderDialog();
    expectEffectiveDateTime(firstMoment);

    // Close it (component stays mounted, as it does on the real pages -
    // Dialog visibility is controlled by the `open` prop, not by unmounting).
    rerenderOpen(false);

    // Time passes while it's closed - the field must not update while
    // hidden, only when it's opened again.
    const secondMoment = new Date("2026-08-06T15:07:00.000Z");
    vi.setSystemTime(secondMoment);
    rerenderOpen(true);

    // Same helper, evaluated against the *new* "now" - this fails exactly
    // as before if the component ever stops recapturing "now" on reopen,
    // while staying correct under any timezone the test runs in.
    expectEffectiveDateTime(secondMoment);
  });
});
