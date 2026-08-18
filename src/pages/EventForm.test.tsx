import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  days: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
  eventUpdates: [] as Array<Record<string, unknown>>,
  eventUpdateError: null as Error | null,
  reconcileEventDays: vi.fn(),
  removeEventFile: vi.fn(),
  uploadEventFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    empresaId: "company-1",
    isAdmin: true,
    role: "admin_empresa",
  }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
  usePlanLimits: () => ({ canCreateEvent: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/event-days-service", () => ({
  reconcileEventDays: mocks.reconcileEventDays,
}));

vi.mock("@/lib/event-file-service", () => ({
  removeEventFile: mocks.removeEventFile,
  uploadEventFile: mocks.uploadEventFile,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "events") {
            return {
              single: () => Promise.resolve({ data: mocks.event, error: null }),
            };
          }
          if (table === "event_days") {
            return {
              order: () => Promise.resolve({ data: mocks.days, error: null }),
            };
          }
          if (table === "event_files") {
            return Promise.resolve({ data: mocks.files, error: null });
          }
          if (table === "funcionarios") {
            return {
              order: () => Promise.resolve({ data: [], error: null }),
            };
          }
          if (table === "event_funcionarios") {
            return Promise.resolve({ data: [], error: null });
          }
          throw new Error(`Unexpected select table: ${table}`);
        },
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => {
          mocks.eventUpdates.push(payload);
          return Promise.resolve({ error: mocks.eventUpdateError });
        },
      }),
      delete: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
      insert: () => Promise.resolve({ error: null }),
    })),
    storage: {
      from: () => ({ createSignedUrl: vi.fn() }),
    },
  },
}));

import EventForm from "./EventForm";

const dayOne = {
  id: "day-1",
  event_id: "event-1",
  empresa_id: "company-1",
  day_number: 1,
  date: "2026-08-20",
  artist: "Artista Um",
  show_time: "20:00:00",
  observations: "Som original",
};

const dayTwo = {
  id: "day-2",
  event_id: "event-1",
  empresa_id: "company-1",
  day_number: 2,
  date: "2026-08-21",
  artist: "Artista Dois",
  show_time: "21:00:00",
  observations: "Luz original",
};

const riderOne = {
  id: "rider-1",
  event_id: "event-1",
  event_day_id: "day-1",
  file_type: "artist_rider",
  file_name: "rider-dia-1.pdf",
  file_path: "company-1/event-1/day-1/rider.pdf",
};

const riderTwo = {
  id: "rider-2",
  event_id: "event-1",
  event_day_id: "day-2",
  file_type: "artist_rider",
  file_name: "rider-dia-2.pdf",
  file_path: "company-1/event-1/day-2/rider.pdf",
};

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/evento/event-1/editar"]}>
        <Routes>
          <Route path="/evento/:id/editar" element={<EventForm />} />
          <Route path="/evento/:id" element={<div>Detalhe atualizado</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForLoadedForm() {
  await screen.findByDisplayValue("Festival Original");
  await screen.findByDisplayValue("Artista Um");
}

async function submitForm() {
  fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  await waitFor(() => expect(mocks.reconcileEventDays).toHaveBeenCalledTimes(1));
}

function desiredDaysFromLastCall() {
  return mocks.reconcileEventDays.mock.calls.at(-1)?.[0].desiredDays;
}

describe("EventForm event-day regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.event = {
      id: "event-1",
      empresa_id: "company-1",
      name: "Festival Original",
      city: "Recife",
      venue: "Teatro Central",
      status: "pendente",
      num_days: 2,
      artist: "Artista Um",
      date: "2026-08-20",
      show_time: "20:00:00",
      observations: "Evento existente",
      logistics_departure: null,
      material_list: null,
    };
    mocks.days = [dayOne, dayTwo];
    mocks.files = [riderOne, riderTwo];
    mocks.eventUpdates = [];
    mocks.eventUpdateError = null;
    mocks.reconcileEventDays.mockImplementation(async ({ desiredDays }) =>
      desiredDays.map((day: { id?: string }, index: number) => ({
        id: day.id || `day-new-${index + 1}`,
      })),
    );
  });

  it("editing only the event name sends both existing day ids to the canonical reconciler", async () => {
    renderForm();
    await waitForLoadedForm();

    fireEvent.change(screen.getByDisplayValue("Festival Original"), {
      target: { value: "Festival Renomeado" },
    });
    await submitForm();

    expect(desiredDaysFromLastCall().map((day: { id?: string }) => day.id)).toEqual(["day-1", "day-2"]);
    expect(mocks.eventUpdates.at(-1)).toMatchObject({ name: "Festival Renomeado" });
  });

  it("editing status preserves rider-bearing days and does not request direct rider removal", async () => {
    renderForm();
    await waitForLoadedForm();

    fireEvent.change(document.querySelector("select[aria-hidden='true']")!, {
      target: { value: "confirmado" },
    });
    await submitForm();

    expect(mocks.eventUpdates.at(-1)).toMatchObject({ status: "confirmado" });
    expect(desiredDaysFromLastCall().map((day: { id?: string }) => day.id)).toEqual(["day-1", "day-2"]);
    expect(mocks.removeEventFile).not.toHaveBeenCalled();
  });

  it("editing an existing day keeps its id", async () => {
    renderForm();
    await waitForLoadedForm();

    fireEvent.change(screen.getByDisplayValue("Artista Dois"), {
      target: { value: "Artista Dois Atualizado" },
    });
    await submitForm();

    expect(desiredDaysFromLastCall()[1]).toMatchObject({
      id: "day-2",
      artist: "Artista Dois Atualizado",
    });
  });

  it("adding a day leaves only the new draft without an id", async () => {
    renderForm();
    await waitForLoadedForm();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.change(screen.getAllByPlaceholderText("Nome do artista")[2], {
      target: { value: "Artista Três" },
    });
    await submitForm();

    expect(desiredDaysFromLastCall().map((day: { id?: string }) => day.id)).toEqual(["day-1", "day-2", undefined]);
  });

  it("removing a day keeps only the id selected to remain", async () => {
    renderForm();
    await waitForLoadedForm();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
    await submitForm();

    expect(desiredDaysFromLastCall().map((day: { id?: string }) => day.id)).toEqual(["day-1"]);
    expect(mocks.reconcileEventDays.mock.calls.at(-1)?.[0].existingDays.map((day: { id: string }) => day.id)).toEqual(["day-1", "day-2"]);
  });

  it("keeps riders of retained days delegated to reconciliation when another day is removed", async () => {
    renderForm();
    await waitForLoadedForm();
    expect(screen.getByText("rider-dia-1.pdf")).toBeInTheDocument();
    expect(screen.getByText("rider-dia-2.pdf")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
    await submitForm();

    expect(desiredDaysFromLastCall()[0].id).toBe("day-1");
    expect(mocks.removeEventFile).not.toHaveBeenCalled();
    expect(mocks.reconcileEventDays.mock.calls.at(-1)?.[0].confirmLinkedFileRemoval).toEqual(expect.any(Function));
  });

  it("keeps a single-day event on the same day id", async () => {
    mocks.event = { ...mocks.event, num_days: 1 };
    mocks.days = [dayOne];
    mocks.files = [riderOne];
    renderForm();
    await waitForLoadedForm();

    await submitForm();

    expect(desiredDaysFromLastCall()).toHaveLength(1);
    expect(desiredDaysFromLastCall()[0].id).toBe("day-1");
  });

  it("keeps the form visible and never reports success when persistence fails", async () => {
    mocks.reconcileEventDays.mockRejectedValueOnce(new Error("Falha ao persistir dias"));
    renderForm();
    await waitForLoadedForm();

    await submitForm();

    expect(await screen.findByRole("heading", { name: "Editar Evento" })).toBeInTheDocument();
    expect(screen.queryByText("Detalhe atualizado")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro",
      description: "Falha ao persistir dias",
      variant: "destructive",
    }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Evento atualizado!" }));
  });
});
