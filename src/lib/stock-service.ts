import { supabase } from "@/integrations/supabase/client";
import { translateStockError } from "./stock-errors";
import type {
  StockAdjustmentInput,
  StockFilters,
  StockIndicators,
  StockLocation,
  StockMaterial,
  StockMaterialPage,
  StockMovement,
  StockMovementFilters,
  StockMovementInput,
  StockMovementPage,
  StockMovementView,
  StockReversalInput,
} from "./stock-types";

function throwStockError(error: unknown, context: string): never {
  const translated = translateStockError(error);
  if (!translated.handled) console.error(`[stock-service] ${context}`, error);
  throw translated;
}

export async function listStockCompaniesForMaster() {
  const { data, error } = await supabase
    .from("empresas")
    .select("id,nome_empresa,status")
    .order("nome_empresa");
  if (error) throwStockError(error, "list master companies");
  return data ?? [];
}

export async function listStockLocations(
  companyId: string,
  includeInactive = false,
): Promise<StockLocation[]> {
  let query = supabase
    .from("estoque_localizacoes")
    .select("*")
    .eq("empresa_id", companyId)
    .order("nome");
  if (!includeInactive) query = query.eq("ativa", true);
  const { data, error } = await query;
  if (error) throwStockError(error, "list locations");
  return data ?? [];
}

export async function listStockMaterialOptions(companyId: string) {
  const { data, error } = await supabase
    .from("materiais")
    .select("id,codigo_interno,nome")
    .eq("empresa_id", companyId)
    .eq("ativo", true)
    .order("nome");
  if (error) throwStockError(error, "list material options");
  return data ?? [];
}

export async function listStockCategories(companyId: string) {
  const { data, error } = await supabase
    .from("categorias_materiais")
    .select("id,nome")
    .eq("empresa_id", companyId)
    .order("nome");
  if (error) throwStockError(error, "list stock categories");
  return data ?? [];
}

export async function listStockUsers(companyId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,full_name")
    .eq("empresa_id", companyId)
    .order("full_name");
  if (error) throwStockError(error, "list stock users");
  return data ?? [];
}

export async function saveStockLocation({
  companyId,
  id,
  code,
  name,
  type,
  parentId,
  description,
}: {
  companyId: string;
  id?: string;
  code: string;
  name: string;
  type: StockLocation["tipo"];
  parentId?: string | null;
  description?: string;
}): Promise<void> {
  const payload = {
    empresa_id: companyId,
    codigo: code.trim(),
    nome: name.trim(),
    tipo: type,
    localizacao_pai_id: parentId || null,
    descricao: description?.trim() || null,
  };
  const result = id
    ? await supabase
        .from("estoque_localizacoes")
        .update(payload)
        .eq("empresa_id", companyId)
        .eq("id", id)
    : await supabase.from("estoque_localizacoes").insert(payload);
  if (result.error) throwStockError(result.error, "save location");
}

export async function setStockLocationActive(
  companyId: string,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("estoque_localizacoes")
    .update({ ativa: active })
    .eq("empresa_id", companyId)
    .eq("id", id);
  if (error) throwStockError(error, "toggle location");
}

export async function deleteStockLocation(
  companyId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("estoque_localizacoes")
    .delete()
    .eq("empresa_id", companyId)
    .eq("id", id);
  if (error) throwStockError(error, "delete location");
}

export async function listStockMaterials({
  companyId,
  page,
  pageSize,
  filters,
}: {
  companyId: string;
  page: number;
  pageSize: number;
  filters: StockFilters;
}): Promise<StockMaterialPage> {
  const { data, error } = await supabase.rpc("listar_estoque_resumo", {
    _empresa_id: companyId,
    _pagina: page,
    _tamanho_pagina: pageSize,
    _busca: filters.search.trim() || null,
    _tipo_controle:
      filters.controlType === "todos" ? null : filters.controlType,
    _filtro_saldo: filters.balance === "todos" ? null : filters.balance,
    _localizacao_id: filters.locationId || null,
    _categoria_id: filters.categoryId || null,
    _ativo: filters.active,
  });
  if (error) throwStockError(error, "list materials");
  const rows = (data ?? []) as unknown as Array<{
    material: Omit<StockMaterial, "saldos">;
    saldos: StockMaterial["saldos"];
    total_count: number;
  }>;
  return {
    items: rows.map((row) => ({ ...row.material, saldos: row.saldos })),
    total: rows[0]?.total_count ?? 0,
  };
}

export async function getStockIndicators(
  companyId: string,
): Promise<StockIndicators> {
  const [
    { data, error },
    { count: locationsCount, error: locationsError },
    { count: recentCount, error: recentError },
  ] = await Promise.all([
    supabase
      .from("materiais")
      .select("quantidade, estoque_minimo")
      .eq("empresa_id", companyId),
    supabase
      .from("estoque_localizacoes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", companyId)
      .eq("ativa", true),
    supabase
      .from("estoque_movimentacoes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", companyId)
      .gte(
        "data_efetiva",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      ),
  ]);
  if (error) throwStockError(error, "stock indicators");
  if (locationsError) throwStockError(locationsError, "location indicators");
  if (recentError) throwStockError(recentError, "movement indicators");
  const result = (data ?? []).reduce<StockIndicators>(
    (result, material) => ({
      materiais: result.materiais + 1,
      unidades: result.unidades + material.quantidade,
      abaixoMinimo:
        result.abaixoMinimo +
        (material.quantidade <= material.estoque_minimo ? 1 : 0),
      semSaldo: result.semSaldo + (material.quantidade === 0 ? 1 : 0),
      localizacoesAtivas: result.localizacoesAtivas,
      movimentacoesRecentes: result.movimentacoesRecentes,
    }),
    {
      materiais: 0,
      unidades: 0,
      abaixoMinimo: 0,
      semSaldo: 0,
      localizacoesAtivas: 0,
      movimentacoesRecentes: 0,
    },
  );
  result.localizacoesAtivas = locationsCount ?? 0;
  result.movimentacoesRecentes = recentCount ?? 0;
  return result;
}

export async function getMaterialStockSnapshot(
  companyId: string,
  materialId: string,
) {
  const [{ data: balances, error }, locations, movements] = await Promise.all([
    supabase
      .from("estoque_saldos")
      .select("*")
      .eq("empresa_id", companyId)
      .eq("material_id", materialId)
      .gt("quantidade", 0),
    listStockLocations(companyId, true),
    listStockMovements({
      companyId,
      page: 1,
      pageSize: 5,
      filters: { materialId },
    }),
  ]);
  if (error) throwStockError(error, "material stock snapshot");
  const locationMap = new Map(locations.map((item) => [item.id, item]));
  return {
    balances: (balances ?? []).map((balance) => ({
      ...balance,
      localizacao: locationMap.get(balance.localizacao_id) ?? null,
    })),
    movements: movements.items,
  };
}

export async function listStockMovements({
  companyId,
  page,
  pageSize,
  filters,
}: {
  companyId: string;
  page: number;
  pageSize: number;
  filters: StockMovementFilters;
}): Promise<StockMovementPage> {
  let query = supabase
    .from("estoque_movimentacoes")
    .select("*", { count: "exact" })
    .eq("empresa_id", companyId)
    .order("data_efetiva", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (filters.materialId) query = query.eq("material_id", filters.materialId);
  if (filters.type && filters.type !== "todos") {
    query = query.eq("tipo_movimentacao", filters.type);
  }
  if (filters.dateFrom) query = query.gte("data_efetiva", `${filters.dateFrom}T00:00:00`);
  if (filters.dateTo) query = query.lte("data_efetiva", `${filters.dateTo}T23:59:59.999`);
  if (filters.userId) query = query.eq("created_by", filters.userId);
  if (filters.document?.trim()) {
    query = query.ilike("documento_referencia", `%${filters.document.trim()}%`);
  }
  if (filters.sourceModule && filters.sourceModule !== "todos") {
    query = query.eq("origem_modulo", filters.sourceModule);
  }
  if (filters.locationId) {
    query = query.or(
      `localizacao_origem_id.eq.${filters.locationId},localizacao_destino_id.eq.${filters.locationId}`,
    );
  }
  const { data, error, count } = await query;
  if (error) throwStockError(error, "list movements");
  const rows = data ?? [];
  const materialIds = [...new Set(rows.map((row) => row.material_id))];
  const userIds = [...new Set(rows.map((row) => row.created_by))];
  const [{ data: materials }, locations, { data: users }] = await Promise.all([
    materialIds.length
      ? supabase
          .from("materiais")
          .select("id,nome,codigo_interno")
          .eq("empresa_id", companyId)
          .in("id", materialIds)
      : Promise.resolve({ data: [] }),
    listStockLocations(companyId, true),
    userIds.length
      ? supabase
          .from("profiles")
          .select("user_id,full_name")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] }),
  ]);
  const materialMap = new Map((materials ?? []).map((item) => [item.id, item]));
  const locationMap = new Map(locations.map((item) => [item.id, item.nome]));
  const userMap = new Map((users ?? []).map((item) => [item.user_id, item.full_name]));
  const items: StockMovementView[] = rows.map((row) => ({
    ...row,
    material_nome: materialMap.get(row.material_id)?.nome ?? "Material",
    material_codigo: materialMap.get(row.material_id)?.codigo_interno ?? "—",
    localizacao_origem_nome: row.localizacao_origem_id
      ? locationMap.get(row.localizacao_origem_id) ?? "Localização"
      : null,
    localizacao_destino_nome: row.localizacao_destino_id
      ? locationMap.get(row.localizacao_destino_id) ?? "Localização"
      : null,
    usuario_nome: userMap.get(row.created_by) ?? "Usuário",
  }));
  return { items, total: count ?? 0 };
}

export async function registerStockMovement(
  companyId: string,
  input: StockMovementInput,
): Promise<StockMovement> {
  const { data, error } = await supabase.rpc("registrar_movimentacao_estoque", {
    _empresa_id: companyId,
    _material_id: input.materialId,
    _tipo: input.type,
    _quantidade: input.quantity,
    _client_uuid: input.clientUuid,
    _localizacao_origem_id: input.originLocationId || null,
    _localizacao_destino_id: input.destinationLocationId || null,
    _motivo: input.reason?.trim() || null,
    _observacao: input.note?.trim() || null,
    _documento_referencia: input.referenceDocument?.trim() || null,
    _data_efetiva: input.effectiveAt || null,
    _origem_modulo: "manual",
  });
  if (error) throwStockError(error, "register movement");
  return data;
}

export async function adjustStock(
  companyId: string,
  input: StockAdjustmentInput,
): Promise<StockMovement> {
  const { data, error } = await supabase.rpc("ajustar_estoque_material", {
    _empresa_id: companyId,
    _material_id: input.materialId,
    _localizacao_id: input.locationId,
    _quantidade_fisica: input.physicalQuantity,
    _motivo: input.reason.trim(),
    _justificativa: input.justification.trim(),
    _observacao: input.note?.trim() || null,
    _data_efetiva: input.effectiveAt || null,
    _client_uuid: input.clientUuid,
  });
  if (error) throwStockError(error, "adjust stock");
  return data;
}

export async function reverseStockMovement(
  companyId: string,
  input: StockReversalInput,
): Promise<StockMovement> {
  const { data, error } = await supabase.rpc("estornar_movimentacao_estoque", {
    _empresa_id: companyId,
    _movimentacao_id: input.movementId,
    _justificativa: input.justification.trim(),
    _data_efetiva: input.effectiveAt || null,
    _client_uuid: input.clientUuid,
  });
  if (error) throwStockError(error, "reverse movement");
  return data;
}
