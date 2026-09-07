import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";

beforeAll(() => {
  // react-day-picker + Radix Popover tocam APIs que o jsdom 20 não implementa;
  // sem os stubs qualquer abertura do calendário quebra fora da lógica testada.
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

async function openCalendar() {
  fireEvent.click(screen.getByRole("button"));
  return screen.findByRole("grid");
}

function pickDay(grid: HTMLElement, day: string) {
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

describe("DatePicker (campo de data pura)", () => {
  it("exibe o valor YYYY-MM-DD recebido como DD/MM/AAAA no gatilho", () => {
    render(<DatePicker value="2026-09-01" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("01/09/2026");
  });

  it("mostra o placeholder quando não há valor", () => {
    render(<DatePicker value="" onChange={vi.fn()} placeholder="Selecionar vencimento" />);
    expect(screen.getByRole("button")).toHaveTextContent("Selecionar vencimento");
  });

  it("devolve YYYY-MM-DD ao escolher um dia, e fecha o calendário", async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-10" onChange={onChange} />);

    const grid = await openCalendar();
    pickDay(grid, "15");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-15");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("abre no mês do valor atual, com o mês escrito em pt-BR", async () => {
    render(<DatePicker value="2026-09-10" onChange={vi.fn()} />);
    await openCalendar();
    expect(screen.getByText(/setembro 2026/i)).toBeInTheDocument();
  });

  it("respeita disabled: o gatilho fica desabilitado e o calendário não abre", () => {
    render(<DatePicker value="" onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("trata um valor inválido como ausente (cai no placeholder, não quebra)", () => {
    render(<DatePicker value="not-a-date" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Selecionar data");
  });

  it("encaminha o id para o gatilho, casando com um <label htmlFor>", () => {
    render(
      <>
        <label htmlFor="venc">Vencimento</label>
        <DatePicker id="venc" value="" onChange={vi.fn()} />
      </>,
    );
    expect(screen.getByLabelText("Vencimento")).toBe(screen.getByRole("button"));
  });
});

describe("DatePicker - clearable", () => {
  it("sem a prop: nenhuma ação de limpar, mesmo com data (comportamento atual intacto)", () => {
    render(<DatePicker value="2026-09-01" onChange={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Limpar data" })).not.toBeInTheDocument();
  });

  it("clearable com data: exibe o 'x' e ao clicar chama onChange('')", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-01" onChange={onChange} clearable />);

    fireEvent.click(screen.getByRole("button", { name: "Limpar data" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("clearable sem data: não exibe o 'x' e o placeholder continua visível", () => {
    render(
      <DatePicker value="" onChange={vi.fn()} clearable placeholder="Selecionar vencimento" />,
    );
    expect(screen.queryByRole("button", { name: "Limpar data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Selecionar vencimento");
  });

  it("depois de limpar (value = ''), o 'x' some e o placeholder reaparece", () => {
    const { rerender } = render(
      <DatePicker value="2026-09-01" onChange={vi.fn()} clearable placeholder="Selecionar vencimento" />,
    );
    expect(screen.getByRole("button", { name: "Limpar data" })).toBeInTheDocument();

    rerender(
      <DatePicker value="" onChange={vi.fn()} clearable placeholder="Selecionar vencimento" />,
    );
    expect(screen.queryByRole("button", { name: "Limpar data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Selecionar vencimento");
  });

  it("clearable + disabled: não expõe a ação de limpar", () => {
    render(<DatePicker value="2026-09-01" onChange={vi.fn()} clearable disabled />);
    expect(screen.queryByRole("button", { name: "Limpar data" })).not.toBeInTheDocument();
  });

  it("clearable não interfere na escolha pelo calendário (ainda devolve YYYY-MM-DD)", async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-10" onChange={onChange} clearable />);

    fireEvent.click(screen.getByRole("button", { name: "10/09/2026" }));
    const grid = await screen.findByRole("grid");
    pickDay(grid, "15");

    expect(onChange).toHaveBeenLastCalledWith("2026-09-15");
  });
});
