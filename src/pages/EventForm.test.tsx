import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  days: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
  eventUpdates: [] as Array<Record<string, unknown>>,
  eventInserts: [] as Array<Record<string, unknown>>,
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
      insert: (payload: Record<string, unknown>) => {
        if (table === "events") {
          mocks.eventInserts.push(payload);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "new-event-1" }, error: null }),
            }),
          };
        }
        return Promise.resolve({ error: null });
      },
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

describe("EventForm - artist/city/venue opcionais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.event = {};
    mocks.days = [];
    mocks.files = [];
    mocks.eventUpdates = [];
    mocks.eventInserts = [];
    mocks.eventUpdateError = null;
    mocks.reconcileEventDays.mockImplementation(async ({ desiredDays }: { desiredDays: Array<{ id?: string }> }) =>
      desiredDays.map((day, index) => ({ id: day.id || `day-new-${index + 1}` })),
    );
  });

  function renderCreateForm() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/evento/novo"]}>
          <Routes>
            <Route path="/evento/novo" element={<EventForm />} />
            <Route path="/evento/:id" element={<div>Evento salvo</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  // O picker abre no mês corrente (nenhuma data pré-selecionada); clicar o
  // dia 15 dá new Date(ano, mês, 15) local -> gravado como YYYY-MM-DD.
  const now = new Date();
  const EXPECTED_DATE = format(new Date(now.getFullYear(), now.getMonth(), 15), "yyyy-MM-dd");

  async function pickDay15FromDayPicker(triggerIndex = 0) {
    fireEvent.click(screen.getAllByRole("button", { name: /selecionar data/i })[triggerIndex]);
    const grid = await screen.findByRole("grid");
    const day15 = within(grid)
      .getAllByRole("gridcell")
      .find(
        (cell) =>
          cell.textContent?.trim() === "15" &&
          !cell.className.includes("day-outside") &&
          !cell.hasAttribute("disabled"),
      )!;
    fireEvent.click(day15);
  }

  async function fillBasics({ name = "Show sem detalhes" } = {}) {
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: name } });
    await pickDay15FromDayPicker();
  }

  async function submitCreate() {
    fireEvent.click(screen.getByRole("button", { name: "Criar Evento" }));
  }

  it("cria evento apenas com nome e data - artist/city/venue vão como null", async () => {
    renderCreateForm();
    await fillBasics();

    await submitCreate();

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0]).toMatchObject({
      name: "Show sem detalhes",
      date: EXPECTED_DATE,
      artist: null,
      city: null,
      venue: null,
    });
    expect(String(mocks.eventInserts[0].date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Evento criado!" }));
  });

  it("grava null (não string vazia nem placeholder) quando city/venue têm só espaços", async () => {
    renderCreateForm();
    await fillBasics();
    const [cityInput, venueInput] = screen.getAllByPlaceholderText("Opcional");
    fireEvent.change(cityInput, { target: { value: "   " } });
    fireEvent.change(venueInput, { target: { value: "  \t " } });

    await submitCreate();

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0].city).toBeNull();
    expect(mocks.eventInserts[0].venue).toBeNull();
    expect(mocks.eventInserts[0].artist).toBeNull();
    expect(Object.values(mocks.eventInserts[0])).not.toContain("Vários");
    expect(Object.values(mocks.eventInserts[0])).not.toContain("A definir");
  });

  it("preenche só city (venue e artist seguem null)", async () => {
    renderCreateForm();
    await fillBasics();
    fireEvent.change(screen.getAllByPlaceholderText("Opcional")[0], { target: { value: "Recife" } });

    await submitCreate();

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0]).toMatchObject({ city: "Recife", venue: null, artist: null });
  });

  it("preenche só venue (city e artist seguem null)", async () => {
    renderCreateForm();
    await fillBasics();
    fireEvent.change(screen.getAllByPlaceholderText("Opcional")[1], { target: { value: "Teatro" } });

    await submitCreate();

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0]).toMatchObject({ city: null, venue: "Teatro", artist: null });
  });

  it("preenche só artist do Dia 1 (city e venue seguem null)", async () => {
    renderCreateForm();
    await fillBasics();
    fireEvent.change(screen.getByPlaceholderText("Nome do artista"), { target: { value: "Banda X" } });

    await submitCreate();

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0]).toMatchObject({ city: null, venue: null, artist: "Banda X" });
  });

  it("não submete sem nome e não chama insert", async () => {
    const { container } = renderCreateForm();
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campos obrigatórios" })),
    );
    expect(mocks.eventInserts).toHaveLength(0);
  });

  it("não submete sem data e não chama insert", async () => {
    const { container } = renderCreateForm();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Show sem data" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campos obrigatórios" })),
    );
    expect(mocks.eventInserts).toHaveLength(0);
  });

  it("abre para edição um evento com artist/city/venue null e salva de novo sem inventar valores", async () => {
    mocks.event = {
      id: "event-null",
      empresa_id: "company-1",
      name: "Reserva de data",
      city: null,
      venue: null,
      artist: null,
      status: "pendente",
      num_days: 1,
      date: "2026-11-15",
      show_time: null,
      observations: null,
      logistics_departure: null,
      material_list: null,
    };
    mocks.days = [
      { id: "d1", event_id: "event-null", empresa_id: "company-1", day_number: 1, date: "2026-11-15", artist: null, show_time: null, observations: null },
    ];

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/evento/event-null/editar"]}>
          <Routes>
            <Route path="/evento/:id/editar" element={<EventForm />} />
            <Route path="/evento/:id" element={<div>Detalhe atualizado</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue("Reserva de data");
    const [cityInput, venueInput] = screen.getAllByPlaceholderText("Opcional");
    expect((cityInput as HTMLInputElement).value).toBe("");
    expect((venueInput as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    await waitFor(() => expect(mocks.eventUpdates).toHaveLength(1));
    expect(mocks.eventUpdates[0]).toMatchObject({ name: "Reserva de data", city: null, venue: null, artist: null });
  });
});

describe("EventForm - seletor de calendário na Data do Show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.event = {};
    mocks.days = [];
    mocks.files = [];
    mocks.eventUpdates = [];
    mocks.eventInserts = [];
    mocks.eventUpdateError = null;
    mocks.reconcileEventDays.mockImplementation(async ({ desiredDays }: { desiredDays: Array<{ id?: string }> }) =>
      desiredDays.map((day, index) => ({ id: day.id || `day-new-${index + 1}` })),
    );
  });

  function renderForm(entry: string) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/evento/novo" element={<EventForm />} />
            <Route path="/evento/:id/editar" element={<EventForm />} />
            <Route path="/evento/:id" element={<div>salvo</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  async function pickDay(triggerIndex: number, dayText: string) {
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    const triggers = screen.getAllByRole("button", { name: /selecionar data|\d{2}\/\d{2}\/\d{4}/i });
    fireEvent.click(triggers[triggerIndex]);
    const grid = await screen.findByRole("grid");
    const cell = within(grid)
      .getAllByRole("gridcell")
      .find(
        (c) => c.textContent?.trim() === dayText && !c.className.includes("day-outside") && !c.hasAttribute("disabled"),
      )!;
    fireEvent.click(cell);
  }

  const now = new Date();
  const iso15 = format(new Date(now.getFullYear(), now.getMonth(), 15), "yyyy-MM-dd");
  const display15 = format(new Date(now.getFullYear(), now.getMonth(), 15), "dd/MM/yyyy");
  const iso20 = format(new Date(now.getFullYear(), now.getMonth(), 20), "yyyy-MM-dd");

  it("criação: exibe DD/MM/AAAA no gatilho, salva YYYY-MM-DD e fecha o calendário ao escolher", async () => {
    renderForm("/evento/novo");
    const trigger = screen.getByRole("button", { name: /selecionar data/i });
    expect(trigger).toHaveTextContent("Selecionar data");

    await pickDay(0, "15");

    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument()); // fechou
    expect(screen.getByRole("button", { name: display15 })).toBeInTheDocument(); // DD/MM/AAAA na UI

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Evento com calendário" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Evento" }));

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0].date).toBe(iso15); // YYYY-MM-DD internamente, sem shift de timezone
  });

  it("edição: uma data YYYY-MM-DD existente aparece como DD/MM/AAAA no gatilho", async () => {
    mocks.event = {
      id: "ev-cal", empresa_id: "company-1", name: "Show existente",
      city: "Recife", venue: "Teatro", artist: "X", status: "confirmado", num_days: 1,
      date: "2026-11-15", show_time: null, observations: null, logistics_departure: null, material_list: null,
    };
    mocks.days = [{ id: "d1", event_id: "ev-cal", empresa_id: "company-1", day_number: 1, date: "2026-11-15", artist: "X", show_time: null, observations: null }];

    renderForm("/evento/ev-cal/editar");
    await screen.findByDisplayValue("Show existente");

    expect(screen.getByRole("button", { name: "15/11/2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(mocks.eventUpdates).toHaveLength(1));
    expect(mocks.eventUpdates[0].date).toBe("2026-11-15");
  });

  it("múltiplos dias: cada dia tem seu próprio calendário e a escolha de um não afeta o outro", async () => {
    renderForm("/evento/novo");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Festival 2 dias" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });

    await waitFor(() => expect(screen.getAllByRole("button", { name: /selecionar data/i })).toHaveLength(2));

    await pickDay(0, "15");
    await pickDay(1, "20");

    fireEvent.click(screen.getByRole("button", { name: "Criar Evento" }));
    await waitFor(() => expect(mocks.reconcileEventDays).toHaveBeenCalled());

    const desiredDays = mocks.reconcileEventDays.mock.calls.at(-1)![0].desiredDays;
    expect(desiredDays.map((d: { date: string | null }) => d.date)).toEqual([iso15, iso20]);
    expect(mocks.eventInserts[0].date).toBe(iso15); // data do evento = Dia 1
  });
});

describe("EventForm - campos próprios (state/setup_time/staff_notes/contratante_*)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.event = {};
    mocks.days = [];
    mocks.files = [];
    mocks.eventUpdates = [];
    mocks.eventInserts = [];
    mocks.eventUpdateError = null;
    mocks.reconcileEventDays.mockImplementation(async ({ desiredDays }: { desiredDays: Array<{ id?: string }> }) =>
      desiredDays.map((day, index) => ({ id: day.id || `day-new-${index + 1}` })),
    );
  });

  // Nenhum campo tem htmlFor/id, então localizamos o input/textarea a partir
  // do texto do <Label> irmão dentro do mesmo wrapper.
  function fieldByLabel(labelText: string): HTMLInputElement | HTMLTextAreaElement {
    const label = screen.getByText(labelText);
    const wrapper = label.closest("div")!;
    return wrapper.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
  }

  const now = new Date();
  const EXPECTED_DATE = format(new Date(now.getFullYear(), now.getMonth(), 15), "yyyy-MM-dd");

  async function pickDay15() {
    fireEvent.click(screen.getAllByRole("button", { name: /selecionar data/i })[0]);
    const grid = await screen.findByRole("grid");
    const day15 = within(grid)
      .getAllByRole("gridcell")
      .find(
        (cell) =>
          cell.textContent?.trim() === "15" &&
          !cell.className.includes("day-outside") &&
          !cell.hasAttribute("disabled"),
      )!;
    fireEvent.click(day15);
  }

  function renderCreate() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/evento/novo"]}>
          <Routes>
            <Route path="/evento/novo" element={<EventForm />} />
            <Route path="/evento/:id" element={<div>Evento salvo</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function renderEdit(entry = "/evento/event-x/editar") {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/evento/:id/editar" element={<EventForm />} />
            <Route path="/evento/:id" element={<div>Detalhe atualizado</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("criação manual: state/setup_time/staff_notes/contratante_* vão para colunas próprias (não observations)", async () => {
    renderCreate();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Show com campos" } });
    await pickDay15();

    fireEvent.change(fieldByLabel("Estado / UF"), { target: { value: "PB" } });
    fireEvent.change(fieldByLabel("Horário de Montagem"), { target: { value: "14:00" } });
    fireEvent.change(fieldByLabel("Informações para a Equipe"), { target: { value: "Van sai às 10h" } });
    fireEvent.change(fieldByLabel("Contratante"), { target: { value: "Prefeitura X" } });
    fireEvent.change(fieldByLabel("Cidade do Contratante"), { target: { value: "Campina Grande" } });
    fireEvent.change(fieldByLabel("Telefone do Contratante"), { target: { value: "(83) 99999-0000" } });
    fireEvent.change(fieldByLabel("Observações Gerais"), { target: { value: "Portão pelos fundos" } });

    fireEvent.click(screen.getByRole("button", { name: "Criar Evento" }));

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    expect(mocks.eventInserts[0]).toMatchObject({
      name: "Show com campos",
      date: EXPECTED_DATE,
      state: "PB",
      setup_time: "14:00",
      staff_notes: "Van sai às 10h",
      contratante_nome: "Prefeitura X",
      contratante_cidade: "Campina Grande",
      contratante_telefone: "(83) 99999-0000",
      observations: "Portão pelos fundos",
    });
    // observations recebe SÓ a observação geral, sem cópia dos outros campos
    expect(mocks.eventInserts[0].observations).toBe("Portão pelos fundos");
  });

  it("criação: novos campos vazios (ou só espaços) gravam null, sem placeholder", async () => {
    renderCreate();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Show enxuto" } });
    await pickDay15();
    fireEvent.change(fieldByLabel("Estado / UF"), { target: { value: "  " } });
    fireEvent.change(fieldByLabel("Contratante"), { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "Criar Evento" }));

    await waitFor(() => expect(mocks.eventInserts).toHaveLength(1));
    for (const key of [
      "state",
      "setup_time",
      "staff_notes",
      "contratante_nome",
      "contratante_cidade",
      "contratante_telefone",
    ]) {
      expect(mocks.eventInserts[0][key]).toBeNull();
    }
    expect(Object.values(mocks.eventInserts[0])).not.toContain("");
    expect(Object.values(mocks.eventInserts[0])).not.toContain("Opcional");
  });

  it("edição: carrega os novos campos e um novo save os mantém (item 19)", async () => {
    mocks.event = {
      id: "event-x",
      empresa_id: "company-1",
      name: "Evento com campos",
      city: "Campina Grande",
      state: "PB",
      venue: null,
      artist: "Banda Y",
      status: "confirmado",
      num_days: 1,
      date: "2026-09-10",
      show_time: "21:00:00",
      observations: "Obs geral",
      logistics_departure: null,
      material_list: null,
      setup_time: "15:30",
      staff_notes: "Equipe chega 08h",
      contratante_nome: "Produtora Z",
      contratante_cidade: "João Pessoa",
      contratante_telefone: "(83) 3333-1111",
    };
    mocks.days = [
      { id: "d1", event_id: "event-x", empresa_id: "company-1", day_number: 1, date: "2026-09-10", artist: "Banda Y", show_time: "21:00:00", observations: null },
    ];

    renderEdit();
    await screen.findByDisplayValue("Evento com campos");

    expect((fieldByLabel("Estado / UF") as HTMLInputElement).value).toBe("PB");
    expect((fieldByLabel("Horário de Montagem") as HTMLInputElement).value).toBe("15:30");
    expect((fieldByLabel("Informações para a Equipe") as HTMLTextAreaElement).value).toBe("Equipe chega 08h");
    expect((fieldByLabel("Contratante") as HTMLInputElement).value).toBe("Produtora Z");
    expect((fieldByLabel("Cidade do Contratante") as HTMLInputElement).value).toBe("João Pessoa");
    expect((fieldByLabel("Telefone do Contratante") as HTMLInputElement).value).toBe("(83) 3333-1111");

    fireEvent.change(screen.getByDisplayValue("Evento com campos"), { target: { value: "Evento renomeado" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    await waitFor(() => expect(mocks.eventUpdates).toHaveLength(1));
    expect(mocks.eventUpdates[0]).toMatchObject({
      name: "Evento renomeado",
      state: "PB",
      setup_time: "15:30",
      staff_notes: "Equipe chega 08h",
      contratante_nome: "Produtora Z",
      contratante_cidade: "João Pessoa",
      contratante_telefone: "(83) 3333-1111",
      observations: "Obs geral",
    });
  });

  it("edição: apagar um campo próprio grava null (não string vazia)", async () => {
    mocks.event = {
      id: "event-x",
      empresa_id: "company-1",
      name: "Evento com campos",
      city: null,
      state: "PB",
      venue: null,
      artist: null,
      status: "pendente",
      num_days: 1,
      date: "2026-09-10",
      show_time: null,
      observations: null,
      logistics_departure: null,
      material_list: null,
      setup_time: "15:30",
      staff_notes: null,
      contratante_nome: "Produtora Z",
      contratante_cidade: null,
      contratante_telefone: null,
    };
    mocks.days = [
      { id: "d1", event_id: "event-x", empresa_id: "company-1", day_number: 1, date: "2026-09-10", artist: null, show_time: null, observations: null },
    ];

    renderEdit();
    await screen.findByDisplayValue("Evento com campos");

    fireEvent.change(fieldByLabel("Estado / UF"), { target: { value: "" } });
    fireEvent.change(fieldByLabel("Contratante"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    await waitFor(() => expect(mocks.eventUpdates).toHaveLength(1));
    expect(mocks.eventUpdates[0].state).toBeNull();
    expect(mocks.eventUpdates[0].contratante_nome).toBeNull();
  });
});
