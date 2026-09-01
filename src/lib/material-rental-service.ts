import { supabase } from "@/integrations/supabase/client";
import type {
  CreateRentalInput,
  CustomerOption,
  RentalDetail,
  RentalFilters,
  RentalIndicators,
  RentalListItem,
  RentalMaterialOption,
  SaveRentalItemInput,
} from "./material-rental-types";
import type { PaymentCondition } from "./financial-ledger-types";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwRentalError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    LR012: "A quantidade não está disponível para esse período.",
    LR013: "A operação foi repetida com dados diferentes.",
    LR014: "A locação não permite essa ação no estado atual.",
    LR015: "A quantidade supera o que ainda pode ser retirado.",
    LR016: "A locação possui retirada e não pode ser cancelada.",
    LR017: "Ainda existem retiradas ou devoluções pendentes.",
    FN010: "Condição de pagamento inválida.",
    FN011: "Informe ao menos uma parcela.",
    FN012: "A soma das parcelas deve ser igual ao valor da locação.",
    FN013: "Cada parcela deve ter um valor positivo.",
    FN014: "Cada parcela deve ter um vencimento.",
    FN015: "Informe o vencimento da cobrança à vista.",
  };
  const message = (error?.code && messages[error.code]) || error?.message || "Falha na operação de locação.";
  console.error(`[material-rental-service] ${context}`, error);
  throw new Error(message);
}

// Single source of truth for "what else needs to refetch after a rental row
// changes" - shared between useMaterialRentals' own invalidateRentals (run
// after a local mutation) and the realtime domain registry (src/lib/realtime/
// realtime-domains.ts, run after a Postgres Changes event from any terminal).
export const RENTAL_INVALIDATION_QUERY_KEYS = [
  "material-rentals",
  "material-rental-indicators",
  "material-rental-detail",
  "material-custodies",
  "stock-materials",
  "stock-movements",
  "rental-customers",
] as const;

export async function listRentalCustomers(companyId: string, search = "", limit = 150) {
  const { data, error } = await callRpc("listar_clientes", {
    _empresa_id: companyId,
    _busca: search || undefined,
    _somente_ativos: true,
    _limite: limit,
  });
  if (error) throwRentalError(error, "list customers");
  return (data ?? []) as CustomerOption[];
}

export async function saveRentalCustomer(
  companyId: string,
  input: {
    personType: "pessoa_fisica" | "pessoa_juridica";
    name: string;
    fantasyName?: string;
    document?: string;
    email?: string;
    phone?: string;
    notes?: string;
  },
) {
  const { data, error } = await callRpc("salvar_cliente", {
    _empresa_id: companyId,
    _tipo_pessoa: input.personType,
    _nome: input.name,
    _nome_fantasia: input.fantasyName || undefined,
    _cpf_cnpj: input.document || undefined,
    _email: input.email || undefined,
    _telefone: input.phone || undefined,
    _observacoes: input.notes || undefined,
  });
  if (error) throwRentalError(error, "save customer");
  return data as CustomerOption;
}

export async function listMaterialRentals({
  companyId,
  page,
  pageSize,
  filters,
}: {
  companyId: string;
  page: number;
  pageSize: number;
  filters: RentalFilters;
}) {
  const { data, error } = await callRpc("listar_locacoes_materiais", {
    _empresa_id: companyId,
    _pagina: page,
    _por_pagina: pageSize,
    _busca: filters.search.trim() || undefined,
    _status: filters.status === "todos" ? undefined : filters.status,
    _cliente_id: filters.customerId || undefined,
    _inicio: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
    _fim: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).toISOString() : undefined,
    _somente_atrasadas: filters.overdueOnly,
    _responsavel: filters.responsible.trim() || undefined,
  });
  if (error) throwRentalError(error, "list rentals");
  const rows = (data ?? []) as Array<{ item: RentalListItem; total_count: number }>;
  return { items: rows.map((row) => row.item), total: Number(rows[0]?.total_count ?? 0) };
}

export async function getRentalIndicators(companyId: string): Promise<RentalIndicators> {
  const { data, error } = await callRpc("obter_indicadores_locacoes", {
    _empresa_id: companyId,
  });
  if (error) throwRentalError(error, "get indicators");
  const value = (data ?? {}) as Partial<RentalIndicators>;
  return {
    em_andamento: Number(value.em_andamento ?? 0),
    retiradas_hoje: Number(value.retiradas_hoje ?? 0),
    devolucoes_hoje: Number(value.devolucoes_hoje ?? 0),
    atrasadas: Number(value.atrasadas ?? 0),
  };
}

export async function getMaterialRental(companyId: string, rentalId: string) {
  const { data, error } = await callRpc("obter_locacao_material", {
    _empresa_id: companyId,
    _locacao_id: rentalId,
  });
  if (error) throwRentalError(error, "get rental");
  return data as RentalDetail;
}

export async function searchRentalMaterials({
  companyId,
  search,
  withdrawalAt,
  returnAt,
  excludeRentalId,
}: {
  companyId: string;
  search: string;
  withdrawalAt: string;
  returnAt: string;
  excludeRentalId?: string;
}) {
  const { data, error } = await callRpc("buscar_materiais_disponiveis_locacao", {
    _empresa_id: companyId,
    _busca: search,
    _retirada_prevista_em: new Date(withdrawalAt).toISOString(),
    _devolucao_prevista_em: new Date(returnAt).toISOString(),
    _locacao_excluir_id: excludeRentalId || undefined,
    _limite: 40,
  });
  if (error) throwRentalError(error, "search materials");
  return ((data ?? []) as Array<{ item: RentalMaterialOption }>).map((row) => row.item);
}

export async function createMaterialRental(companyId: string, input: CreateRentalInput) {
  const { data, error } = await callRpc("criar_locacao_material", {
    _empresa_id: companyId,
    _cliente_id: input.customerId,
    _retirada_prevista_em: new Date(input.withdrawalAt).toISOString(),
    _devolucao_prevista_em: new Date(input.returnAt).toISOString(),
    _responsavel_tipo: input.responsibleType,
    _responsavel_id: input.responsibleId,
    _client_uuid: input.clientUuid,
    _evento_id: input.eventId || undefined,
    _observacoes: input.notes?.trim() || undefined,
  });
  if (error) throwRentalError(error, "create rental");
  return data as { id: string; numero: string };
}

export async function saveMaterialRentalItem(companyId: string, input: SaveRentalItemInput) {
  const { error } = await callRpc("salvar_item_locacao_material", {
    _empresa_id: companyId,
    _locacao_id: input.rentalId,
    _material_id: input.materialId,
    _quantidade: input.quantity,
    _modalidade_cobranca: input.billingMode,
    _unidades_cobranca: input.billingUnits,
    _valor_unitario: input.unitPrice,
    _desconto: input.discount,
    _client_uuid: input.clientUuid,
    _observacoes: input.notes?.trim() || undefined,
    _item_id: input.itemId || undefined,
  });
  if (error) throwRentalError(error, "save item");
}

export async function removeMaterialRentalItem(
  companyId: string,
  rentalId: string,
  itemId: string,
) {
  const { error } = await callRpc("remover_item_locacao_material", {
    _empresa_id: companyId,
    _locacao_id: rentalId,
    _item_id: itemId,
    _client_uuid: crypto.randomUUID(),
  });
  if (error) throwRentalError(error, "remove item");
}

async function simpleRentalAction(
  action: string,
  companyId: string,
  rentalId: string,
  extra: Record<string, unknown> = {},
) {
  const { error } = await callRpc(action, {
    _empresa_id: companyId,
    _locacao_id: rentalId,
    _client_uuid: crypto.randomUUID(),
    ...extra,
  });
  if (error) throwRentalError(error, action);
}

export const confirmMaterialRental = (
  companyId: string,
  rentalId: string,
  clientUuid: string = crypto.randomUUID(),
  paymentCondition?: PaymentCondition,
) =>
  simpleRentalAction("confirmar_reserva_locacao_material", companyId, rentalId, {
    _client_uuid: clientUuid,
    _forma_cobranca: paymentCondition?.formaCobranca,
    _vencimento: paymentCondition?.formaCobranca === "avista" ? paymentCondition.vencimento : undefined,
    _parcelas: paymentCondition?.formaCobranca === "parcelado" ? paymentCondition.parcelas : undefined,
  });
export const markMaterialRentalReady = (companyId: string, rentalId: string, clientUuid: string = crypto.randomUUID()) =>
  simpleRentalAction("marcar_locacao_pronta_retirada", companyId, rentalId, { _client_uuid: clientUuid });
export const concludeMaterialRental = (companyId: string, rentalId: string, clientUuid: string = crypto.randomUUID()) =>
  simpleRentalAction("concluir_locacao_material", companyId, rentalId, { _client_uuid: clientUuid });
export const cancelMaterialRental = (companyId: string, rentalId: string, justification: string, clientUuid: string = crypto.randomUUID()) =>
  simpleRentalAction("cancelar_locacao_material", companyId, rentalId, {
    _justificativa: justification,
    _client_uuid: clientUuid,
  });

export async function registerRentalCheckout(
  companyId: string,
  input: {
    rentalId: string;
    itemId: string;
    quantity: number;
    locationId: string;
    responsibleType: "usuario" | "funcionario";
    responsibleId: string;
    condition: string;
    note?: string;
    clientUuid: string;
  },
) {
  const { error } = await callRpc("registrar_retirada_locacao_material", {
    _empresa_id: companyId,
    _locacao_id: input.rentalId,
    _item_id: input.itemId,
    _quantidade: input.quantity,
    _localizacao_origem_id: input.locationId,
    _responsavel_tipo: input.responsibleType,
    _responsavel_id: input.responsibleId,
    _condicao_saida: input.condition,
    _client_uuid: input.clientUuid,
    _observacao: input.note?.trim() || undefined,
  });
  if (error) throwRentalError(error, "rental checkout");
}

export async function registerRentalCheckin(
  companyId: string,
  input: {
    rentalId: string;
    custodyId: string;
    quantity: number;
    locationId: string;
    returnCondition: string;
    occurrence?: string;
    note?: string;
    clientUuid: string;
  },
) {
  const { error } = await callRpc("registrar_devolucao_locacao_material", {
    _empresa_id: companyId,
    _locacao_id: input.rentalId,
    _custodia_id: input.custodyId,
    _quantidade: input.quantity,
    _localizacao_destino_id: input.locationId,
    _condicao_retorno: input.returnCondition,
    _client_uuid: input.clientUuid,
    _observacao: input.note?.trim() || undefined,
    _ocorrencia: input.occurrence?.trim() || undefined,
  });
  if (error) throwRentalError(error, "rental checkin");
}
