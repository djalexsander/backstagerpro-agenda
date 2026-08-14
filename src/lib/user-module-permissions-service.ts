import { supabase } from "@/integrations/supabase/client";
import type { EnrichedEmpresaModule, ModuleCatalogRow } from "@/types/subscription";

export interface ModulePermissionEntry {
  featureKey: string;
  moduleName: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

// list_user_module_permissions/set_user_module_permissions (Fase 1,
// 20260810090000_user_module_permissions.sql) are not in the generated
// Supabase types yet - same untyped-rpc pattern already used by
// client-service.ts for listar_clientes/salvar_cliente.
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

const ERROR_MESSAGES: Record<string, string> = {
  UP001: "Este usuário não pertence a esta empresa.",
  UP002: "Contas master_admin não são afetadas por permissões de módulo.",
  UP003: "admin_empresa já possui acesso total; não é possível definir permissões granulares para este usuário.",
  UP004: "Um dos módulos selecionados não está ativo para esta empresa.",
  UP005: "Lista de permissões inválida.",
};

function throwPermissionsError(error: RpcError | null, context: string): never {
  const message = (error?.code && ERROR_MESSAGES[error.code]) || error?.message || "Falha ao gerenciar permissões do usuário.";
  console.error(`[user-module-permissions-service] ${context}`, error);
  throw new Error(message);
}

interface RawPermissionRow {
  feature_key: string;
  module_nome: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

function fromRaw(row: RawPermissionRow): ModulePermissionEntry {
  return {
    featureKey: row.feature_key,
    moduleName: row.module_nome,
    canView: row.can_view,
    canCreate: row.can_create,
    canEdit: row.can_edit,
    canDelete: row.can_delete,
  };
}

/** Lê o checklist de módulos ativos + permissões concedidas. Sem _userId, lê as próprias (auth.uid()). */
export async function fetchUserModulePermissions(
  companyId: string,
  userId?: string,
): Promise<ModulePermissionEntry[]> {
  const { data, error } = await callRpc("list_user_module_permissions", {
    _empresa_id: companyId,
    _user_id: userId,
  });
  if (error) throwPermissionsError(error, "list permissions");
  return ((data ?? []) as RawPermissionRow[]).map(fromRaw);
}

/** Substitui por completo o conjunto de permissões do usuário-alvo nesta empresa. */
export async function saveUserModulePermissions(
  companyId: string,
  userId: string,
  permissions: ModulePermissionEntry[],
): Promise<ModulePermissionEntry[]> {
  const payload = permissions.map((entry) => ({
    feature_key: entry.featureKey,
    can_view: entry.canView,
    can_create: entry.canCreate,
    can_edit: entry.canEdit,
    can_delete: entry.canDelete,
  }));
  const { data, error } = await callRpc("set_user_module_permissions", {
    _empresa_id: companyId,
    _user_id: userId,
    _permissions: payload,
  });
  if (error) throwPermissionsError(error, "save permissions");
  return ((data ?? []) as RawPermissionRow[]).map(fromRaw);
}

/**
 * create-user (Edge Function) não devolve o user_id do usuário criado/reaproveitado.
 * profiles.email já é gravado por ela na mesma chamada, então localizamos por
 * email dentro da própria empresa. Retorna null se não encontrar (o chamador
 * decide como avisar o admin em vez de falhar a criação do usuário por isso).
 */
export async function resolveCreatedUserId(companyId: string, email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("empresa_id", companyId)
    .eq("email", email)
    .maybeSingle();
  if (error || !data) return null;
  return data.user_id;
}

/**
 * Checklist vazio (tudo false) para os módulos hoje ativos - usado ao abrir o
 * formulário de novo usuário, antes de ele existir. Nunca parte de nenhum
 * valor pré-marcado: o backfill de leitura da Fase 1 é uma correção
 * histórica única (feita na migration, para usuários que já existiam antes
 * dela) e não deve ser reaplicada visualmente a um cadastro novo.
 */
export function buildEmptyPermissionRows(activeModules: EnrichedEmpresaModule[]): ModulePermissionEntry[] {
  return activeModules
    .filter((module) => !!module.catalog?.feature_key && !module.catalog.is_capacity_module)
    .map((module) => ({
      featureKey: module.catalog!.feature_key,
      moduleName: module.catalog!.nome,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    }));
}

/**
 * Módulos de capacidade (extra_usuarios/extra_eventos/extra_storage) são
 * pacotes de limite/cota, não uma tela ou ação - list_user_module_permissions
 * ainda os retorna (é literalmente "todo módulo ativo da empresa"), então o
 * frontend descarta aqui antes de exibir/editar, tanto para o checklist novo
 * quanto para o carregado do banco na edição.
 */
export function filterConfigurableModules<T extends { featureKey: string }>(
  rows: T[],
  catalog: Pick<ModuleCatalogRow, "feature_key" | "is_capacity_module">[],
): T[] {
  const capacityFeatureKeys = new Set(
    catalog.filter((entry) => entry.is_capacity_module).map((entry) => entry.feature_key),
  );
  return rows.filter((row) => !capacityFeatureKeys.has(row.featureKey));
}

export interface PermissionCategory {
  id: string;
  label: string;
  rows: ModulePermissionEntry[];
}

const CATEGORY_LABELS: Record<string, string> = {
  principal: "Principal",
  "materiais-operacoes": "Materiais & Operações",
  administracao: "Administração",
  configuracoes: "Configurações",
};

const CATEGORY_ORDER = ["principal", "materiais-operacoes", "administracao", "configuracoes"];

/**
 * Mesmas 4 categorias do menu lateral (AppSidebar.tsx). Um módulo cujo
 * feature_key libera mais de um item de menu (ex.: locacao_materiais também
 * libera "Clientes", em Principal) entra na categoria do seu uso principal -
 * não faz sentido repetir o mesmo checklist em duas categorias diferentes,
 * já que é uma única permissão por módulo, não por tela. feature_key sem
 * mapeamento explícito (módulo futuro ainda não classificado aqui) cai em
 * "Configurações" em vez de desaparecer da lista.
 */
const FEATURE_KEY_CATEGORY: Record<string, string> = {
  gestao_materiais: "materiais-operacoes",
  controle_estoque: "materiais-operacoes",
  checkin_checkout: "materiais-operacoes",
  locacao_materiais: "materiais-operacoes",
  manutencao_equipamentos: "materiais-operacoes",
  etiquetas_materiais: "materiais-operacoes",
  rfid_materiais: "materiais-operacoes",
  financeiro_avancado: "administracao",
  documentos_avancados: "administracao",
  checklist_tecnico: "administracao",
  relatorios: "administracao",
  relatorios_materiais: "administracao",
  painel_operacional: "administracao",
  equipe_permissoes: "administracao",
  agenda_compartilhada: "configuracoes",
  notificacoes_premium: "configuracoes",
};

/** Agrupa nas 4 categorias da sidebar, em ordem estável, omitindo categorias sem nenhum módulo. */
export function groupPermissionRows(rows: ModulePermissionEntry[]): PermissionCategory[] {
  const buckets = new Map<string, ModulePermissionEntry[]>();
  for (const row of rows) {
    const categoryId = FEATURE_KEY_CATEGORY[row.featureKey] ?? "configuracoes";
    const bucket = buckets.get(categoryId);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(categoryId, [row]);
    }
  }
  return CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id], rows: buckets.get(id) ?? [] })).filter(
    (category) => category.rows.length > 0,
  );
}

export type PermissionAction = "canView" | "canCreate" | "canEdit" | "canDelete";

/**
 * Espelha o CHECK constraint de user_module_permissions (can_view é exigido
 * para qualquer outra ação): desmarcar Visualizar limpa as demais; marcar
 * qualquer outra ação marca Visualizar junto - evita mandar ao backend uma
 * combinação que o banco rejeitaria.
 */
export function applyPermissionToggle(
  row: ModulePermissionEntry,
  action: PermissionAction,
  checked: boolean,
): ModulePermissionEntry {
  const next = { ...row, [action]: checked };
  if (action === "canView" && !checked) {
    next.canCreate = false;
    next.canEdit = false;
    next.canDelete = false;
  } else if (action !== "canView" && checked) {
    next.canView = true;
  }
  return next;
}
