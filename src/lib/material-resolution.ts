import { MATERIAL_QR_PREFIX } from "./material-identification";
import { normalizeEpc } from "./rfid-domain";
import type { RfidTagStatus } from "./rfid-types";

// ============================================================================
// RESOLUÇÃO CENTRAL DE IDENTIFICADOR DE MATERIAL
// ============================================================================
//
// Camada única que qualquer módulo (check-in/check-out, locação, estoque,
// conferência RFID, o que vier depois) pode chamar para transformar
// "o que foi lido/digitado/escaneado" em um MaterialId, sem reimplementar a
// lógica de match em cada tela.
//
// checkin-checkout-domain.ts já resolve id/QR/código de barras/código
// interno/patrimônio/série/nome por busca local (materialMatchesCustodyIdentifier)
// contra uma lista de materiais pré-carregada - esse fluxo já homologado NÃO
// é alterado aqui. matchMaterialIdentifierLocally abaixo generaliza a mesma
// lógica (mesmos campos, mesma ordem de prioridade) sob um tipo estrutural
// neutro, para módulos novos (como a conferência RFID) reaproveitarem sem
// depender de um tipo específico do módulo de custódia.
//
// EPC é o único identificador que NÃO é uma coluna de materiais - vive em
// rfid_tags, então sua resolução é necessariamente assíncrona (RPC) em vez
// de um match local contra uma lista já carregada. resolveMaterialIdentifier
// une os dois mundos atrás de uma única função e um único formato de
// resultado.

export interface MaterialIdentifierFields {
  id: string;
  nome: string;
  codigo_interno?: string | null;
  identificador_unico?: string | null;
  codigo_barras?: string | null;
  conteudo_qr_code?: string | null;
  numero_patrimonio?: string | null;
  numero_serie?: string | null;
}

export type MaterialResolutionSource =
  | "id"
  | "identificador_unico"
  | "qr_code"
  | "codigo_barras"
  | "codigo_interno"
  | "numero_patrimonio"
  | "numero_serie"
  | "nome"
  | "epc";

export type MaterialResolutionResult =
  | { status: "found"; materialId: string; source: MaterialResolutionSource }
  | { status: "not_found" }
  /** EPC cadastrado, mas a tag não está ativa - resolvido, porém não deve ser tratado como um FOUND direto pelo chamador. */
  | { status: "tag_inactive"; materialId: string; tagStatus: RfidTagStatus };

function normalizeScan(value: string): string {
  return value.replace(/[\r\n\t]+/g, "").trim();
}

/**
 * Mesmos campos e mesma prioridade de custodyIdentifierCandidates em
 * checkin-checkout-domain.ts (id exato > identificadores técnicos/QR/barras/
 * código/patrimônio/série exatos > substring do nome como último recurso),
 * generalizados para qualquer material com esse formato mínimo de campos.
 */
export function materialIdentifierCandidates(material: MaterialIdentifierFields): string[] {
  return [
    material.id,
    material.identificador_unico,
    material.conteudo_qr_code,
    material.codigo_barras,
    material.codigo_interno,
    material.numero_patrimonio,
    material.numero_serie,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLocaleLowerCase("pt-BR"));
}

/** Busca local síncrona contra uma lista de materiais já carregada. */
export function matchMaterialIdentifierLocally(
  materials: MaterialIdentifierFields[],
  input: string,
): MaterialResolutionResult {
  const normalized = normalizeScan(input).toLocaleLowerCase("pt-BR");
  if (!normalized) return { status: "not_found" };

  const qrPrefix = MATERIAL_QR_PREFIX.toLocaleLowerCase("pt-BR");
  const strippedQr = normalized.startsWith(qrPrefix) ? normalized.slice(qrPrefix.length) : null;

  for (const material of materials) {
    const candidates = materialIdentifierCandidates(material);
    if (candidates.includes(normalized) || (strippedQr && candidates.includes(strippedQr))) {
      return { status: "found", materialId: material.id, source: "codigo_interno" };
    }
  }

  const byName = materials.find((material) =>
    material.nome.toLocaleLowerCase("pt-BR").includes(normalized),
  );
  if (byName) return { status: "found", materialId: byName.id, source: "nome" };

  return { status: "not_found" };
}

/**
 * Resolve um EPC via a função injetada (RPC real em rfid-service.ts, ou um
 * dublê nos testes) - mantém este módulo livre de uma dependência direta do
 * cliente Supabase e o resultado no mesmo formato usado pelos outros
 * identificadores.
 */
export async function resolveMaterialByEpc(
  epc: string,
  resolveEpc: (epc: string) => Promise<{ materialId: string | null; tagStatus: RfidTagStatus | null }>,
): Promise<MaterialResolutionResult> {
  const normalized = normalizeEpc(epc);
  if (!normalized) return { status: "not_found" };

  const resolution = await resolveEpc(normalized);
  if (!resolution.materialId) return { status: "not_found" };
  if (resolution.tagStatus !== "ativa") {
    return {
      status: "tag_inactive",
      materialId: resolution.materialId,
      tagStatus: resolution.tagStatus ?? "inativa",
    };
  }
  return { status: "found", materialId: resolution.materialId, source: "epc" };
}

export interface ResolveMaterialIdentifierContext {
  materials: MaterialIdentifierFields[];
  /** Omitido = módulo chamador não suporta RFID; entrada tratável como EPC cai direto em not_found. */
  resolveEpc?: (epc: string) => Promise<{ materialId: string | null; tagStatus: RfidTagStatus | null }>;
}

/**
 * Ponto único de entrada: tenta o match local (cobre ID interno, código,
 * código de barras, QR Code, nome) e só recorre ao EPC (assíncrono) se nada
 * local bateu e o formato da entrada é compatível com um EPC. Entrada RFID
 * resolve para o mesmo MaterialId usado pelo resto do sistema - nenhum
 * chamador precisa saber qual identificador foi usado.
 */
export async function resolveMaterialIdentifier(
  input: string,
  { materials, resolveEpc }: ResolveMaterialIdentifierContext,
): Promise<MaterialResolutionResult> {
  const localResult = matchMaterialIdentifierLocally(materials, input);
  if (localResult.status === "found") return localResult;

  if (!resolveEpc) return { status: "not_found" };

  const normalizedEpc = normalizeEpc(input);
  if (!normalizedEpc) return { status: "not_found" };

  return resolveMaterialByEpc(normalizedEpc, resolveEpc);
}
