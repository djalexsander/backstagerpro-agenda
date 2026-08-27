import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventDetailContent } from "./EventDetailContent";

const noop = vi.fn();

function renderContent(overrides: Record<string, unknown> = {}, eventDays: unknown[] = []) {
  const event = {
    id: "event-1",
    name: "Reserva de data",
    date: "2026-11-15",
    artist: null,
    city: null,
    venue: null,
    status: "pendente",
    num_days: 1,
    show_time: null,
    logistics_departure: null,
    observations: null,
    material_list: null,
    ...overrides,
  };
  return render(
    <EventDetailContent
      event={event}
      eventDays={eventDays as never}
      files={[] as never}
      teamMembers={[] as never}
      isAdmin={false}
      requestDownload={noop}
      handleUploadRider={noop}
      handleRemoveRider={noop}
    />,
  );
}

describe("EventDetailContent - artist/city/venue null", () => {
  it("mostra 'A definir' para local e artista quando são null (evento de dia único)", () => {
    renderContent();
    // Local (card "Informações Gerais") + Artista (card "Detalhes do Show")
    expect(screen.getAllByText("A definir").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Local:/)).toBeInTheDocument();
    expect(screen.getByText(/Artista:/)).toBeInTheDocument();
  });

  it("renderiza sem quebrar um evento multi-dia com city/venue null", () => {
    renderContent({ num_days: 2 }, [
      { id: "d1", event_id: "event-1", day_number: 1, date: "2026-11-15", artist: null, show_time: null, observations: null },
      { id: "d2", event_id: "event-1", day_number: 2, date: "2026-11-16", artist: "Banda Y", show_time: "22:00:00", observations: null },
    ]);
    expect(screen.getByText("A definir")).toBeInTheDocument(); // linha "Local:"
    expect(screen.getByText("Banda Y")).toBeInTheDocument();
  });

  it("combina venue e city quando ambos existem", () => {
    renderContent({ venue: "Teatro Central", city: "Recife" });
    expect(screen.getByText("Teatro Central, Recife")).toBeInTheDocument();
  });
});

describe("EventDetailContent - campos próprios (state/setup_time/staff_notes/contratante_*)", () => {
  it("inclui a UF na linha Local e mostra Montagem quando setup_time existe", () => {
    renderContent({ venue: "Teatro Central", city: "Recife", state: "PE", setup_time: "14:00" });
    expect(screen.getByText("Teatro Central, Recife, PE")).toBeInTheDocument();
    expect(screen.getByText(/Montagem:/)).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
  });

  it("mostra o bloco 'Informações para a equipe' a partir de staff_notes (fora de Observações)", () => {
    renderContent({ observations: "Portão pelos fundos.", staff_notes: "Van sai do hotel às 10h." });
    expect(screen.getByText("Portão pelos fundos.")).toBeInTheDocument();
    expect(screen.getByText(/Informações para a equipe:/)).toBeInTheDocument();
    expect(screen.getByText("Van sai do hotel às 10h.")).toBeInTheDocument();
  });

  it("Observações mostra somente event.observations - sem cópia de contratante/UF", () => {
    renderContent({
      observations: "Observação geral.",
      state: "PB",
      setup_time: "13:00",
      staff_notes: "Aviso da equipe.",
      contratante_nome: "Prefeitura X",
      contratante_cidade: "Campina Grande",
      contratante_telefone: "(83) 99999-0000",
    });
    const obsBlock = screen.getByText("Observação geral.");
    expect(obsBlock.textContent).toBe("Observação geral.");
    // os valores dos campos próprios não aparecem embutidos na observação
    expect(obsBlock.textContent).not.toContain("Prefeitura X");
    expect(obsBlock.textContent).not.toContain("PB");
  });

  it("renderiza o cartão Contratante com nome/cidade/telefone", () => {
    renderContent({
      contratante_nome: "Prefeitura X",
      contratante_cidade: "Campina Grande",
      contratante_telefone: "(83) 99999-0000",
    });
    expect(screen.getByText("Contratante")).toBeInTheDocument(); // título do cartão
    expect(screen.getByText("Prefeitura X")).toBeInTheDocument();
    expect(screen.getByText("Campina Grande")).toBeInTheDocument();
    expect(screen.getByText("(83) 99999-0000")).toBeInTheDocument();
  });

  it("não renderiza o cartão Contratante nem 'null' quando os campos são null (item 20)", () => {
    const { container } = renderContent({
      state: null,
      setup_time: null,
      staff_notes: null,
      contratante_nome: null,
      contratante_cidade: null,
      contratante_telefone: null,
    });
    expect(screen.queryByText("Contratante")).not.toBeInTheDocument();
    expect(screen.queryByText(/Montagem:/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null/i);
  });
});
