// Only entry point for check-in/check-out data access: every export here
// calls a Supabase RPC. There is no direct insert/update/delete against the
// custody or stock tables from the frontend — mutations and their stock
// side effects happen atomically inside the RPCs. See
// docs/checkin-checkout-guide.md.
import { supabase } from "@/integrations/supabase/client";
import { translateCustodyError } from "./checkin-checkout-errors";
import type {
  CancelCheckoutInput,
  CheckinInput,
  CheckoutInput,
  CustodyFilters,
  CustodyEventView,
  CustodyIndicators,
  CustodyMaterialSearchResult,
  CustodyOperationPage,
  CustodyOperationView,
  CustodyResponsibleOption,
  CustodyWriteOffInput,
} from "./checkin-checkout-types";

function throwCustodyError(error: unknown, context: string): never {
  const translated = translateCustodyError(error);
  if (!translated.handled) {
    console.error(`[checkin-checkout-service] ${context}`, error);
  }
  throw translated;
}

export async function searchCustodyMaterials(
  companyId: string,
  search: string,
): Promise<CustodyMaterialSearchResult[]> {
  const { data, error } = await supabase.rpc("buscar_materiais_custodia", {
    _empresa_id: companyId,
    _busca: search,
    _limite: 12,
  });
  if (error) throwCustodyError(error, "search materials");
  return (data ?? []).map(
    (row) => row.item as unknown as CustodyMaterialSearchResult,
  );
}

export async function listCustodyOperations({
  companyId,
  page,
  pageSize,
  filters,
  onlyOpen,
}: {
  companyId: string;
  page: number;
  pageSize: number;
  filters: CustodyFilters;
  onlyOpen: boolean | null;
}): Promise<CustodyOperationPage> {
  const { data, error } = await supabase.rpc("listar_custodias_materiais", {
    _empresa_id: companyId,
    _pagina: page,
    _tamanho_pagina: pageSize,
    _busca: filters.search.trim() || undefined,
    _status: filters.status === "todos" ? undefined : filters.status,
    _finalidade:
      filters.purpose === "todos" ? undefined : filters.purpose,
    _responsavel: filters.responsible.trim() || undefined,
    _executor_id: filters.executorId || undefined,
    _localizacao_id: filters.locationId || undefined,
    _data_inicio: filters.dateFrom || undefined,
    _data_fim: filters.dateTo || undefined,
    _somente_abertas: onlyOpen ?? undefined,
  });
  if (error) throwCustodyError(error, "list operations");
  const rows = data ?? [];
  return {
    items: rows.map(
      (row) => row.item as unknown as CustodyOperationView,
    ),
    total: rows[0]?.total_count ?? 0,
  };
}

export async function getCustodyIndicators(
  companyId: string,
): Promise<CustodyIndicators> {
  const { data, error } = await supabase.rpc("obter_indicadores_custodia", {
    _empresa_id: companyId,
  });
  if (error) throwCustodyError(error, "get indicators");
  const result = data as unknown as Partial<CustodyIndicators> | null;
  return {
    itens_fora: Number(result?.itens_fora ?? 0),
    previstos_hoje: Number(result?.previstos_hoje ?? 0),
    atrasados: Number(result?.atrasados ?? 0),
    ocorrencias: Number(result?.ocorrencias ?? 0),
  };
}

export async function listCustodyResponsibles(
  companyId: string,
): Promise<CustodyResponsibleOption[]> {
  const { data, error } = await supabase.rpc("listar_responsaveis_custodia", {
    _empresa_id: companyId,
  });
  if (error) throwCustodyError(error, "list responsibles");
  return data ?? [];
}

export async function listCustodyEvents(
  companyId: string,
  custodyId: string,
): Promise<CustodyEventView[]> {
  const { data, error } = await supabase.rpc("listar_eventos_custodia", {
    _empresa_id: companyId,
    _custodia_id: custodyId,
  });
  if (error) throwCustodyError(error, "list custody events");
  return (data ?? []).map((row) => row.item as unknown as CustodyEventView);
}

export async function registerCheckout(
  companyId: string,
  input: CheckoutInput,
): Promise<void> {
  const { error } = await supabase.rpc("registrar_checkout_material", {
    _empresa_id: companyId,
    _material_id: input.materialId,
    _quantidade: input.quantity,
    _localizacao_origem_id: input.originLocationId,
    _responsavel_tipo: input.responsibleType,
    _responsavel_id: input.responsibleId,
    _finalidade: input.purpose,
    _condicao_saida: input.condition,
    _client_uuid: input.clientUuid,
    _previsao_retorno: input.expectedReturn || undefined,
    _observacao: input.note?.trim() || undefined,
    _referencia_tipo: input.referenceType || undefined,
    _referencia_id: input.referenceId || undefined,
    _data_efetiva: input.effectiveAt || undefined,
  });
  if (error) throwCustodyError(error, "register checkout");
}

export async function registerCheckin(
  companyId: string,
  input: CheckinInput,
): Promise<void> {
  const { error } = await supabase.rpc("registrar_checkin_material", {
    _empresa_id: companyId,
    _custodia_id: input.custodyId,
    _quantidade: input.quantity,
    _localizacao_destino_id: input.destinationLocationId,
    _condicao_retorno: input.returnCondition,
    _client_uuid: input.clientUuid,
    _observacao: input.note?.trim() || undefined,
    _ocorrencia: input.occurrence?.trim() || undefined,
    _data_efetiva: input.effectiveAt || undefined,
  });
  if (error) throwCustodyError(error, "register checkin");
}

export async function cancelCheckout(
  companyId: string,
  input: CancelCheckoutInput,
): Promise<void> {
  const { error } = await supabase.rpc("cancelar_checkout_material", {
    _empresa_id: companyId,
    _custodia_id: input.custodyId,
    _justificativa: input.justification.trim(),
    _client_uuid: input.clientUuid,
    _data_efetiva: input.effectiveAt || undefined,
  });
  if (error) throwCustodyError(error, "cancel checkout");
}

export async function registerCustodyWriteOff(
  companyId: string,
  input: CustodyWriteOffInput,
): Promise<void> {
  const { error } = await supabase.rpc("registrar_baixa_custodia_material", {
    _empresa_id: companyId,
    _custodia_id: input.custodyId,
    _quantidade: input.quantity,
    _classificacao: input.classification,
    _justificativa: input.justification.trim(),
    _client_uuid: input.clientUuid,
    _observacao: input.note?.trim() || undefined,
    _data_efetiva: input.effectiveAt || undefined,
  });
  if (error) throwCustodyError(error, "register custody write-off");
}
