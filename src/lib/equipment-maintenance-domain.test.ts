import { describe, expect, it } from "vitest";
import { calculateMaintenanceTotal, calculateNextPreventive, canTransitionMaintenance, getMaintenanceActions, normalizeMaintenanceSearch } from "./equipment-maintenance-domain";
import type { MaintenanceDetail, MaintenancePriority } from "./equipment-maintenance-types";

const detail = (status: MaintenanceDetail["status"]): MaintenanceDetail => ({
  id: "order", empresa_id: "company", material_id: "material", numero: "MAN-2026-000001", tipo: "corretiva",
  status, prioridade: "normal", origem: "manual", quantidade_afetada: 1, material_nome: "Mesa", material_codigo: "MES-1",
  identificador_unico: "id", numero_serie: null, numero_patrimonio: null, responsavel_nome: null,
  aberta_em: "2026-08-02T10:00:00Z", previsao_conclusao_em: null, custo_total: 0, atrasada: false,
  defeito_relatado: "Não liga", diagnostico: "Fonte queimada", servico_executado: "Fonte substituída",
  condicao_entrada: "Danificado", condicao_saida: "Operacional", observacoes: null, modalidade_execucao: "interna",
  responsavel_tipo: null, responsavel_usuario_id: null, responsavel_funcionario_id: null, fornecedor_externo: null,
  iniciada_em: null, concluida_em: null, cancelada_em: null, intervalo_preventivo_dias: null,
  proxima_preventiva_em: null, custo_mao_obra: 0, custo_pecas: 0, custo_outros: 0, updated_at: "2026-08-02T10:00:00Z",
  material: { id: "material", nome: "Mesa", codigo_interno: "MES-1", identificador_unico: "id", codigo_barras: null,
    conteudo_qr_code: null, numero_serie: null, numero_patrimonio: null, tipo_controle: "individual", unidade_medida: "un",
    quantidade: 1, quantidade_em_manutencao: 1, status_operacional: "disponivel", foto_path: null },
  insumos: [], historico: [], checkin_origem: null,
});

describe("equipment maintenance domain", () => {
  it("permite somente transições explícitas e mantém terminais fechados", () => {
    expect(canTransitionMaintenance("aberta", "em_manutencao")).toBe(true);
    expect(canTransitionMaintenance("aberta", "concluida")).toBe(false);
    expect(canTransitionMaintenance("concluida", "aberta")).toBe(false);
    expect(canTransitionMaintenance("cancelada", "em_manutencao")).toBe(false);
  });
  it.each(["baixa", "normal", "alta", "critica"] satisfies MaintenancePriority[])("aceita a prioridade simples %s", (priority) => {
    expect({ ...detail("aberta"), prioridade: priority }.prioridade).toBe(priority);
  });
  it("só libera conclusão com diagnóstico, serviço e condição de saída", () => {
    expect(getMaintenanceActions(detail("em_manutencao")).canConclude).toBe(true);
    expect(getMaintenanceActions({ ...detail("em_manutencao"), diagnostico: "" }).canConclude).toBe(false);
  });
  it("calcula custos sem resíduo e rejeita negativos", () => {
    expect(calculateMaintenanceTotal(100.1, 20.2, 0.7)).toBe(121);
    expect(() => calculateMaintenanceTotal(-1, 0, 0)).toThrow(/Custos/);
  });
  it("calcula a próxima preventiva somente por data", () => {
    expect(calculateNextPreventive(new Date("2026-08-02T12:00:00Z"), 90).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(() => calculateNextPreventive(new Date(), 0)).toThrow(/Intervalo/);
  });
  it("normaliza terminadores enviados por scanner", () => expect(normalizeMaintenanceSearch("\tPAT-10\r\n")).toBe("PAT-10"));
});
