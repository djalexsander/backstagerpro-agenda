import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));

import { EventOperationalPanel } from "./EventOperationalPanel";

function renderPanel(overrides: Record<string, unknown> = {}, eventDays: unknown[] = []) {
  const event = {
    id: "event-1",
    name: "Reserva de data",
    date: "2026-11-15",
    status: "confirmado",
    artist: null,
    city: null,
    venue: null,
    num_days: 1,
    show_time: null,
    logistics_departure: null,
    observations: null,
    state: null,
    setup_time: null,
    staff_notes: null,
    contratante_nome: null,
    contratante_cidade: null,
    contratante_telefone: null,
    ...overrides,
  };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EventOperationalPanel
        event={event}
        eventDays={eventDays as never}
        teamMembers={[] as never}
        files={[] as never}
      />
    </QueryClientProvider>,
  );
}

describe("EventOperationalPanel - campos próprios", () => {
  it("mostra UF na linha Local, Montagem, Contratante e Informações para a Equipe", () => {
    renderPanel({
      venue: "Teatro Central",
      city: "Recife",
      state: "PE",
      setup_time: "14:00",
      staff_notes: "Van sai às 10h.",
      observations: "Obs operacional.",
      contratante_nome: "Prefeitura X",
      contratante_cidade: "Campina Grande",
      contratante_telefone: "(83) 99999-0000",
    });

    expect(screen.getByText("Teatro Central, Recife, PE")).toBeInTheDocument();
    expect(screen.getByText(/Montagem:/)).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();

    expect(screen.getByText("Prefeitura X")).toBeInTheDocument();
    expect(screen.getByText("Campina Grande")).toBeInTheDocument();
    expect(screen.getByText("(83) 99999-0000")).toBeInTheDocument();

    // Observações e Informações para a Equipe são cartões distintos
    const obs = screen.getByText("Obs operacional.");
    expect(obs.textContent).toBe("Obs operacional.");
    const staff = screen.getByText("Van sai às 10h.");
    expect(staff.textContent).toBe("Van sai às 10h.");
  });

  it("não renderiza 'null' nem cartões vazios quando os campos são null (item 20)", () => {
    const { container } = renderPanel();
    expect(screen.queryByText(/Montagem:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Informações para a Equipe")).not.toBeInTheDocument();
    // "Contratante" só aparece embutido no cartão; sem dados, nenhum cartão
    expect(screen.queryByText("Contratante")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null/i);
  });
});
