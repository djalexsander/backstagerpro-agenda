import { supabase } from "@/integrations/supabase/client";
import type { CustodyResponsibleOption } from "./checkin-checkout-types";
import type {
  CheckinMaintenanceSuggestion, CreateMaintenanceInput, MaintenanceDetail,
  MaintenanceFilters, MaintenanceIndicators, MaintenanceListItem, MaintenanceMaterialOption,
  MaintenanceStatus,
} from "./equipment-maintenance-types";

interface RpcError { message?: string; code?: string }
type RpcCaller = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwMaintenanceError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    MT009: "Manutenção e Gestão de Materiais precisam estar ativas.",
    MT010: "A empresa está em modo somente leitura.",
    MT012: "O equipamento ou a quantidade está comprometido por outra operação.",
    MT013: "A operação foi repetida com dados diferentes.",
    MT014: "A ação não é permitida no estado atual.",
    MT015: "A ordem foi alterada em outra sessão. Recarregue os dados.",
    MT016: "Preencha diagnóstico, serviço executado e condição de saída.",
  };
  console.error(`[equipment-maintenance-service] ${context}`, error);
  throw new Error((error?.code && messages[error.code]) || error?.message || "Falha na operação de manutenção.");
}

export async function listMaintenanceOrders({ companyId, page, pageSize, filters }: {
  companyId: string; page: number; pageSize: number; filters: MaintenanceFilters;
}) {
  const { data, error } = await callRpc("listar_ordens_manutencao", {
    _empresa_id: companyId, _pagina: page, _por_pagina: pageSize,
    _busca: filters.search.trim() || undefined,
    _status: filters.status === "todos" ? undefined : filters.status,
    _tipo: filters.type === "todos" ? undefined : filters.type,
    _prioridade: filters.priority === "todos" ? undefined : filters.priority,
    _responsavel: filters.responsible.trim() || undefined,
    _material_id: filters.materialId || undefined,
    _inicio: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
    _fim: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).toISOString() : undefined,
  });
  if (error) throwMaintenanceError(error, "list orders");
  const rows = (data ?? []) as Array<{ item: MaintenanceListItem; total_count: number }>;
  return { items: rows.map((row) => row.item), total: Number(rows[0]?.total_count ?? 0) };
}
export async function getMaintenanceIndicators(companyId: string): Promise<MaintenanceIndicators> {
  const { data, error } = await callRpc("obter_indicadores_manutencao", { _empresa_id: companyId });
  if (error) throwMaintenanceError(error, "indicators");
  const value = (data ?? {}) as Partial<MaintenanceIndicators>;
  return { abertas: Number(value.abertas ?? 0), em_manutencao: Number(value.em_manutencao ?? 0),
    aguardando_peca: Number(value.aguardando_peca ?? 0), preventivas_proximas: Number(value.preventivas_proximas ?? 0), atrasadas: Number(value.atrasadas ?? 0) };
}
export async function getMaintenanceOrder(companyId: string, orderId: string) {
  const { data, error } = await callRpc("obter_ordem_manutencao", { _empresa_id: companyId, _ordem_id: orderId });
  if (error) throwMaintenanceError(error, "detail");
  return data as MaintenanceDetail;
}
export async function searchMaintenanceMaterials(companyId: string, search: string) {
  const { data, error } = await callRpc("buscar_materiais_manutencao", { _empresa_id: companyId, _busca: search, _limite: 40 });
  if (error) throwMaintenanceError(error, "search materials");
  return ((data ?? []) as Array<{ item: MaintenanceMaterialOption }>).map((row) => row.item);
}
export async function createMaintenanceOrder(companyId: string, input: CreateMaintenanceInput) {
  const { data, error } = await callRpc("criar_ordem_manutencao", {
    _empresa_id: companyId, _material_id: input.materialId, _tipo: input.type,
    _prioridade: input.priority, _origem: input.origin, _defeito_relatado: input.defect,
    _client_uuid: input.clientUuid, _quantidade_afetada: input.affectedQuantity,
    _responsavel_tipo: input.responsibleType, _responsavel_id: input.responsibleId,
    _previsao_conclusao_em: input.expectedCompletion ? new Date(input.expectedCompletion).toISOString() : undefined,
    _condicao_entrada: input.entryCondition?.trim() || undefined, _observacoes: input.notes?.trim() || undefined,
    _modalidade_execucao: input.execution, _fornecedor_externo: input.externalSupplier?.trim() || undefined,
    _intervalo_preventivo_dias: input.preventiveIntervalDays, _custodia_evento_origem_id: input.custodyEventId,
  });
  if (error) throwMaintenanceError(error, "create");
  return data as MaintenanceDetail;
}
export async function updateMaintenanceOrder(companyId: string, order: MaintenanceDetail, input: {
  priority: string; diagnosis: string; service: string; responsible?: CustodyResponsibleOption;
  expectedCompletion?: string; exitCondition: string; notes: string; execution: string;
  externalSupplier: string; preventiveIntervalDays?: number; laborCost: number; partsCost: number; otherCost: number; clientUuid: string;
}) {
  const { data, error } = await callRpc("atualizar_ordem_manutencao", {
    _empresa_id: companyId, _ordem_id: order.id, _client_uuid: input.clientUuid,
    _expected_updated_at: order.updated_at, _prioridade: input.priority,
    _diagnostico: input.diagnosis, _servico_executado: input.service,
    _responsavel_tipo: input.responsible?.tipo, _responsavel_id: input.responsible?.id,
    _previsao_conclusao_em: input.expectedCompletion ? new Date(input.expectedCompletion).toISOString() : undefined,
    _condicao_saida: input.exitCondition, _observacoes: input.notes,
    _modalidade_execucao: input.execution, _fornecedor_externo: input.externalSupplier,
    _intervalo_preventivo_dias: input.preventiveIntervalDays,
    _custo_mao_obra: input.laborCost, _custo_pecas: input.partsCost, _custo_outros: input.otherCost,
  });
  if (error) throwMaintenanceError(error, "update");
  return data as MaintenanceDetail;
}
export async function transitionMaintenanceOrder(companyId: string, order: MaintenanceDetail, status: MaintenanceStatus, justification = "", clientUuid = crypto.randomUUID()) {
  const { data, error } = await callRpc("transicionar_ordem_manutencao", {
    _empresa_id: companyId, _ordem_id: order.id, _novo_status: status,
    _client_uuid: clientUuid, _expected_updated_at: order.updated_at,
    _justificativa: justification.trim() || undefined,
  });
  if (error) throwMaintenanceError(error, "transition");
  return data as MaintenanceDetail;
}
export async function addMaintenanceSupply(companyId: string, orderId: string, input: {
  description: string; quantity: number; unit: string; unitCost: number; materialId?: string; clientUuid: string;
}) {
  const { error } = await callRpc("salvar_insumo_ordem_manutencao", {
    _empresa_id: companyId, _ordem_id: orderId, _descricao: input.description,
    _quantidade: input.quantity, _unidade: input.unit, _custo_unitario: input.unitCost,
    _material_id: input.materialId, _client_uuid: input.clientUuid,
  });
  if (error) throwMaintenanceError(error, "add supply");
}
export async function getCheckinMaintenanceSuggestion(companyId: string, custodyId: string) {
  const { data, error } = await callRpc("obter_sugestao_manutencao_checkin", { _empresa_id: companyId, _custodia_id: custodyId });
  if (error) throwMaintenanceError(error, "checkin suggestion");
  return data as CheckinMaintenanceSuggestion | null;
}
export async function getMaterialMaintenanceSummary(companyId: string, materialId: string) {
  const { data, error } = await callRpc("obter_resumo_manutencao_material", { _empresa_id: companyId, _material_id: materialId });
  if (error) throwMaintenanceError(error, "material summary");
  return data as { manutencoes_ativas: number; quantidade_indisponivel: number; ultima_manutencao_em: string | null; proxima_preventiva_em: string | null; custo_acumulado: number; historico_total: number };
}
