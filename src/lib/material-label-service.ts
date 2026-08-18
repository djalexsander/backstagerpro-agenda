import { supabase } from "@/integrations/supabase/client";
import { labelBatchToRpcItems } from "./material-label-domain";
import type { LabelBatchSelection, LabelIndicators, LabelMaterial, LabelModel, LabelPrintBatch, LabelPrintRequest, SaveLabelModelInput } from "./material-label-types";

export type LabelMaterialResolution =
  | { status: "found"; material: LabelMaterial }
  | { status: "inactive"; id: string; code: string; name: string }
  | { status: "not_found" };

interface RpcError { message?: string; code?: string }
type RpcCaller = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwLabelError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    LB009: "Etiquetas e Gestão de Materiais precisam estar ativas.",
    LB010: "A empresa está em modo somente leitura.",
    LB011: "Selecione explicitamente a empresa.",
    LB012: "Gere o QR Code do material antes de imprimir.",
    LB013: "Gere o código de barras do material antes de imprimir.",
    LB014: "O histórico de impressões é imutável.",
    LB015: "O modelo foi alterado em outra sessão. Recarregue os dados.",
    LB016: "A operação foi repetida com dados diferentes.",
    LB017: "Um material não pertence à empresa, foi alterado ou não possui a identificação exigida.",
    LB018: "O lote ficou incompleto ou com totais divergentes.",
  };
  console.error(`[material-label-service] ${context}`, error);
  throw new Error((error?.code && messages[error.code]) || error?.message || "Falha na operação de etiquetas.");
}

export async function listLabelModels(companyId: string): Promise<LabelModel[]> {
  const { data, error } = await callRpc("listar_modelos_etiqueta", { _empresa_id: companyId });
  if (error) throwLabelError(error, "list models");
  return (data ?? []) as LabelModel[];
}

export async function saveLabelModel(companyId: string, input: SaveLabelModelInput): Promise<LabelModel> {
  const { data, error } = await callRpc("salvar_modelo_etiqueta_v2", {
    _empresa_id: companyId, _modelo_id: input.id, _expected_updated_at: input.expectedUpdatedAt,
    _nome: input.name, _descricao: input.description, _largura_mm: input.widthMm,
    _altura_mm: input.heightMm, _tipo_identificacao: input.identificationType,
    _campos: input.fields, _tamanho_fonte: input.fontSize,
    _mostrar_borda: input.showBorder, _padrao: input.isDefault,
    _margem_interna_mm: input.innerMarginMm, _espacamento_interno_mm: input.innerGapMm,
  });
  if (error) throwLabelError(error, "save model");
  return data as LabelModel;
}

export async function archiveLabelModel(companyId: string, model: LabelModel) {
  const { error } = await callRpc("inativar_modelo_etiqueta", {
    _empresa_id: companyId, _modelo_id: model.id, _expected_updated_at: model.updated_at,
  });
  if (error) throwLabelError(error, "archive model");
}

export async function searchLabelMaterials(companyId: string, search = ""): Promise<LabelMaterial[]> {
  const { data, error } = await callRpc("buscar_materiais_etiqueta", {
    _empresa_id: companyId, _busca: search.trim() || undefined, _limite: 100,
  });
  if (error) throwLabelError(error, "search materials");
  return (data ?? []) as LabelMaterial[];
}

export async function resolveLabelMaterialById(
  companyId: string,
  materialId: string,
): Promise<LabelMaterialResolution> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(materialId)) {
    return { status: "not_found" };
  }
  const { data, error } = await supabase
    .from("materiais")
    .select("id,nome,codigo_interno,ativo")
    .eq("empresa_id", companyId)
    .eq("id", materialId)
    .maybeSingle();
  if (error) throwLabelError(error, "resolve material by id");
  if (!data) return { status: "not_found" };
  if (!data.ativo) {
    return {
      status: "inactive",
      id: data.id,
      code: data.codigo_interno,
      name: data.nome,
    };
  }

  // Reuse the canonical label search to build the complete LabelMaterial;
  // this exact-id lookup only translates the structured route parameter into
  // the human-readable code consumed by that existing resolver.
  const candidates = await searchLabelMaterials(companyId, data.codigo_interno);
  const material = candidates.find((candidate) => candidate.id === data.id);
  return material ? { status: "found", material } : { status: "not_found" };
}

export async function registerLabelPrintRequest(companyId: string, input: {
  modelId: string; materialId: string; quantity: number; clientUuid: string; reprintOfId?: string;
}): Promise<LabelPrintRequest> {
  const { data, error } = await callRpc("registrar_solicitacao_impressao_etiqueta", {
    _empresa_id: companyId, _modelo_id: input.modelId, _material_id: input.materialId,
    _quantidade: input.quantity, _client_uuid: input.clientUuid, _reimpressao_de_id: input.reprintOfId,
  });
  if (error) throwLabelError(error, "register print");
  return data as LabelPrintRequest;
}

export async function registerLabelPrintBatch(companyId: string, input: {
  model: LabelModel; items: LabelBatchSelection[]; clientUuid: string; reprintOfId?: string;
}): Promise<LabelPrintBatch> {
  const { data, error } = await callRpc("registrar_solicitacao_impressao_lote_etiquetas", {
    _empresa_id: companyId, _modelo_id: input.model.id, _itens: labelBatchToRpcItems(input.items),
    _client_uuid: input.clientUuid, _expected_model_updated_at: input.model.updated_at,
    _reimpressao_de_id: input.reprintOfId,
  });
  if (error) throwLabelError(error, "register print batch");
  return data as LabelPrintBatch;
}

export async function listLabelPrintHistory(companyId: string, page = 1, pageSize = 20) {
  const { data, error } = await callRpc("listar_historico_impressoes_etiqueta", {
    _empresa_id: companyId, _pagina: page, _por_pagina: pageSize,
  });
  if (error) throwLabelError(error, "history");
  const rows = (data ?? []) as Array<{ item: LabelPrintBatch; total_count: number }>;
  return { items: rows.map((row) => row.item), total: Number(rows[0]?.total_count ?? 0) };
}

export async function getLabelIndicators(companyId: string): Promise<LabelIndicators> {
  const { data, error } = await callRpc("obter_indicadores_etiquetas", { _empresa_id: companyId });
  if (error) throwLabelError(error, "indicators");
  const value = (data ?? {}) as Partial<LabelIndicators>;
  return {
    modelos_ativos: Number(value.modelos_ativos ?? 0), materiais_identificados: Number(value.materiais_identificados ?? 0),
    solicitacoes_hoje: Number(value.solicitacoes_hoje ?? 0), etiquetas_hoje: Number(value.etiquetas_hoje ?? 0),
  };
}
