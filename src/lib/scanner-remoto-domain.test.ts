import { describe, expect, it } from "vitest";
import {
  buildScannerReadDispatch,
  describePendingReadContext,
  detectScannerRemotoOperation,
  isNeutralScannerSession,
  isOperableRentalStatus,
  maxScannerRemotoCheckoutQuantity,
  OPERABLE_RENTAL_STATUSES,
  pickTraceabilityMatch,
  resolveRentalItemForMaterial,
  scannerOriginDestinationInvalid,
  traceabilityMatchesScan,
  type ScannerCheckinContext,
  type ScannerCheckoutContext,
} from "./scanner-remoto-domain";
import type { CustodyBalanceOption } from "./checkin-checkout-types";
import type { RentalStatus } from "./material-rental-types";
import type { ScannerRemotoSessao } from "./scanner-remoto-types";
import type {
  TraceabilityOpenCustody,
  TraceabilitySearchResult,
  TraceabilitySituacao,
} from "./material-traceability-types";

function balance(overrides: Partial<CustodyBalanceOption>): CustodyBalanceOption {
  return {
    localizacao_id: "loc1",
    localizacao_codigo: "DEP",
    localizacao_nome: "Depósito",
    localizacao_ativa: true,
    quantidade: 10,
    ...overrides,
  };
}

describe("detectScannerRemotoOperation", () => {
  it("is always checkout for a pure checkout session, regardless of open custody", () => {
    expect(detectScannerRemotoOperation("checkout", false)).toBe("checkout");
    expect(detectScannerRemotoOperation("checkout", true)).toBe("checkout");
  });

  it("is always checkin for a pure checkin session, regardless of open custody", () => {
    expect(detectScannerRemotoOperation("checkin", false)).toBe("checkin");
    expect(detectScannerRemotoOperation("checkin", true)).toBe("checkin");
  });

  it("in misto mode, checks in when the material already has an open custody", () => {
    expect(detectScannerRemotoOperation("misto", true)).toBe("checkin");
  });

  it("in misto mode, checks out when the material has no open custody", () => {
    expect(detectScannerRemotoOperation("misto", false)).toBe("checkout");
  });
});

describe("maxScannerRemotoCheckoutQuantity", () => {
  it("returns the balance at the session's origin location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc1")).toBe(7);
  });

  it("picks the origin location's balance, not just the first one", () => {
    const saldos = [
      balance({ localizacao_id: "loc1", quantidade: 3 }),
      balance({ localizacao_id: "loc2", quantidade: 20 }),
    ];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc2")).toBe(20);
  });

  it("returns 0 when the material has no balance at that location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, "loc-outra")).toBe(0);
  });

  it("returns 0 when the session has no origin location", () => {
    const saldos = [balance({ localizacao_id: "loc1", quantidade: 7 })];
    expect(maxScannerRemotoCheckoutQuantity(saldos, null)).toBe(0);
  });
});

function session(overrides: Partial<ScannerRemotoSessao> = {}): ScannerRemotoSessao {
  return {
    id: "s1",
    empresa_id: "e1",
    tipo_operacao: "misto",
    responsavel_tipo: null,
    responsavel_id: null,
    finalidade: null,
    condicao: "bom",
    localizacao_origem_id: null,
    localizacao_destino_id: null,
    referencia_tipo: null,
    referencia_id: null,
    titulo: null,
    observacao: null,
    status: "aberta",
    criado_por: "u1",
    aberta_em: "2026-09-01T10:00:00Z",
    encerrada_em: null,
    encerrada_por: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

describe("isNeutralScannerSession", () => {
  it("is true for a misto session with no operational context (E3 automatic)", () => {
    expect(isNeutralScannerSession(session())).toBe(true);
  });

  it("is false for a configured misto session", () => {
    expect(isNeutralScannerSession(session({ localizacao_origem_id: "loc1" }))).toBe(false);
    expect(isNeutralScannerSession(session({ finalidade: "uso_interno" }))).toBe(false);
    expect(isNeutralScannerSession(session({ responsavel_tipo: "funcionario", responsavel_id: "f1" }))).toBe(false);
    expect(isNeutralScannerSession(session({ localizacao_destino_id: "loc2" }))).toBe(false);
    expect(isNeutralScannerSession(session({ referencia_tipo: "evento", referencia_id: "evt1" }))).toBe(false);
  });

  it("is false for pure checkout / checkin sessions", () => {
    expect(isNeutralScannerSession(session({ tipo_operacao: "checkout" }))).toBe(false);
    expect(isNeutralScannerSession(session({ tipo_operacao: "checkin" }))).toBe(false);
  });
});

function material(overrides: Partial<TraceabilitySearchResult> = {}): TraceabilitySearchResult {
  return {
    id: "6ad882a7-28de-4fb2-a2ee-dcc426d478da",
    nome: "NEO 210 #07",
    codigo_interno: "NEO-210-07",
    numero_patrimonio: "PAT-207",
    numero_serie: "SN-207",
    codigo_barras: "789111222333",
    identificador_unico: "15b13cd1-6921-49a4-b67d-54c1b0e39acc",
    status_operacional: "disponivel",
    ativo: true,
    foto_path: null,
    resumo: { situacao: "disponivel", localizacoes: [], ultimo_retorno_em: null, ultimo_retorno_recebido_por: null, custodias_abertas: [], quantidade_total: 1, quantidade_disponivel: 1, quantidade_fora: 0 },
    ...overrides,
  };
}

describe("traceabilityMatchesScan / pickTraceabilityMatch", () => {
  it("matches by every supported identifier, case-insensitively", () => {
    const item = material();
    for (const id of [
      item.id,
      item.identificador_unico,
      item.codigo_barras!,
      item.codigo_interno,
      item.numero_patrimonio!,
      item.numero_serie!,
      "neo-210-07",
    ]) {
      expect(traceabilityMatchesScan(item, id)).toBe(true);
    }
  });

  it("matches the full BACKSTAGE-PRO:MATERIAL: QR by stripping the prefix to identificador_unico", () => {
    const item = material();
    expect(
      traceabilityMatchesScan(item, `BACKSTAGE-PRO:MATERIAL:${item.identificador_unico}`),
    ).toBe(true);
  });

  it("does not match an unrelated code", () => {
    expect(traceabilityMatchesScan(material(), "OUTRA-COISA")).toBe(false);
  });

  it("pickTraceabilityMatch prefers an exact identifier match", () => {
    const a = material({ id: "a", codigo_interno: "A-1" });
    const b = material({ id: "b", codigo_interno: "B-2" });
    expect(pickTraceabilityMatch([a, b], "B-2")).toBe(b);
  });

  it("pickTraceabilityMatch trusts a single server result even without a local identifier match (EPC)", () => {
    const only = material({ codigo_interno: "X-9" });
    expect(pickTraceabilityMatch([only], "E200-EPC-HEX")).toBe(only);
  });

  it("pickTraceabilityMatch returns null for zero results or an ambiguous fuzzy set", () => {
    expect(pickTraceabilityMatch([], "anything")).toBeNull();
    expect(pickTraceabilityMatch([material({ id: "a" }), material({ id: "b" })], "neo")).toBeNull();
  });
});

function openCustody(overrides: Partial<TraceabilityOpenCustody> = {}): TraceabilityOpenCustody {
  return {
    custodia_id: "c1",
    status: "aberta",
    finalidade: "uso_interno",
    referencia_tipo: null,
    referencia_id: null,
    quantidade_retirada: 3,
    quantidade_devolvida: 0,
    quantidade_pendente: 3,
    retirado_por: "João",
    liberado_por: "Alex",
    retirada_em: "2026-09-01T09:00:00Z",
    previsao_retorno: null,
    localizacao_origem_id: "loc1",
    localizacao_origem_nome: "Barracão",
    condicao_saida: "bom",
    evento: null,
    locacao: null,
    ...overrides,
  };
}

describe("describePendingReadContext", () => {
  it("with no open custody, reuses the traceability summary (Disponível + localização)", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "disponivel",
      localizacoes: [{ localizacao_id: "l1", localizacao_codigo: "BAR", localizacao_nome: "Barracão" }],
      ultimo_retorno_em: null,
      ultimo_retorno_recebido_por: null,
      custodias_abertas: [],
      quantidade_total: 4,
      quantidade_disponivel: 4,
      quantidade_fora: 0,
    };
    const context = describePendingReadContext(resumo, null);
    expect(context.headline).toBe("Disponível");
    expect(context.tone).toBe("success");
    expect(context.lines).toContainEqual({ label: "Localização", value: "Barracão" });
  });

  it("for a custody linked to an event, shows 'Em evento' + name + date", () => {
    const custody = openCustody({
      finalidade: "evento",
      referencia_tipo: "evento",
      referencia_id: "evt-1",
      evento: { evento_id: "evt-1", evento_nome: "Show Y", evento_data: "2026-08-20" },
    });
    // resumo é ignorado quando há uma custódia selecionada.
    const context = describePendingReadContext({} as TraceabilitySituacao, custody);
    expect(context.headline).toBe("Em evento");
    expect(context.lines).toContainEqual({ label: "Evento", value: "Show Y" });
    expect(context.lines).toContainEqual({ label: "Data do evento", value: "20/08/2026" });
  });

  it("for a custody linked to a rental item, shows 'Locado' + locação number + cliente", () => {
    const custody = openCustody({
      finalidade: "locacao",
      referencia_tipo: "locacao_item",
      referencia_id: "item-1",
      locacao: { locacao_id: "loc-1", locacao_numero: "LOC-2026-000123", cliente_id: "cli-1", cliente_nome: "Empresa X" },
    });
    const context = describePendingReadContext({} as TraceabilitySituacao, custody);
    expect(context.headline).toBe("Locado");
    expect(context.lines).toContainEqual({ label: "Locação", value: "LOC-2026-000123" });
    expect(context.lines).toContainEqual({ label: "Cliente", value: "Empresa X" });
  });

  it("for any other finalidade, shows 'Emprestado' with the custody facts", () => {
    const context = describePendingReadContext({} as TraceabilitySituacao, openCustody());
    expect(context.headline).toBe("Emprestado");
    expect(context.lines).toContainEqual({ label: "Saiu de", value: "Barracão" });
    expect(context.lines).toContainEqual({ label: "Quantidade pendente", value: "3" });
  });
});

// --- E4.5: helpers do contexto de operação ----------------------------------

describe("OPERABLE_RENTAL_STATUSES / isOperableRentalStatus", () => {
  it("is exactly the four statuses that accept a withdrawal, same list as the official flow", () => {
    expect([...OPERABLE_RENTAL_STATUSES].sort()).toEqual(
      ["em_andamento", "parcialmente_devolvida", "pronta_retirada", "reservada"].sort(),
    );
  });

  it("rejects rascunho / concluida / cancelada", () => {
    for (const status of ["reservada", "pronta_retirada", "em_andamento", "parcialmente_devolvida"] as RentalStatus[]) {
      expect(isOperableRentalStatus(status)).toBe(true);
    }
    for (const status of ["rascunho", "concluida", "cancelada"] as RentalStatus[]) {
      expect(isOperableRentalStatus(status)).toBe(false);
    }
  });
});

describe("resolveRentalItemForMaterial", () => {
  const itens = [
    { id: "ri-1", material: { id: "mat-1" } },
    { id: "ri-2", material: { id: "mat-2" } },
  ];

  it("returns the material_locacao_itens.id of the scanned material", () => {
    expect(resolveRentalItemForMaterial(itens, "mat-2")).toBe("ri-2");
  });

  it("returns null when the scanned material is not in the rental (blocks confirmation)", () => {
    expect(resolveRentalItemForMaterial(itens, "mat-outro")).toBeNull();
    expect(resolveRentalItemForMaterial([], "mat-1")).toBeNull();
  });
});

describe("scannerOriginDestinationInvalid", () => {
  const checkin = (overrides: Partial<ScannerCheckinContext> = {}): ScannerCheckinContext => ({
    operation: "checkin",
    custodyId: "c1",
    originLocationId: "loc1",
    destinationLocationId: "loc2",
    returnCondition: "bom",
    rental: null,
    ...overrides,
  });

  it("blocks a check-in whose destination equals the custody origin (no-op move)", () => {
    expect(scannerOriginDestinationInvalid(checkin({ destinationLocationId: "loc1" }))).toBe(true);
  });

  it("allows a check-in that actually changes location", () => {
    expect(scannerOriginDestinationInvalid(checkin())).toBe(false);
  });

  it("never blocks when the custody has no known origin", () => {
    expect(
      scannerOriginDestinationInvalid(checkin({ originLocationId: null, destinationLocationId: "loc2" })),
    ).toBe(false);
  });

  it("never blocks a check-out (no destination in play)", () => {
    const checkout: ScannerCheckoutContext = {
      operation: "checkout",
      originLocationId: "loc1",
      responsibleType: "usuario",
      responsibleId: "u1",
      condition: "bom",
      purpose: "uso_interno",
      event: null,
      rental: null,
    };
    expect(scannerOriginDestinationInvalid(checkout)).toBe(false);
  });
});

describe("buildScannerReadDispatch (E5)", () => {
  const checkout = (overrides: Partial<ScannerCheckoutContext> = {}): ScannerCheckoutContext => ({
    operation: "checkout",
    originLocationId: "loc-orig",
    responsibleType: "usuario",
    responsibleId: "u1",
    condition: "bom",
    purpose: "uso_interno",
    event: null,
    rental: null,
    ...overrides,
  });

  it("check-in: manda a custódia em custodiaId e um contexto mínimo (destino + condição)", () => {
    const dispatch = buildScannerReadDispatch({
      operation: "checkin",
      custodyId: "cust-9",
      originLocationId: "loc-src",
      destinationLocationId: "loc-dest",
      returnCondition: "com_avaria",
      rental: { rentalId: "r1", rentalItemId: "ri1" },
    });
    expect(dispatch).toEqual({
      custodiaId: "cust-9",
      contexto: {
        operation: "checkin",
        localizacao_destino_id: "loc-dest",
        condicao: "com_avaria",
      },
    });
    // a locação NÃO vai no contexto de check-in - o RPC deriva da custódia
    expect(dispatch.contexto).not.toHaveProperty("locacao_id");
  });

  it("check-out normal: origem/responsável/finalidade/condição, sem custodiaId", () => {
    const dispatch = buildScannerReadDispatch(checkout());
    expect(dispatch.custodiaId).toBeUndefined();
    expect(dispatch.contexto).toEqual({
      operation: "checkout",
      localizacao_origem_id: "loc-orig",
      responsavel_tipo: "usuario",
      responsavel_id: "u1",
      finalidade: "uso_interno",
      condicao: "bom",
    });
  });

  it("check-out evento: acrescenta referencia_tipo='evento' + referencia_id", () => {
    const dispatch = buildScannerReadDispatch(
      checkout({ purpose: "evento", event: { referenceType: "evento", referenceId: "evt-1" } }),
    );
    expect(dispatch.contexto).toMatchObject({
      finalidade: "evento",
      referencia_tipo: "evento",
      referencia_id: "evt-1",
    });
  });

  it("check-out cliente: acrescenta locacao_id + locacao_item_id, finalidade continua 'cliente'", () => {
    const dispatch = buildScannerReadDispatch(
      checkout({ purpose: "cliente", rental: { rentalId: "loc-7", rentalItemId: "item-7" } }),
    );
    expect(dispatch.contexto).toMatchObject({
      finalidade: "cliente",
      locacao_id: "loc-7",
      locacao_item_id: "item-7",
    });
    // nunca 'locacao' no payload do seletor
    expect(dispatch.contexto).not.toMatchObject({ finalidade: "locacao" });
  });
});
