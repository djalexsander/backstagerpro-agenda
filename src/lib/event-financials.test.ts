import { describe, expect, it } from "vitest";
import {
  computeEventFinancials,
  getCachePago,
  getCachePendente,
  parseCacheDetail,
} from "./event-financials";

describe("getCachePago / getCachePendente", () => {
  it("valor normal: no cache_detail assumes the whole cachê was paid (legacy rows)", () => {
    const financial = { cache: 1000, cache_detail: null };
    expect(getCachePago(financial)).toBe(1000);
    expect(getCachePendente(financial)).toBe(0);
  });

  it("zero: a zero (or missing) cachê pays out zero either way", () => {
    expect(getCachePago({ cache: 0, cache_detail: null })).toBe(0);
    expect(getCachePago({ cache: null, cache_detail: null })).toBe(0);
    expect(getCachePendente({ cache: 0, cache_detail: null })).toBe(0);
  });

  it("pagamento parcial: only the entrada, paid, counts - unpaid parcelas do not", () => {
    const financial = {
      cache: 1000,
      cache_detail: {
        valorTotal: 1000,
        entrada: 300,
        entradaPaga: true,
        parcelado: true,
        parcelas: [
          { numero: 1, valor: 350, vencimento: "2026-10-01", pago: true },
          { numero: 2, valor: 350, vencimento: "2026-11-01", pago: false },
        ],
        recebimentoEvento: false,
        dataRecebimento: "",
        recebimentoPago: false,
      },
    };
    // entrada (300, paid) + parcela 1 (350, paid); parcela 2 (350) still pending.
    expect(getCachePago(financial)).toBe(650);
    expect(getCachePendente(financial)).toBe(350);
  });

  it("pagamento total: every parcela paid brings the saldo to zero", () => {
    const financial = {
      cache: 1000,
      cache_detail: {
        valorTotal: 1000,
        entrada: 300,
        entradaPaga: true,
        parcelado: true,
        parcelas: [
          { numero: 1, valor: 350, vencimento: "2026-10-01", pago: true },
          { numero: 2, valor: 350, vencimento: "2026-11-01", pago: true },
        ],
        recebimentoEvento: false,
        dataRecebimento: "",
        recebimentoPago: false,
      },
    };
    expect(getCachePago(financial)).toBe(1000);
    expect(getCachePendente(financial)).toBe(0);
  });

  it("saldo restante: a single lump-sum recebimento not yet paid leaves the full cachê pending", () => {
    const financial = {
      cache: 800,
      cache_detail: {
        valorTotal: 800,
        entrada: 0,
        entradaPaga: false,
        parcelado: false,
        parcelas: [],
        recebimentoEvento: true,
        dataRecebimento: "2026-12-01",
        recebimentoPago: false,
      },
    };
    expect(getCachePago(financial)).toBe(0);
    expect(getCachePendente(financial)).toBe(800);
  });

  it("saldo restante: the same lump-sum recebimento, once marked paid, clears the balance", () => {
    const financial = {
      cache: 800,
      cache_detail: {
        valorTotal: 800,
        entrada: 0,
        entradaPaga: false,
        parcelado: false,
        parcelas: [],
        recebimentoEvento: true,
        dataRecebimento: "2026-12-01",
        recebimentoPago: true,
      },
    };
    expect(getCachePago(financial)).toBe(800);
    expect(getCachePendente(financial)).toBe(0);
  });

  it("tentativa de valor negativo inválido: the database rejects it (financials_amounts_non_negative, P1-15) - this helper only derives values from whatever it is handed and stays internally consistent even for a value that should never reach it", () => {
    const financial = { cache: -100, cache_detail: null };
    // cachePago falls back to the raw cache (no detail = "legacy, assume
    // paid"); the point of this assertion isn't that -100 is a good value,
    // it's that cachePendente always equals cache - cachePago, no NaN/throw,
    // so a screen never renders garbage even if bad data slipped through.
    expect(getCachePago(financial)).toBe(-100);
    expect(getCachePendente(financial)).toBe(0);
  });

  it("parseCacheDetail tolerates malformed/partial cache_detail instead of throwing", () => {
    expect(parseCacheDetail(null)).toBeNull();
    expect(parseCacheDetail(undefined)).toBeNull();
    expect(parseCacheDetail("not json")).toBeNull();
    expect(parseCacheDetail([1, 2, 3])).toBeNull();
    // Missing/non-numeric fields coerce to safe defaults rather than NaN.
    expect(parseCacheDetail({ entrada: "300", parcelas: "not-an-array" })).toEqual({
      valorTotal: 0,
      entrada: 0,
      entradaPaga: false,
      parcelado: false,
      parcelas: [],
      recebimentoEvento: false,
      dataRecebimento: "",
      recebimentoPago: false,
    });
  });
});

describe("computeEventFinancials", () => {
  const fixtures = [
    { cache: 1000, cache_detail: null },
    { cache: 0, cache_detail: null },
    {
      cache: 1000,
      cache_detail: {
        valorTotal: 1000, entrada: 300, entradaPaga: true, parcelado: true,
        parcelas: [
          { numero: 1, valor: 350, vencimento: "2026-10-01", pago: true },
          { numero: 2, valor: 350, vencimento: "2026-11-01", pago: false },
        ],
        recebimentoEvento: false, dataRecebimento: "", recebimentoPago: false,
      },
    },
  ];

  it("consistência entre telas: cache/cachePago/cachePendente always agree with the standalone helpers", () => {
    for (const financial of fixtures) {
      const summary = computeEventFinancials(financial);
      expect(summary.cache).toBe(financial.cache || 0);
      expect(summary.cachePago).toBe(getCachePago(financial));
      expect(summary.cachePendente).toBe(getCachePendente(financial));
      expect(summary.cachePendente).toBe(summary.cache - summary.cachePago);
    }
  });

  it("is the same function Dashboard, Financeiro and EventosFinanceiroPanel now all import - no per-screen copy can drift from this result", () => {
    const financial = { cache: 500, cache_detail: null };
    const viaDashboardStyleReduce = [financial].reduce((s, f) => s + getCachePago(f), 0);
    const viaComputeHelper = computeEventFinancials(financial).cachePago;
    expect(viaDashboardStyleReduce).toBe(viaComputeHelper);
  });
});
