import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FinalizeScannerSessionButton } from "./FinalizeScannerSessionButton";
import type { ScannerRemotoSessao } from "@/lib/scanner-remoto-types";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function makeSession(overrides: Partial<ScannerRemotoSessao> = {}): ScannerRemotoSessao {
  return {
    id: "session-1",
    empresa_id: "company-1",
    tipo_operacao: "misto",
    responsavel_tipo: null,
    responsavel_id: null,
    finalidade: null,
    condicao: "bom",
    localizacao_origem_id: null,
    localizacao_destino_id: null,
    referencia_tipo: null,
    referencia_id: null,
    titulo: "Load-out sexta",
    observacao: null,
    status: "aberta",
    criado_por: "user-1",
    aberta_em: "2026-09-01T10:00:00Z",
    encerrada_em: null,
    encerrada_por: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

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
  vi.clearAllMocks();
});

describe("FinalizeScannerSessionButton", () => {
  it("shows a 'Finalizar' action for an open session", () => {
    render(<FinalizeScannerSessionButton session={makeSession()} endSession={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
  });

  it("opens a confirmation with the preservation message when clicked", () => {
    render(<FinalizeScannerSessionButton session={makeSession()} endSession={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Deseja finalizar esta sessão\? As leituras e movimentações já realizadas serão preservadas\./i,
      ),
    ).toBeInTheDocument();
  });

  it("cancelling closes the confirmation without calling endSession", async () => {
    const endSession = vi.fn().mockResolvedValue({});
    render(<FinalizeScannerSessionButton session={makeSession()} endSession={endSession} />);

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(endSession).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("confirming calls the existing endSession with the session id, then onFinalized + success toast", async () => {
    const endSession = vi.fn().mockResolvedValue({});
    const onFinalized = vi.fn();
    render(
      <FinalizeScannerSessionButton
        session={makeSession({ id: "session-42" })}
        endSession={endSession}
        onFinalized={onFinalized}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() => expect(endSession).toHaveBeenCalledWith("session-42"));
    expect(endSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onFinalized).toHaveBeenCalledWith("session-42"));
    expect(toastMock).toHaveBeenCalledWith({ title: "Sessão finalizada" });
  });

  it("finalizing sends only the session id to endSession - no payload that could drop reads or movements", async () => {
    const endSession = vi.fn().mockResolvedValue({});
    render(
      <FinalizeScannerSessionButton session={makeSession({ id: "s-9" })} endSession={endSession} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() => expect(endSession).toHaveBeenCalled());
    // The component's only outward effect is endSession(id) + a toast. There is
    // no delete/clear path for scanner_remoto_leituras or custody here.
    expect(endSession.mock.calls).toEqual([["s-9"]]);
  });

  it("on failure keeps the session (no onFinalized) and reports the error, dialog stays open", async () => {
    const endSession = vi.fn().mockRejectedValue(new Error("Sessão já encerrada"));
    const onFinalized = vi.fn();
    render(
      <FinalizeScannerSessionButton
        session={makeSession()}
        endSession={endSession}
        onFinalized={onFinalized}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Sessão já encerrada" }),
      ),
    );
    expect(onFinalized).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
