import type { MaintenanceDetail, MaintenancePriority, MaintenanceStatus } from "./equipment-maintenance-types";

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  aberta: "Aberta",
  aguardando_analise: "Aguardando análise",
  em_manutencao: "Em manutenção",
  aguardando_peca: "Aguardando peça",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const MAINTENANCE_TYPE_LABELS = { corretiva: "Corretiva", preventiva: "Preventiva", inspecao: "Inspeção" } as const;
export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", critica: "Crítica" };

const transitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  aberta: ["aguardando_analise", "em_manutencao", "cancelada"],
  aguardando_analise: ["em_manutencao", "aguardando_peca", "cancelada"],
  em_manutencao: ["aguardando_peca", "concluida", "cancelada"],
  aguardando_peca: ["em_manutencao", "concluida", "cancelada"],
  concluida: [],
  cancelada: [],
};

export function canTransitionMaintenance(from: MaintenanceStatus, to: MaintenanceStatus) {
  return transitions[from].includes(to);
}
export function getMaintenanceActions(order: Pick<MaintenanceDetail, "status" | "diagnostico" | "servico_executado" | "condicao_saida">) {
  const terminal = ["concluida", "cancelada"].includes(order.status);
  return {
    canEdit: !terminal,
    nextStatuses: transitions[order.status],
    canConclude: ["em_manutencao", "aguardando_peca"].includes(order.status)
      && Boolean(order.diagnostico?.trim() && order.servico_executado?.trim() && order.condicao_saida?.trim()),
  };
}
export function calculateMaintenanceTotal(labor: number, parts: number, other: number) {
  if ([labor, parts, other].some((value) => value < 0 || !Number.isFinite(value))) throw new Error("Custos inválidos.");
  return Math.round((labor + parts + other + Number.EPSILON) * 100) / 100;
}
export function calculateNextPreventive(completedAt: Date, intervalDays: number) {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) throw new Error("Intervalo preventivo inválido.");
  const result = new Date(completedAt);
  result.setUTCDate(result.getUTCDate() + intervalDays);
  return result;
}
export function normalizeMaintenanceSearch(value: string) {
  return value.replace(/[\r\n\t]/g, "").trim();
}
