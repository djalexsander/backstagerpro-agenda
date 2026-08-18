import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  event: {
    id: "event-1",
    empresa_id: "company-1",
    name: "Festival Carregado",
    city: "Recife",
    venue: "Teatro Central",
    status: "confirmado",
    num_days: 2,
    artist: "Artista Principal",
    date: "2026-08-20",
    show_time: "20:00:00",
    observations: "Observação geral",
    logistics_departure: null,
    material_list: null,
  },
  days: [
    {
      id: "day-1",
      event_id: "event-1",
      day_number: 1,
      date: "2026-08-20",
      artist: "Artista Um",
      show_time: "20:00:00",
      observations: "Som do dia um",
    },
    {
      id: "day-2",
      event_id: "event-1",
      day_number: 2,
      date: "2026-08-21",
      artist: "Artista Dois",
      show_time: "21:00:00",
      observations: "Luz do dia dois",
    },
  ],
  files: [
    {
      id: "rider-1",
      event_id: "event-1",
      event_day_id: "day-1",
      file_type: "artist_rider",
      file_name: "rider-dia-1.pdf",
      file_path: "company-1/event-1/day-1/rider.pdf",
    },
    {
      id: "rider-2",
      event_id: "event-1",
      event_day_id: "day-2",
      file_type: "artist_rider",
      file_name: "rider-dia-2.pdf",
      file_path: "company-1/event-1/day-2/rider.pdf",
    },
  ],
  team: [
    {
      funcionario_id: "staff-1",
      funcionarios: { nome: "Técnica de Som", funcao: "Operadora", tipo: "fixo" },
    },
  ],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAdmin: true,
    empresaNome: "Empresa Teste",
    empresaLogoUrl: null,
    role: "admin_empresa",
  }),
}));

vi.mock("@/components/ModuleGate", () => ({
  useModuleAccess: () => ({ canAccess: false, isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/evento/EventDetailContent", () => ({
  EventDetailContent: ({ event, eventDays, files, teamMembers }: {
    event: typeof fixtures.event;
    eventDays: typeof fixtures.days;
    files: typeof fixtures.files;
    teamMembers: typeof fixtures.team;
  }) => (
    <div>
      <span>{event.venue}, {event.city}</span>
      {eventDays.map((day) => <span key={day.id}>{day.artist}</span>)}
      {files.map((file) => <span key={file.id}>{file.file_name}</span>)}
      {teamMembers.map((member) => (
        <span key={member.funcionario_id}>
          {member.funcionarios.nome} - {member.funcionarios.funcao}
        </span>
      ))}
    </div>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "events") {
            return { single: () => Promise.resolve({ data: fixtures.event, error: null }) };
          }
          if (table === "event_days") {
            return { order: () => Promise.resolve({ data: fixtures.days, error: null }) };
          }
          if (table === "event_files") {
            return Promise.resolve({ data: fixtures.files, error: null });
          }
          if (table === "event_funcionarios") {
            return Promise.resolve({ data: fixtures.team, error: null });
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })),
    storage: {
      from: () => ({ createSignedUrl: vi.fn() }),
    },
  },
}));

import EventDetail from "./EventDetail";

describe("EventDetail initial loading", () => {
  it("renders the persisted event, days, riders and team from their real query boundaries", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/evento/event-1"]}>
          <Routes>
            <Route path="/evento/:id" element={<EventDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Festival Carregado" })).toBeInTheDocument();
    expect(screen.getByText("confirmado")).toBeInTheDocument();
    expect(screen.getByText(/Teatro Central, Recife/)).toBeInTheDocument();
    expect(await screen.findByText("Artista Um")).toBeInTheDocument();
    expect(screen.getByText("Artista Dois")).toBeInTheDocument();
    expect(await screen.findByText("rider-dia-1.pdf")).toBeInTheDocument();
    expect(screen.getByText("rider-dia-2.pdf")).toBeInTheDocument();
    expect(await screen.findByText(/Técnica de Som - Operadora/)).toBeInTheDocument();
  });
});
