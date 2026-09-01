import { describe, expect, it } from "vitest";
import {
  calculateRentalSubtotal,
  canTransitionRental,
  getRentalActions,
  isRentalOverdue,
  normalizeRentalSearch,
  rentalIntervalsOverlap,
} from "./material-rental-domain";
import type { RentalDetail } from "./material-rental-types";

const detail = (overrides: Partial<RentalDetail> = {}): RentalDetail => ({
  id: "rental",
  empresa_id: "company",
  cliente_id: "customer",
  numero: "LOC-2026-000001",
  status: "rascunho",
  retirada_prevista_em: "2026-08-10T12:00:00Z",
  devolucao_prevista_em: "2026-08-12T12:00:00Z",
  responsavel_nome: "Admin",
  valor_total: 200,
  valor_bruto: 220,
  desconto: 20,
  cliente_nome: "Cliente",
  cliente_nome_fantasia: null,
  quantidade_itens: 1,
  quantidade_retirada: 0,
  quantidade_devolvida: 0,
  quantidade_com_cliente: 0,
  atrasada: false,
  observacoes: null,
  cliente: { id: "customer", tipo_pessoa: "pessoa_fisica", nome: "Cliente", nome_fantasia: null, cpf_cnpj: null, email: null, telefone: null, ativo: true, observacoes: null },
  evento: null,
  itens: [{
    id: "item", material_id: "material", quantidade_contratada: 20,
    modalidade_cobranca: "unidade", unidades_cobranca: 1,
    valor_unitario: 10, desconto: 0, subtotal: 200, observacoes: null,
    quantidade_retirada: 0, quantidade_devolvida: 0,
    quantidade_com_cliente: 0, quantidade_pendente_retirada: 20,
    material: { id: "material", nome: "Cadeira", codigo_interno: "CAD-01", tipo_controle: "quantidade", unidade_medida: "un", numero_serie: null, numero_patrimonio: null, codigo_barras: null, identificador_unico: "unique" },
  }],
  custodias: [],
  historico: [],
  ...overrides,
});

describe("material rental domain", () => {
  it("implements only explicit state transitions", () => {
    expect(canTransitionRental("rascunho", "reservada")).toBe(true);
    expect(canTransitionRental("reservada", "cancelada")).toBe(true);
    expect(canTransitionRental("rascunho", "concluida")).toBe(false);
    expect(canTransitionRental("concluida", "rascunho")).toBe(false);
  });

  it("calculates monetary subtotal without floating-point residue", () => {
    expect(calculateRentalSubtotal(3, 2, 10.1, 0.6)).toBe(60);
    expect(() => calculateRentalSubtotal(1, 1, 10, 11)).toThrow(/desconto/);
  });

  it.each([
    ["2026-08-10", "2026-08-12", "2026-08-11", "2026-08-13", true],
    ["2026-08-10", "2026-08-12", "2026-08-09", "2026-08-11", true],
    ["2026-08-10", "2026-08-12", "2026-08-09", "2026-08-13", true],
    ["2026-08-10", "2026-08-12", "2026-08-10", "2026-08-12", true],
    ["2026-08-10", "2026-08-12", "2026-08-12", "2026-08-14", false],
  ])("uses half-open ranges for %s/%s and %s/%s", (a, b, c, d, expected) => {
    expect(rentalIntervalsOverlap(new Date(a), new Date(b), new Date(c), new Date(d))).toBe(expected);
  });

  it("derives overdue only while quantity remains with the customer", () => {
    const now = new Date("2026-08-13T00:00:00Z");
    expect(isRentalOverdue(new Date("2026-08-12T00:00:00Z"), 1, now)).toBe(true);
    expect(isRentalOverdue(new Date("2026-08-12T00:00:00Z"), 0, now)).toBe(false);
  });

  it("allows reservation only with items and supports partial withdrawal", () => {
    expect(getRentalActions(detail()).canConfirm).toBe(true);
    const running = detail({ status: "em_andamento" });
    expect(getRentalActions(running).canCheckout).toBe(true);
    expect(getRentalActions(running).canConclude).toBe(false);
  });

  it("supports partial return and concludes only with no custody pending", () => {
    const partial = detail({ status: "parcialmente_devolvida", itens: [{ ...detail().itens[0], quantidade_retirada: 20, quantidade_devolvida: 15, quantidade_com_cliente: 5, quantidade_pendente_retirada: 0 }] });
    expect(getRentalActions(partial).canCheckin).toBe(true);
    expect(getRentalActions(partial).canConclude).toBe(false);
    const returned = detail({ status: "parcialmente_devolvida", itens: [{ ...partial.itens[0], quantidade_devolvida: 20, quantidade_com_cliente: 0 }] });
    expect(getRentalActions(returned).canConclude).toBe(true);
  });

  it("does not allow cancellation after any physical history", () => {
    const reserved = detail({ status: "reservada", custodias: [{ id: "custody", referencia_id: "item", material_id: "material", status: "cancelada", quantidade_retirada: 1, quantidade_baixada: 0, quantidade_devolvida: 0, quantidade_pendente: 0, retirada_em: "2026-08-10", previsao_retorno: null }] });
    expect(getRentalActions(reserved).canCancel).toBe(false);
  });

  it("normalizes scanner keyboard terminators", () => {
    expect(normalizeRentalSearch("\tCAD-01\r\n")).toBe("CAD-01");
  });
});
