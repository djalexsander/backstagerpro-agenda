import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportAgendaDialog } from "./ImportAgendaDialog";
import { buildExportFile, buildRawEvent, realExportFileJson } from "@/lib/agenda-import.fixtures";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
// `from` só para provar que a fase de importação NÃO faz INSERT direto.
const fromSpy = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: (...a: unknown[]) => fromSpy(...a) },
}));

/** rpc mock: dedupe devolve `imported`, import devolve counts. */
function mockRpc({ alreadyImported = [] as string[], importResult = { imported: 0, skipped: 0 }, importError = null as string | null } = {}) {
  rpc.mockImplementation((name: string) => {
    if (name === "listar_eventos_agenda_ja_importados") {
      return Promise.resolve({ data: alreadyImported.map((id) => ({ source_event_id: id })), error: null });
    }
    if (name === "importar_agenda_eventos") {
      return importError
        ? Promise.resolve({ data: null, error: { message: importError } })
        : Promise.resolve({ data: importResult, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function makeFile(content: string, name = "agenda.json") {
  return new File([content], name, { type: "application/json" });
}
function selectFile(content: string, name?: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeFile(content, name)] } });
}

const threeNew = buildExportFile([
  buildRawEvent({ source_event_id: "s1", name: "Show 1", status: "Confirmado" }),
  buildRawEvent({ source_event_id: "s2", name: "Show 2", status: "Pendente" }),
  buildRawEvent({ source_event_id: "s3", name: "Show 3", status: "Cancelado" }),
]);

beforeEach(() => {
  fromSpy.mockClear();
  rpc.mockReset();
  mockRpc();
});
afterEach(() => vi.clearAllMocks());

describe("ImportAgendaDialog - Fase 2", () => {
  it("1. arquivo com 3 eventos novos: situação 'Novo', botão 'Salvar 3 eventos'", async () => {
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);

    expect(await screen.findByText("Show 1")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Novo")).toHaveLength(3));
    expect(screen.getByText("3 eventos serão adicionados à agenda.")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: /salvar 3 eventos/i });
    expect(saveBtn).toBeEnabled();
  });

  it("2. 1 evento já importado: mostra '↺ Já importado' e o botão conta só os novos (item 23)", async () => {
    mockRpc({ alreadyImported: ["s2"] });
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);

    await screen.findByText("Show 1");
    await waitFor(() => expect(screen.getByText("Já importado")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /salvar 2 eventos/i })).toBeInTheDocument();

    // resumo
    const jaImportados = screen.getByText("Já importados").closest("div")!;
    expect(within(jaImportados).getByText("1")).toBeInTheDocument();
  });

  it("3. todos já importados: sem botão de salvar, mensagem própria", async () => {
    mockRpc({ alreadyImported: ["s1", "s2", "s3"] });
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);

    await screen.findByText("Show 1");
    await waitFor(() =>
      expect(screen.getByText("Todos os eventos deste arquivo já foram importados.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /salvar/i })).not.toBeInTheDocument();
  });

  it("22. eventos inválidos bloqueiam o botão", async () => {
    mockRpc();
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(
      buildExportFile([
        buildRawEvent({ source_event_id: "ok", name: "Bom", status: "Confirmado" }),
        buildRawEvent({ source_event_id: "bad", name: "Ruim", status: "Adiado" }),
      ]),
    );

    await screen.findByText("Bom");
    await waitFor(() =>
      expect(screen.getByText(/1 de 2 evento\(s\) com pendência/i)).toBeInTheDocument(),
    );
    const saveBtn = screen.getByRole("button", { name: /salvar/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText("Corrija as pendências antes de importar.")).toBeInTheDocument();
  });

  it("6+11+15. salva via RPC transacional, mostra o resumo e chama onImported ao fechar (itens 11, 21)", async () => {
    mockRpc({ importResult: { imported: 3, skipped: 0 } });
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    render(<ImportAgendaDialog open onOpenChange={onOpenChange} onImported={onImported} />);
    selectFile(threeNew);
    await screen.findByText("Show 1");
    await waitFor(() => expect(screen.getByRole("button", { name: /salvar 3 eventos/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /salvar 3 eventos/i }));

    expect(await screen.findByText("Agenda importada com sucesso.")).toBeInTheDocument();
    expect(screen.getByText("Novos eventos: 3")).toBeInTheDocument();
    expect(screen.getByText("Já existentes/ignorados: 0")).toBeInTheDocument();

    // a RPC chamada é a transacional, com o source_system normalizado
    const importCall = rpc.mock.calls.find(([name]) => name === "importar_agenda_eventos");
    expect(importCall?.[1]._source_system).toBe("gestao_eventos_pro");
    expect(importCall?.[1]._eventos).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("17. duplo clique não dispara a importação duas vezes", async () => {
    let resolveImport: (v: unknown) => void = () => {};
    rpc.mockImplementation((name: string) => {
      if (name === "listar_eventos_agenda_ja_importados") return Promise.resolve({ data: [], error: null });
      return new Promise((resolve) => {
        resolveImport = resolve;
      });
    });
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);
    await screen.findByText("Show 1");
    await waitFor(() => expect(screen.getByRole("button", { name: /salvar 3 eventos/i })).toBeEnabled());

    const btn = screen.getByRole("button", { name: /salvar 3 eventos/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    resolveImport({ data: { imported: 3, skipped: 0 }, error: null });
    await screen.findByText("Agenda importada com sucesso.");

    const importCalls = rpc.mock.calls.filter(([name]) => name === "importar_agenda_eventos");
    expect(importCalls).toHaveLength(1);
  });

  it("19-lado-cliente. erro no lote: mostra que nada foi gravado, sem resumo de sucesso", async () => {
    mockRpc({ importError: "Data invalida no evento s2 do lote." });
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);
    await screen.findByText("Show 1");
    await waitFor(() => expect(screen.getByRole("button", { name: /salvar 3 eventos/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /salvar 3 eventos/i }));

    expect(await screen.findByText("A importação falhou — nada foi gravado")).toBeInTheDocument();
    expect(screen.queryByText("Agenda importada com sucesso.")).not.toBeInTheDocument();
  });

  it("28. nenhum supabase.from(...) durante todo o fluxo (só RPC)", async () => {
    mockRpc({ importResult: { imported: 3, skipped: 0 } });
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(threeNew);
    await screen.findByText("Show 1");
    await waitFor(() => expect(screen.getByRole("button", { name: /salvar 3 eventos/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /salvar 3 eventos/i }));
    await screen.findByText("Agenda importada com sucesso.");

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("24. modal com muitos eventos: header/rodapé fixos e área de eventos com scroll próprio", async () => {
    mockRpc();
    const many = buildExportFile(
      Array.from({ length: 60 }, (_, i) =>
        buildRawEvent({ source_event_id: `m${i}`, name: `Evento ${i}`, status: "Confirmado" }),
      ),
    );
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(many);
    await screen.findByText("Evento 0");

    // DialogContent é flex-col com altura limitada
    const content = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(content.className).toMatch(/flex/);
    expect(content.className).toMatch(/max-h-\[85vh\]/);

    // existe uma região rolável dedicada (min-h-0 + overflow-y-auto) contendo a tabela
    const scrollRegion = content.querySelector(".min-h-0.flex-1.overflow-y-auto");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion!.querySelector("table")).not.toBeNull();

    // rodapé continua no DOM com o botão de salvar
    expect(screen.getByRole("button", { name: /salvar 60 eventos/i })).toBeInTheDocument();
  });

  it("aceita o arquivo real e libera 'Salvar 1 evento'", async () => {
    mockRpc();
    render(<ImportAgendaDialog open onOpenChange={() => {}} />);
    selectFile(realExportFileJson);
    expect(await screen.findByText("Aniversário da Cidade")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /salvar 1 evento$/i })).toBeInTheDocument());
  });
});
