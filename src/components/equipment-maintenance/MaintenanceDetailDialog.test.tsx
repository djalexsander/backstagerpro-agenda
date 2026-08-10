import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceDetailDialog } from "./MaintenanceDetailDialog";
import type { MaintenanceDetail } from "@/lib/equipment-maintenance-types";

const { getMaintenanceOrder, updateMaintenanceOrder, transitionMaintenanceOrder, addMaintenanceSupply } = vi.hoisted(() => ({
  getMaintenanceOrder: vi.fn(),
  updateMaintenanceOrder: vi.fn(),
  transitionMaintenanceOrder: vi.fn(),
  addMaintenanceSupply: vi.fn(),
}));
vi.mock("@/lib/equipment-maintenance-service", () => ({
  getMaintenanceOrder, updateMaintenanceOrder, transitionMaintenanceOrder, addMaintenanceSupply,
}));

const baseOrder: MaintenanceDetail = {
  id: "order-1", empresa_id: "company-1", material_id: "material-1", numero: "MAN-2026-000001",
  tipo: "corretiva", status: "em_manutencao", prioridade: "normal", origem: "manual",
  quantidade_afetada: 1, material_nome: "Console A1", material_codigo: "COD-1",
  identificador_unico: null, numero_serie: null, numero_patrimonio: null,
  responsavel_nome: null, aberta_em: "2026-08-08T12:00:00.000Z", previsao_conclusao_em: null,
  custo_total: 0, atrasada: false,
  defeito_relatado: "Não liga", diagnostico: null, servico_executado: null,
  condicao_entrada: null, condicao_saida: null, observacoes: null,
  modalidade_execucao: "interna", responsavel_tipo: null, responsavel_usuario_id: null,
  responsavel_funcionario_id: null, fornecedor_externo: null,
  iniciada_em: "2026-08-08T12:00:00.000Z", concluida_em: null, cancelada_em: null,
  intervalo_preventivo_dias: null, proxima_preventiva_em: null,
  custo_mao_obra: 0, custo_pecas: 0, custo_outros: 0, updated_at: "2026-08-08T12:00:00.000Z",
  material: {
    id: "material-1", nome: "Console A1", codigo_interno: "COD-1", identificador_unico: "id-1",
    codigo_barras: null, conteudo_qr_code: null, numero_serie: null, numero_patrimonio: null,
    tipo_controle: "individual", unidade_medida: "unidade", quantidade: 1, quantidade_em_manutencao: 1,
    status_operacional: "em_manutencao", foto_path: null,
  },
  insumos: [], historico: [], checkin_origem: null,
};

// Radix Label has no htmlFor/id wired to its field in this dialog (pre-existing
// across the codebase's dialogs), so getByLabelText can't find these inputs -
// the label and its field are DOM siblings instead.
function fieldAfterLabel(text: string) {
  return screen.getByText(text).nextElementSibling as HTMLElement;
}

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MaintenanceDetailDialog
        open
        onOpenChange={vi.fn()}
        companyId="company-1"
        orderId="order-1"
        responsibles={[]}
        canWrite
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}

describe("MaintenanceDetailDialog conclusion flow", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    getMaintenanceOrder.mockReset().mockResolvedValue(baseOrder);
    updateMaintenanceOrder.mockReset();
    transitionMaintenanceOrder.mockReset();
    addMaintenanceSupply.mockReset();
  });

  it("keeps 'Concluir manutenção' disabled and explains what's missing until the technical fields are filled", async () => {
    renderDialog();

    const button = await screen.findByRole("button", { name: /Concluir manutenção/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Para concluir: preencha diagnóstico, serviço executado, condição de saída\./i)).toBeInTheDocument();
  });

  it("is absent for an order that hasn't started yet (aberta can't jump straight to concluída)", async () => {
    getMaintenanceOrder.mockResolvedValue({ ...baseOrder, status: "aberta" });
    renderDialog();

    await screen.findByText("Diagnóstico");
    expect(screen.queryByRole("button", { name: /Concluir manutenção/i })).not.toBeInTheDocument();
  });

  it("saves the technical fields and transitions to concluída in a single click once everything is filled", async () => {
    const saved = { ...baseOrder, diagnostico: "Fonte queimada", servico_executado: "Fonte substituída", condicao_saida: "Operacional", updated_at: "2026-08-08T13:00:00.000Z" };
    updateMaintenanceOrder.mockResolvedValue(saved);
    transitionMaintenanceOrder.mockResolvedValue({ ...saved, status: "concluida" });

    renderDialog();
    await screen.findByRole("button", { name: /Concluir manutenção/i });

    fireEvent.change(fieldAfterLabel("Diagnóstico"), { target: { value: "Fonte queimada" } });
    fireEvent.change(fieldAfterLabel("Serviço executado"), { target: { value: "Fonte substituída" } });
    fireEvent.change(fieldAfterLabel("Condição de saída"), { target: { value: "Operacional" } });

    const button = screen.getByRole("button", { name: /Concluir manutenção/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(transitionMaintenanceOrder).toHaveBeenCalledTimes(1));
    expect(updateMaintenanceOrder).toHaveBeenCalledTimes(1);
    const [savedCompanyId, , savedInput] = updateMaintenanceOrder.mock.calls[0];
    expect(savedCompanyId).toBe("company-1");
    expect(savedInput).toEqual(expect.objectContaining({ diagnosis: "Fonte queimada", service: "Fonte substituída", exitCondition: "Operacional" }));

    const [transitionCompanyId, transitionOrderArg, transitionStatus] = transitionMaintenanceOrder.mock.calls[0];
    expect(transitionCompanyId).toBe("company-1");
    expect(transitionStatus).toBe("concluida");
    // Must transition using the just-saved order (fresh updated_at), never the
    // stale one loaded before saving - otherwise the RPC's optimistic
    // concurrency check (MT015) would reject it.
    expect(transitionOrderArg.updated_at).toBe("2026-08-08T13:00:00.000Z");
  });
});
