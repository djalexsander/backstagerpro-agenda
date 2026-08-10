import { supabase } from "@/integrations/supabase/client";
import type {
  ClientReceivableSummary,
  FinancialLedgerStatus,
  MaintenanceExpenseEntry,
  MaintenanceExpensesSummary,
  RentalFinancialSummary,
  RentalsFinancialSummary,
  ReceivableEntry,
} from "./financial-ledger-types";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwFinancialError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    FN003: "O módulo Financeiro não está ativo para esta empresa.",
    FN004: "A empresa está em modo somente leitura.",
    FN005: "Informe um valor válido.",
    FN006: "Esta locação ainda não gerou um lançamento financeiro.",
    FN007: "Este título já está cancelado.",
    FN008: "O valor informado excede o saldo pendente.",
    FN016: "Informe a justificativa do estorno.",
    FN017: "Um estorno não pode ser estornado.",
    FN018: "O valor do estorno excede o saldo estornável deste recebimento.",
    FN019: "Recebimento não encontrado.",
    FN020: "Parcela não encontrada para esta locação.",
    FN021: "Informe a parcela para este lançamento parcelado.",
    FN022: "Este lançamento é à vista; não informe parcela.",
  };
  const message = (error?.code && messages[error.code]) || error?.message || "Falha na operação financeira.";
  console.error(`[financial-ledger-service] ${context}`, error);
  throw new Error(message);
}

export interface ReceivablesFilters {
  status?: FinancialLedgerStatus;
  search?: string;
  onlyOverdue?: boolean;
  onlyNeedsDueDateReview?: boolean;
}

export async function listReceivables(
  companyId: string,
  page: number,
  pageSize: number,
  filters: ReceivablesFilters = {},
): Promise<{ items: ReceivableEntry[]; total: number }> {
  const { data, error } = await callRpc("listar_contas_receber", {
    _empresa_id: companyId,
    _status: filters.status,
    _busca: filters.search?.trim() || undefined,
    _somente_vencidos: filters.onlyOverdue ?? false,
    _pagina: page,
    _por_pagina: pageSize,
    _somente_revisao: filters.onlyNeedsDueDateReview ?? false,
  });
  if (error) throwFinancialError(error, "list receivables");
  const rows = (data ?? []) as Array<{ item: ReceivableEntry; total_count: number }>;
  return {
    items: rows.map((row) => row.item),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export async function listClientsReceivable(companyId: string): Promise<ClientReceivableSummary[]> {
  const { data, error } = await callRpc("listar_clientes_a_receber", {
    _empresa_id: companyId,
  });
  if (error) throwFinancialError(error, "list clients receivable");
  return (data ?? []) as ClientReceivableSummary[];
}

// There is no RPC to list a single client's titles directly - listar_contas_receber
// only filters by status/search/company. Reusing it with the client's own name as
// the search term (server-side ILIKE) and then narrowing to an exact cliente_id
// match client-side avoids adding a new RPC just for this drill-down. Scoped to
// "em aberto" (pendente/parcial), matching how listar_clientes_a_receber itself
// counts quantidade_titulos for that same client.
export async function listClientReceivableEntries(
  companyId: string,
  clientId: string,
  clientName: string,
): Promise<ReceivableEntry[]> {
  const { items } = await listReceivables(companyId, 1, 100, { search: clientName });
  return items.filter((item) => item.cliente_id === clientId && ["pendente", "parcial"].includes(item.status));
}

export async function getRentalFinancialSummary(
  companyId: string,
  rentalId: string,
): Promise<RentalFinancialSummary | null> {
  const { data, error } = await callRpc("obter_financeiro_locacao", {
    _locacao_id: rentalId,
    _empresa_id: companyId,
  });
  if (error) throwFinancialError(error, "get rental financial summary");
  return (data ?? null) as RentalFinancialSummary | null;
}

export async function getRentalsFinancialSummary(companyId: string): Promise<RentalsFinancialSummary> {
  const { data, error } = await callRpc("obter_resumo_financeiro_locacoes", {
    _empresa_id: companyId,
  });
  if (error) throwFinancialError(error, "get rentals financial summary");
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        valor_contratado: number;
        valor_recebido: number;
        valor_a_receber: number;
        valor_vencido: number;
        valor_pendente_regularizacao: number;
      }
    | undefined;
  return {
    valorContratado: Number(row?.valor_contratado ?? 0),
    valorRecebido: Number(row?.valor_recebido ?? 0),
    valorAReceber: Number(row?.valor_a_receber ?? 0),
    valorVencido: Number(row?.valor_vencido ?? 0),
    valorPendenteRegularizacao: Number(row?.valor_pendente_regularizacao ?? 0),
  };
}

export async function registerRentalReceipt(
  companyId: string,
  input: {
    rentalId: string;
    amount: number;
    paymentMethod?: string;
    receivedAt?: string;
    note?: string;
    clientUuid: string;
    installmentId?: string;
  },
): Promise<RentalFinancialSummary> {
  const { data, error } = await callRpc("registrar_recebimento_locacao", {
    _empresa_id: companyId,
    _locacao_id: input.rentalId,
    _valor: input.amount,
    _forma_pagamento: input.paymentMethod || undefined,
    _data_recebimento: input.receivedAt || undefined,
    _observacao: input.note?.trim() || undefined,
    _client_uuid: input.clientUuid,
    _parcela_id: input.installmentId || undefined,
  });
  if (error) throwFinancialError(error, "register receipt");
  return data as RentalFinancialSummary;
}

// Categoria "Manutenções" no Financeiro: lançamentos de despesa sincronizados
// por transicionar_ordem_manutencao quando uma ordem é concluída (ver
// 20260808120000_equipment_maintenance_financial_integration.sql). Já nascem
// liquidados - não há fluxo de "receber" aqui, só consulta.
export async function listMaintenanceExpenses(
  companyId: string,
  page: number,
  pageSize: number,
  search?: string,
): Promise<{ items: MaintenanceExpenseEntry[]; total: number }> {
  const { data, error } = await callRpc("listar_despesas_manutencao", {
    _empresa_id: companyId,
    _pagina: page,
    _por_pagina: pageSize,
    _busca: search?.trim() || undefined,
  });
  if (error) throwFinancialError(error, "list maintenance expenses");
  const rows = (data ?? []) as Array<{ item: MaintenanceExpenseEntry; total_count: number }>;
  return {
    items: rows.map((row) => row.item),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export async function getMaintenanceExpensesSummary(companyId: string): Promise<MaintenanceExpensesSummary> {
  const { data, error } = await callRpc("obter_resumo_financeiro_manutencoes", {
    _empresa_id: companyId,
  });
  if (error) throwFinancialError(error, "get maintenance expenses summary");
  const row = (Array.isArray(data) ? data[0] : data) as
    | { valor_total: number; quantidade_ordens: number }
    | undefined;
  return {
    valorTotal: Number(row?.valor_total ?? 0),
    quantidadeOrdens: Number(row?.quantidade_ordens ?? 0),
  };
}

export async function reverseRentalReceipt(
  companyId: string,
  input: {
    receiptId: string;
    justification: string;
    clientUuid: string;
    amount?: number;
  },
): Promise<RentalFinancialSummary> {
  const { data, error } = await callRpc("estornar_recebimento_locacao", {
    _empresa_id: companyId,
    _recebimento_id: input.receiptId,
    _justificativa: input.justification,
    _client_uuid: input.clientUuid,
    _valor: input.amount || undefined,
  });
  if (error) throwFinancialError(error, "reverse receipt");
  return data as RentalFinancialSummary;
}
