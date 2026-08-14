import type {
  EpcResolution,
  ReconciliationConflictItem,
  ReconciliationResult,
  RfidReadEvent,
  RfidSessionResultSnapshot,
  RfidTagObservation,
} from "./rfid-types";

// ============================================================================
// NORMALIZAÇÃO DE EPC
// ============================================================================
//
// EPC (Electronic Product Code) Gen2 é tipicamente reportado por
// leitores/SDKs UHF como texto hexadecimal, às vezes com espaços/hífens a
// cada poucos caracteres para legibilidade (colado de um software de
// fabricante). 8-64 hex chars cobre de EPC-64 a EPC-496 (padrão de fato é
// EPC-96 = 24 chars) sem prender a arquitetura a um encoding específico
// antes de termos um reader real em mãos.

const EPC_SEPARATOR_PATTERN = /[\s:-]+/g;
const EPC_PATTERN = /^[0-9A-F]{8,64}$/;

export function normalizeEpc(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.trim().toUpperCase().replace(EPC_SEPARATOR_PATTERN, "");
  return EPC_PATTERN.test(stripped) ? stripped : null;
}

export interface ParsedEpcList {
  valid: string[];
  invalid: string[];
  duplicates: string[];
}

const EPC_LIST_SPLIT_PATTERN = /[\n\r,;\t]+/;

/** Para "colar vários EPCs" na tela de conferência: separa, normaliza e deduplica. */
export function parseEpcList(raw: string): ParsedEpcList {
  const entries = raw
    .split(EPC_LIST_SPLIT_PATTERN)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalized = normalizeEpc(entry);
    if (!normalized) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }
    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicates };
}

// ============================================================================
// DEDUPLICAÇÃO DE LEITURAS
// ============================================================================

/**
 * Colapsa um fluxo de RfidReadEvent (que pode conter a mesma tag dezenas ou
 * centenas de vezes) em uma observação por EPC. Único ponto de contato entre
 * o volume bruto de rádio e o resto do domínio - nada depois deste ponto
 * volta a ver leituras individuais.
 */
export function aggregateRfidReadEvents(
  events: RfidReadEvent[],
): RfidTagObservation[] {
  const byEpc = new Map<string, RfidTagObservation>();

  for (const event of events) {
    const epc = normalizeEpc(event.epc);
    if (!epc) continue; // leitura malformada de um reader instável é descartada, não vira "tag desconhecida"

    const existing = byEpc.get(epc);
    if (!existing) {
      byEpc.set(epc, {
        epc,
        readCount: 1,
        firstSeenAt: event.timestamp,
        lastSeenAt: event.timestamp,
        bestRssi: event.rssi ?? null,
        lastRssi: event.rssi ?? null,
        antennas: event.antenna !== undefined ? [event.antenna] : [],
      });
      continue;
    }

    existing.readCount += 1;
    if (event.timestamp < existing.firstSeenAt) existing.firstSeenAt = event.timestamp;
    if (event.timestamp >= existing.lastSeenAt) {
      existing.lastSeenAt = event.timestamp;
      existing.lastRssi = event.rssi ?? existing.lastRssi;
    }
    // RSSI em dBm é negativo; "melhor" sinal = valor maior (mais perto de 0).
    if (event.rssi !== undefined && (existing.bestRssi === null || event.rssi > existing.bestRssi)) {
      existing.bestRssi = event.rssi;
    }
    if (event.antenna !== undefined && !existing.antennas.includes(event.antenna)) {
      existing.antennas.push(event.antenna);
    }
  }

  return Array.from(byEpc.values());
}

// ============================================================================
// MOTOR DE CONFERÊNCIA EM LOTE
// ============================================================================

/**
 * Puro e independente de UI/hardware: recebe os material_ids esperados e as
 * resoluções EPC->material já feitas pelo chamador (mapa local ou RPC de
 * resolução em lote), devolve os 6 baldes usados pela tela de conferência.
 *
 * Tags com status diferente de "ativa" sempre caem em inactiveTag, mesmo que
 * o material associado estivesse na lista de esperados: confiar numa tag já
 * trocada/danificada/perdida para dar FOUND seria enganoso (o material pode
 * ter sido re-etiquetado exatamente porque essa tag não é mais confiável).
 */
export function reconcileRfidRead({
  expectedMaterialIds,
  resolutions,
}: {
  expectedMaterialIds: string[];
  resolutions: EpcResolution[];
}): ReconciliationResult {
  const found: ReconciliationResult["found"] = [];
  const missing: ReconciliationResult["missing"] = [];
  const unexpected: ReconciliationResult["unexpected"] = [];
  const unknown: ReconciliationResult["unknown"] = [];
  const inactiveTag: ReconciliationResult["inactiveTag"] = [];
  const conflicts: ReconciliationConflictItem[] = [];

  const expectedSet = new Set(expectedMaterialIds);
  if (expectedSet.size !== expectedMaterialIds.length) {
    conflicts.push({
      epc: null,
      materialId: null,
      reason: "Lista de materiais esperados contém identificadores duplicados.",
    });
  }

  const matchedMaterialIds = new Set<string>();
  const seenEpcs = new Set<string>();

  for (const resolution of resolutions) {
    if (seenEpcs.has(resolution.epc)) {
      conflicts.push({
        epc: resolution.epc,
        materialId: resolution.materialId,
        reason: "EPC informado mais de uma vez na mesma resolução.",
      });
      continue;
    }
    seenEpcs.add(resolution.epc);

    if (resolution.materialId === null) {
      unknown.push({ epc: resolution.epc });
      continue;
    }

    if (resolution.tagStatus !== "ativa") {
      inactiveTag.push({
        materialId: resolution.materialId,
        epc: resolution.epc,
        status: resolution.tagStatus ?? "inativa",
      });
      continue;
    }

    if (matchedMaterialIds.has(resolution.materialId)) {
      conflicts.push({
        epc: resolution.epc,
        materialId: resolution.materialId,
        reason: "Mais de uma tag ativa lida resolveu para o mesmo material.",
      });
      continue;
    }
    matchedMaterialIds.add(resolution.materialId);

    if (expectedSet.has(resolution.materialId)) {
      found.push({ materialId: resolution.materialId, epc: resolution.epc });
    } else {
      unexpected.push({ materialId: resolution.materialId, epc: resolution.epc });
    }
  }

  for (const materialId of expectedSet) {
    if (!matchedMaterialIds.has(materialId)) {
      missing.push({ materialId });
    }
  }

  return {
    found,
    missing,
    unexpected,
    unknown,
    inactiveTag,
    conflicts,
    counts: {
      expected: expectedSet.size,
      found: found.length,
      missing: missing.length,
      unexpected: unexpected.length,
      unknown: unknown.length,
      inactiveTag: inactiveTag.length,
      conflicts: conflicts.length,
    },
  };
}

/**
 * Snapshot limitado pelo tamanho do lote conferido (dezenas/centenas de
 * materiais), não pelo volume de leituras de rádio - é o "evento de
 * negócio" gravado ao finalizar a sessão, nunca as leituras brutas.
 */
export function buildSessionResultSnapshot(
  result: ReconciliationResult,
): RfidSessionResultSnapshot {
  return {
    found: result.found.map((item) => item.materialId),
    missing: result.missing.map((item) => item.materialId),
    unexpected: result.unexpected.map((item) => ({
      materialId: item.materialId,
      epc: item.epc,
    })),
    unknown: result.unknown.map((item) => item.epc),
    inactiveTag: result.inactiveTag.map((item) => ({
      materialId: item.materialId,
      epc: item.epc,
    })),
  };
}

export const RECONCILIATION_BUCKET_LABELS = {
  found: "Encontrado",
  missing: "Ausente",
  unexpected: "Inesperado",
  unknown: "Tag desconhecida",
  inactiveTag: "Tag desativada",
  conflict: "Conflito",
} as const;
