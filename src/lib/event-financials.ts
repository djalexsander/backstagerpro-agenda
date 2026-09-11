/**
 * Single source of truth for "how much of an event's cachê has been paid".
 * Was previously reimplemented independently in Dashboard.tsx, Financeiro.tsx
 * and EventosFinanceiroPanel.tsx (plus pdf-export.ts for PDF/report exports)
 * - four copies that could silently drift. Every screen still computes its
 * own totals/despesas differently on purpose (Dashboard sums transport+
 * lodging+extras+employees, EventosFinanceiroPanel sums transport+food+
 * lodging+other_costs, FinanceCards yet another mix) - that divergence is
 * pre-existing, untouched here, and out of scope for this module.
 */

export type CacheParcela = {
  numero: number;
  valor: number;
  vencimento: string;
  pago: boolean;
};

export type CacheDetail = {
  valorTotal: number;
  entrada: number;
  entradaPaga: boolean;
  parcelado: boolean;
  parcelas: CacheParcela[];
  recebimentoEvento: boolean;
  dataRecebimento: string;
  recebimentoPago: boolean;
};

/** Structural minimum every financials row (or export/report row) satisfies. */
export interface CachePaymentSource {
  cache?: number | null;
  cache_detail?: unknown;
}

export interface EventFinancialsSummary {
  /** Total cachê agreed for the event (0 when not set). */
  cache: number;
  /** How much of that cachê has actually been paid so far. */
  cachePago: number;
  /** Remaining balance still owed (can be negative if overpaid). */
  cachePendente: number;
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseCacheDetail(raw: unknown): CacheDetail | null {
  const record = asRecord(parseJsonValue(raw));
  if (!record) return null;

  const parcelas = Array.isArray(record.parcelas)
    ? record.parcelas.flatMap((item) => {
        const parcela = asRecord(item);
        if (!parcela) return [];
        return [{
          numero: asNumber(parcela.numero),
          valor: asNumber(parcela.valor),
          vencimento: asString(parcela.vencimento),
          pago: parcela.pago === true,
        }];
      })
    : [];

  return {
    valorTotal: asNumber(record.valorTotal),
    entrada: asNumber(record.entrada),
    entradaPaga: record.entradaPaga === true,
    parcelado: record.parcelado === true,
    parcelas,
    recebimentoEvento: record.recebimentoEvento === true,
    dataRecebimento: asString(record.dataRecebimento),
    recebimentoPago: record.recebimentoPago === true,
  };
}

export function getCachePago(financial: CachePaymentSource): number {
  const detail = parseCacheDetail(financial.cache_detail);
  if (!detail) return financial.cache || 0;
  let paid = 0;
  if (detail.entrada > 0 && detail.entradaPaga) paid += detail.entrada;
  if (detail.parcelado) {
    paid += (detail.parcelas || [])
      .filter((p) => p.pago)
      .reduce((s, p) => s + p.valor, 0);
  } else if (detail.recebimentoPago) {
    paid += detail.valorTotal - (detail.entrada || 0);
  }
  return paid;
}

export function getCachePendente(financial: CachePaymentSource): number {
  return (financial.cache || 0) - getCachePago(financial);
}

export function computeEventFinancials(financial: CachePaymentSource): EventFinancialsSummary {
  const cache = financial.cache || 0;
  const cachePago = getCachePago(financial);
  return { cache, cachePago, cachePendente: cache - cachePago };
}
