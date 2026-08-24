import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { CheckinOriginDialog } from "./CheckinOriginDialog";

function operation(overrides: Partial<CustodyOperationView>): CustodyOperationView {
  return {
    id: "op1",
    empresa_id: "empresa1",
    material_id: "m1",
    material_nome: "Mesa de Som",
    material_codigo: "MESA-001",
    material_identificador: null,
    foto_path: null,
    tipo_controle: "quantidade",
    quantidade_retirada: 1,
    quantidade_devolvida: 0,
    quantidade_baixada: 0,
    quantidade_pendente: 1,
    localizacao_origem_id: "loc1",
    localizacao_origem_nome: "Depósito",
    retirada_em: "2026-08-14T18:42:00Z",
    previsao_retorno: null,
    executado_por: "user1",
    executor_nome: "Alex",
    responsavel_tipo: "funcionario",
    responsavel_usuario_id: null,
    responsavel_funcionario_id: "f1",
    responsavel_nome: "João",
    finalidade: "uso_interno",
    referencia_tipo: null,
    referencia_id: null,
    observacao_saida: null,
    condicao_saida: "bom",
    status: "aberta",
    movimento_saida_id: "mov1",
    encerrada_em: null,
    created_at: "2026-08-14T18:42:00Z",
    updated_at: "2026-08-14T18:42:00Z",
    ...overrides,
  };
}

// Default: no test in this file that doesn't set up its own events fixture
// should ever actually reach the network - options without
// referencia_tipo==='evento' never trigger the query (enabled guard), so
// this only exists as a safety net against an unexpected call.
function mockEventsQuery(rows: Array<{ id: string; name: string; date: string }>) {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const inMock = vi.fn().mockResolvedValue({ data: rows, error: null });
  fromMock.mockReturnValue({ select, eq, in: inMock });
  return { select, eq, in: inMock };
}

function renderDialog(options: CustodyOperationView[], onSelect = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CheckinOriginDialog
        open
        onOpenChange={vi.fn()}
        companyId="empresa1"
        options={options}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
}

describe("CheckinOriginDialog", () => {
  it("renders one option per open custody with finalidade, localização and quantidade pendente", () => {
    mockEventsQuery([]);
    const options = [
      operation({
        id: "op1",
        finalidade: "evento",
        localizacao_origem_nome: "Barracão",
        responsavel_nome: "João",
        quantidade_pendente: 2,
      }),
      operation({
        id: "op2",
        finalidade: "uso_interno",
        localizacao_origem_nome: "Depósito",
        responsavel_nome: "Maria",
        quantidade_pendente: 5,
      }),
    ];
    renderDialog(options);

    // finalidade 'evento' without a referencia_tipo/referencia_id link (no
    // structured event chosen) keeps the existing localização display -
    // only a resolved referencia_tipo==='evento' link is enriched.
    expect(screen.getByText("Evento · Barracão")).toBeInTheDocument();
    expect(screen.getByText("João · 2 pendente(s)")).toBeInTheDocument();
    expect(screen.getByText("Uso interno · Depósito")).toBeInTheDocument();
    expect(screen.getByText("Maria · 5 pendente(s)")).toBeInTheDocument();
  });

  it("calls onSelect with the chosen custody, not the other options", () => {
    mockEventsQuery([]);
    const onSelect = vi.fn();
    const first = operation({ id: "op1", responsavel_nome: "João" });
    const second = operation({ id: "op2", responsavel_nome: "Maria" });
    renderDialog([first, second], onSelect);

    fireEvent.click(screen.getByText(/Maria/));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(second);
  });

  it("enriches a referencia_tipo='evento' option with the event's name and date", async () => {
    const { in: inMock } = mockEventsQuery([
      { id: "evt-1", name: "Show X", date: "2026-08-20" },
    ]);
    const options = [
      operation({
        id: "op1",
        finalidade: "evento",
        referencia_tipo: "evento",
        referencia_id: "evt-1",
        localizacao_origem_nome: "Barracão",
      }),
      operation({ id: "op2", finalidade: "uso_interno", localizacao_origem_nome: "Depósito" }),
    ];
    renderDialog(options);

    expect(await screen.findByText("Evento · Show X · 20/08/2026")).toBeInTheDocument();
    // the non-evento option is untouched by the lookup
    expect(screen.getByText("Uso interno · Depósito")).toBeInTheDocument();
    // scoped lookup: only the referenced event id, never a full events list
    expect(fromMock).toHaveBeenCalledWith("events");
    expect(inMock).toHaveBeenCalledWith("id", ["evt-1"]);
  });

  it("falls back to localização when the referenced event can't be resolved", async () => {
    mockEventsQuery([]);
    const options = [
      operation({
        id: "op1",
        finalidade: "evento",
        referencia_tipo: "evento",
        referencia_id: "evt-deleted",
        localizacao_origem_nome: "Barracão",
      }),
    ];
    renderDialog(options);

    await waitFor(() => expect(fromMock).toHaveBeenCalled());
    expect(screen.getByText("Evento · Barracão")).toBeInTheDocument();
  });
});
