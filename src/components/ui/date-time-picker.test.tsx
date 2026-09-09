import { fireEvent, render, screen, within } from "@testing-library/react";
import { format } from "date-fns";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DateTimePicker } from "./date-time-picker";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const timeInput = () => screen.getByLabelText("Hora") as HTMLInputElement;

async function pickDay(day: string) {
  // nos testes que chamam isto o único <button> é o gatilho de data
  fireEvent.click(screen.getByRole("button"));
  const grid = await screen.findByRole("grid");
  const cell = within(grid)
    .getAllByRole("gridcell")
    .find(
      (candidate) =>
        candidate.textContent?.trim() === day &&
        !candidate.className.includes("day-outside") &&
        !candidate.hasAttribute("disabled"),
    );
  if (!cell) throw new Error(`dia ${day} não encontrado no calendário`);
  fireEvent.click(cell);
}

describe("DateTimePicker (substitui datetime-local)", () => {
  it("mostra a data como DD/MM/AAAA e a hora em HH:mm a partir de YYYY-MM-DDTHH:mm", () => {
    render(<DateTimePicker value="2026-09-01T14:30" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "01/09/2026" })).toBeInTheDocument();
    expect(timeInput().value).toBe("14:30");
  });

  it("vazio: placeholder na data e hora em branco", () => {
    render(<DateTimePicker value="" onChange={vi.fn()} placeholder="Previsão" />);
    expect(screen.getByRole("button", { name: "Previsão" })).toBeInTheDocument();
    expect(timeInput().value).toBe("");
  });

  it("troca só a hora e preserva a data", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T14:30" onChange={onChange} />);
    fireEvent.change(timeInput(), { target: { value: "09:15" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-01T09:15");
  });

  it("troca só a data e preserva a hora", async () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-10T08:00" onChange={onChange} />);
    await pickDay("15");
    expect(onChange).toHaveBeenCalledWith("2026-09-15T08:00");
  });

  it("escolher data com a hora ainda vazia assume 00:00", async () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="" onChange={onChange} />);
    await pickDay("15");
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-15T00:00$/));
  });

  it("definir a hora com a data ainda vazia assume hoje (local, sem fuso)", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="" onChange={onChange} />);
    fireEvent.change(timeInput(), { target: { value: "07:45" } });
    expect(onChange).toHaveBeenCalledWith(`${format(new Date(), "yyyy-MM-dd")}T07:45`);
  });

  it("sem conversão de fuso: trocar a hora nunca muda o dia", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-01-01T23:30" onChange={onChange} />);
    fireEvent.change(timeInput(), { target: { value: "00:15" } });
    expect(onChange).toHaveBeenCalledWith("2026-01-01T00:15");
  });

  it("ignora segundos na entrada (YYYY-MM-DDTHH:mm:ss) e emite só HH:mm", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T14:30:59" onChange={onChange} />);
    expect(timeInput().value).toBe("14:30");
    fireEvent.change(timeInput(), { target: { value: "10:00" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-01T10:00");
  });

  it("clearable: mostra o 'x' e limpa data + hora de uma vez", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T14:30" onChange={onChange} clearable />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar data e hora" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("sem clearable: nenhuma ação de limpar mesmo com valor", () => {
    render(<DateTimePicker value="2026-09-01T14:30" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Limpar data e hora" })).not.toBeInTheDocument();
  });

  it("clearable sem valor: não mostra o 'x'", () => {
    render(<DateTimePicker value="" onChange={vi.fn()} clearable />);
    expect(screen.queryByRole("button", { name: "Limpar data e hora" })).not.toBeInTheDocument();
  });

  it("disabled: data e hora desabilitadas e sem 'x'", () => {
    render(<DateTimePicker value="2026-09-01T14:30" onChange={vi.fn()} clearable disabled />);
    expect(screen.getByRole("button", { name: "01/09/2026" })).toBeDisabled();
    expect(timeInput()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Limpar data e hora" })).not.toBeInTheDocument();
  });
});
