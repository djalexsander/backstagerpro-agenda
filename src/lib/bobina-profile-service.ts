import { supabase } from "@/integrations/supabase/client";
import type { BobinaProfile, SaveBobinaProfileInput } from "./bobina-profile-types";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

// Only BB001 gets a fixed override (mirrors PR001 in printer-service.ts) -
// every other BB0xx code already carries a specific, user-facing PT-BR
// message from the RPC itself (e.g. BB006 interpolates the exact required
// vs. available width in mm), so passing error.message through is strictly
// more useful than collapsing it into a generic string.
function throwBobinaError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    BB001: "Selecione a empresa.",
  };
  const message = (error?.code && messages[error.code]) || error?.message || "Falha na operação de perfil de bobina.";
  console.error(`[bobina-profile-service] ${context}`, error);
  throw new Error(message);
}

export async function listBobinaProfiles(companyId: string): Promise<BobinaProfile[]> {
  const { data, error } = await callRpc("listar_perfis_bobina", { _empresa_id: companyId });
  if (error) throwBobinaError(error, "list bobina profiles");
  return (data ?? []) as BobinaProfile[];
}

export async function saveBobinaProfile(companyId: string, input: SaveBobinaProfileInput): Promise<BobinaProfile> {
  const { data, error } = await callRpc("salvar_perfil_bobina", {
    _empresa_id: companyId,
    _perfil_id: input.id,
    _expected_updated_at: input.expectedUpdatedAt,
    _nome: input.nome,
    _largura_etiqueta_mm: input.larguraEtiquetaMm,
    _altura_etiqueta_mm: input.alturaEtiquetaMm,
    _colunas: input.colunas,
    _espacamento_horizontal_mm: input.espacamentoHorizontalMm,
    _espacamento_vertical_mm: input.espacamentoVerticalMm,
    _margem_esquerda_mm: input.margemEsquerdaMm,
    _margem_direita_mm: input.margemDireitaMm,
    _margem_superior_mm: input.margemSuperiorMm,
    _margem_inferior_mm: input.margemInferiorMm,
    _orientacao: input.orientacao,
    _largura_midia_mm: input.larguraMidiaMm ?? undefined,
    _offset_horizontal_mm: input.offsetHorizontalMm,
    _offset_vertical_mm: input.offsetVerticalMm,
    _dpi: input.dpi,
    _dpi_personalizado: input.dpiPersonalizado ?? undefined,
    _padrao: input.padrao,
  });
  if (error) throwBobinaError(error, "save bobina profile");
  return data as BobinaProfile;
}

export async function duplicateBobinaProfile(
  companyId: string,
  profileId: string,
  newName?: string,
): Promise<BobinaProfile> {
  const { data, error } = await callRpc("duplicar_perfil_bobina", {
    _empresa_id: companyId,
    _perfil_id: profileId,
    _novo_nome: newName || undefined,
  });
  if (error) throwBobinaError(error, "duplicate bobina profile");
  return data as BobinaProfile;
}

export async function deleteBobinaProfile(companyId: string, profileId: string): Promise<void> {
  const { error } = await callRpc("excluir_perfil_bobina", { _empresa_id: companyId, _perfil_id: profileId });
  if (error) throwBobinaError(error, "delete bobina profile");
}

export async function setDefaultBobinaProfile(companyId: string, profileId: string): Promise<BobinaProfile> {
  const { data, error } = await callRpc("definir_perfil_bobina_padrao", {
    _empresa_id: companyId,
    _perfil_id: profileId,
  });
  if (error) throwBobinaError(error, "set default bobina profile");
  return data as BobinaProfile;
}

/** Pure resolver, same shape as resolveConfiguredPrinter in
 * printer-service.ts: finds the profile a printer config points to, or null
 * when unset/stale (e.g. the linked profile was soft-deleted). */
export function resolveBobinaProfile(
  profiles: BobinaProfile[],
  profileId: string | null | undefined,
): BobinaProfile | null {
  if (!profileId) return null;
  return profiles.find((profile) => profile.id === profileId) ?? null;
}
