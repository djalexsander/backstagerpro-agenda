import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAdmin: true,
    isUsuario: false,
    empresaId: "c1",
    empresaNome: "Minha Empresa",
    empresaLogoUrl: null,
    empresaReadOnly: false,
  }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
  usePlanLimits: () => ({ canCreateEvent: true, maxEventos: 100, currentEventos: 2 }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/components/ModuleGate", () => ({ useModuleAccess: () => ({ canAccess: true }) }));

vi.mock("@/lib/pdf-export", () => ({ exportAgendaPDF: vi.fn() }));

vi.mock("@/components/agenda/EventRowExpansion", () => ({
  EventRowExpansion: () => <div>expansão</div>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (data: unknown) => {
    const result = { data, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      in: () => chain,
      delete: () => chain,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR),
    };
    return chain;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => makeQuery(table === "events" ? mocks.events : [])),
      // ImportAgendaDialog -> agenda-import-service faz supabase.rpc.bind(supabase)
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
  };
});

import Agenda from "./Agenda";

function renderAgenda() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Agenda />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Agenda - eventos com artist/city/venue null", () => {
  beforeEach(() => {
    mocks.events = [
      {
        id: "e1", empresa_id: "c1", name: "Reserva sem local",
        artist: null, city: null, venue: null,
        date: "2026-12-10", status: "confirmado", num_days: 1,
      },
      {
        id: "e2", empresa_id: "c1", name: "Rock in Rio",
        artist: "Foo Fighters", city: "Rio de Janeiro", venue: "Parque Olímpico",
        date: "2026-12-20", status: "pendente", num_days: 1,
      },
    ];
  });

  it("lista os eventos (inclusive o de campos nulos) sem quebrar e usa 'A definir' na exibição", async () => {
    // Se `cities` (linha ~119) mantivesse null/"" o <SelectItem> do Radix
    // lançaria em render - o simples fato de montar já prova o filtro.
    renderAgenda();
    expect(await screen.findByText("Reserva sem local")).toBeInTheDocument();
    expect(screen.getByText("Rock in Rio")).toBeInTheDocument();
    expect(screen.getByText("Rio de Janeiro")).toBeInTheDocument();
    expect(screen.getAllByText("A definir").length).toBeGreaterThanOrEqual(1);
  });

  it("busca por texto não quebra com city/artist null e filtra corretamente", async () => {
    renderAgenda();
    await screen.findByText("Reserva sem local");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por evento/i), { target: { value: "rock" } });

    expect(screen.getByText("Rock in Rio")).toBeInTheDocument();
    expect(screen.queryByText("Reserva sem local")).not.toBeInTheDocument();
  });

  it("busca que casa só pelo nome funciona mesmo com cidade nula", async () => {
    renderAgenda();
    await screen.findByText("Reserva sem local");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por evento/i), { target: { value: "reserva" } });

    expect(screen.getByText("Reserva sem local")).toBeInTheDocument();
    expect(screen.queryByText("Rock in Rio")).not.toBeInTheDocument();
  });
});
